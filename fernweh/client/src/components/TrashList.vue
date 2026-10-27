<template>
  <div class="data-group">
    <div class="group-label">Recently deleted</div>
    <p class="hint">Deleted markers are kept for 30 days and restored with their categories, collections, trip stop and route.</p>
    <p v-if="error" class="msg error">{{ error }}</p>
    <p v-if="loading" class="hint">Loading…</p>
    <p v-else-if="!items.length" class="hint">The trash is empty.</p>
    <ul v-else class="trash-list">
      <li v-for="item in items" :key="item.id" class="trash-row">
        <span class="trash-label">{{ item.label || 'Unnamed marker' }}</span>
        <span class="trash-date">{{ formatDeleted(item.deleted_at) }}</span>
        <button type="button" class="btn-ghost btn-sm" :disabled="busy" @click="restore(item)">Restore</button>
        <button type="button" class="btn-ghost btn-sm danger" :disabled="busy" :aria-label="`Delete ${item.label || 'marker'} permanently`" title="Delete permanently" @click="removeForever(item)">✕</button>
      </li>
    </ul>
    <div v-if="items.length" class="actions">
      <div class="spacer" />
      <template v-if="confirmEmpty">
        <button type="button" class="btn-secondary" @click="confirmEmpty = false">Cancel</button>
        <button type="button" class="btn-secondary danger" :disabled="busy" @click="empty">Yes, delete all permanently</button>
      </template>
      <button v-else type="button" class="btn-secondary" @click="confirmEmpty = true">Empty trash…</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useMarkersStore } from '../stores/markers.js'

const markersStore = useMarkersStore()
const items = ref([])
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const confirmEmpty = ref(false)

async function run(action) {
  busy.value = true
  error.value = ''
  try { await action() } catch (err) { error.value = err.message } finally { busy.value = false }
}

onMounted(async () => {
  try { items.value = await markersStore.fetchTrash() } catch (err) { error.value = err.message } finally { loading.value = false }
})

const restore = (item) => run(async () => {
  await markersStore.restoreFromTrash(item.id)
  items.value = items.value.filter((i) => i !== item)
})
const removeForever = (item) => run(async () => {
  await markersStore.deleteFromTrash(item.id)
  items.value = items.value.filter((i) => i !== item)
})
const empty = () => run(async () => {
  await markersStore.emptyTrash()
  items.value = []
  confirmEmpty.value = false
})

// SQLite stores UTC as "YYYY-MM-DD HH:MM:SS".
function formatDeleted(value) {
  const date = new Date(value.replace(' ', 'T') + 'Z')
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
</script>

<style scoped>
/* Mirrors the Settings modal's section styles, which are scoped there. */
.data-group { margin-bottom: 24px; }
.group-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-2); margin-bottom: 10px; }
.hint { font-size: 12px; color: var(--text-2); margin-bottom: 10px; line-height: 1.5; }
.msg { font-size: 13px; margin: 8px 0; padding: 8px 10px; border-radius: var(--radius); }
.msg.error { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); }
.actions { display: flex; gap: 8px; align-items: center; }
.spacer { flex: 1; }
.btn-ghost, .btn-secondary { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); font-size: 13px; }
.btn-ghost:hover:not(:disabled), .btn-secondary:hover:not(:disabled) { background: var(--border); }
.btn-sm { padding: 3px 9px; font-size: 12px; }
.trash-list { list-style: none; margin: 0 0 8px; padding: 0; max-height: 220px; overflow-y: auto; }
.trash-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px solid var(--border); }
.trash-row:last-child { border-bottom: none; }
.trash-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.trash-date { font-size: 12px; color: var(--text-2); flex-shrink: 0; }
.danger { color: var(--danger); }
</style>
