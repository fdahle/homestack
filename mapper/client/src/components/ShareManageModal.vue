<template>
  <div class="overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h2>Share Links</h2>
        <button class="close-btn" @click="$emit('close')"><AppIcon name="close" /></button>
      </div>

      <div class="modal-body">
        <!-- Link list -->
        <div v-if="!showForm">
          <div v-if="store.items.length === 0" class="empty-state">
            No share links yet. Create one to let others view your markers.
          </div>

          <div v-for="link in store.items" :key="link.token" class="link-row">
            <div class="link-info">
              <div class="link-name">
                {{ link.name || 'Untitled link' }}
                <AppIcon v-if="link.hasPassword" name="lock" class="lock-icon" title="Password protected" />
              </div>
              <div class="link-meta">
                {{ link.markerCount }} marker{{ link.markerCount === 1 ? '' : 's' }}
                <template v-if="link.expiresAt"> · Expires {{ formatDate(link.expiresAt) }}</template>
              </div>
            </div>
            <div class="link-actions">
              <button class="icon-btn" :title="copied === link.token ? 'Copied!' : 'Copy link'" @click="copyLink(link.token)">
                <AppIcon :name="copied === link.token ? 'check' : 'copy'" />
              </button>
              <button class="icon-btn edit-btn" title="Edit" @click="editLink(link)">
                <AppIcon name="edit" />
              </button>
              <button class="icon-btn danger-btn" title="Delete" @click="deleteLink(link.token)" :disabled="deleting === link.token">
                <AppIcon name="trash" />
              </button>
            </div>
          </div>

          <div class="create-btn-row">
            <button class="btn-primary" @click="openCreateForm">
              <AppIcon name="plus" /> New share link
            </button>
          </div>
        </div>

        <!-- Create / Edit form -->
        <form v-else @submit.prevent="save">
          <div class="field">
            <label>Name <span class="optional">(optional)</span></label>
            <input v-model="form.name" type="text" placeholder="e.g. Europe trip 2024" />
          </div>

          <div class="field">
            <label>What to share</label>
            <label class="checkbox-label bold-label">
              <input type="checkbox" v-model="form.filter.all" />
              All markers
            </label>
          </div>

          <template v-if="!form.filter.all">
            <div v-if="categoriesStore.items.length" class="filter-section">
              <div class="filter-section-title">Categories</div>
              <label v-for="cat in categoriesStore.items" :key="cat.id" class="checkbox-label">
                <input type="checkbox" :value="cat.id" v-model="form.filter.categories" />
                <span class="color-dot" :style="{ background: cat.color }" />
                {{ cat.name }}
              </label>
            </div>

            <div v-if="collectionsStore.items.length" class="filter-section">
              <div class="filter-section-title">Collections</div>
              <label v-for="col in collectionsStore.items" :key="col.id" class="checkbox-label">
                <input type="checkbox" :value="col.id" v-model="form.filter.collections" />
                <span class="color-dot" :style="{ background: col.color }" />
                {{ col.name }}
              </label>
            </div>

            <div v-if="personsStore.items.length" class="filter-section">
              <div class="filter-section-title">Persons</div>
              <label v-for="person in personsStore.items" :key="person.id" class="checkbox-label">
                <input type="checkbox" :value="person.id" v-model="form.filter.persons" />
                <span class="color-dot" :style="{ background: person.color }" />
                {{ person.name }}
              </label>
            </div>

            <p v-if="!form.filter.all && !hasAnyFilter" class="hint-text warning-text">
              Select at least one category, collection, or person — or enable "All markers".
            </p>
          </template>

          <div class="field">
            <label class="checkbox-label">
              <input type="checkbox" v-model="usePassword" />
              Password protect
            </label>
            <div v-if="usePassword" class="password-input-row">
              <input
                v-model="form.password"
                :type="showPw ? 'text' : 'password'"
                placeholder="Enter password"
                autocomplete="new-password"
                class="pw-input"
              />
              <button type="button" class="icon-btn" @click="showPw = !showPw">
                <AppIcon :name="showPw ? 'eyeOff' : 'eye'" />
              </button>
            </div>
            <p v-if="editingLink && editingLink.hasPassword && !usePassword" class="hint-text">
              Password will be removed on save.
            </p>
          </div>

          <div class="field">
            <label>Expiry date <span class="optional">(optional)</span></label>
            <input v-model="form.expiresAt" type="date" :min="todayStr" />
          </div>

          <p v-if="error" class="error">{{ error }}</p>

          <div class="modal-actions">
            <button type="button" class="btn-secondary" @click="cancelForm">Cancel</button>
            <button type="submit" class="btn-primary" :disabled="saving || (!form.filter.all && !hasAnyFilter)">
              {{ saving ? '…' : editingLink ? 'Save changes' : 'Create link' }}
            </button>
          </div>

          <div v-if="createdToken" class="created-link-box">
            <p class="created-label">Share this link:</p>
            <div class="created-url-row">
              <input readonly :value="shareUrl(createdToken)" class="url-input" />
              <button type="button" class="icon-btn" :title="copied === createdToken ? 'Copied!' : 'Copy'" @click="copyLink(createdToken)">
                <AppIcon :name="copied === createdToken ? 'check' : 'copy'" />
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import AppIcon from './AppIcon.vue'
import { useShareLinksStore } from '../stores/shareLinks.js'
import { useCategoriesStore } from '../stores/categories.js'
import { useCollectionsStore } from '../stores/collections.js'
import { usePersonsStore } from '../stores/persons.js'

const emit = defineEmits(['close'])

const store = useShareLinksStore()
const categoriesStore = useCategoriesStore()
const collectionsStore = useCollectionsStore()
const personsStore = usePersonsStore()

const showForm = ref(false)
const editingLink = ref(null)
const saving = ref(false)
const deleting = ref(null)
const error = ref(null)
const copied = ref(null)
const createdToken = ref(null)
const usePassword = ref(false)
const showPw = ref(false)

const todayStr = new Date().toISOString().slice(0, 10)

const defaultForm = () => ({
  name: '',
  password: '',
  expiresAt: '',
  filter: { all: false, categories: [], collections: [], persons: [], markers: [] },
})
const form = ref(defaultForm())

const hasAnyFilter = computed(() =>
  form.value.filter.categories.length > 0 ||
  form.value.filter.collections.length > 0 ||
  form.value.filter.persons.length > 0
)

watch(usePassword, (val) => { if (!val) form.value.password = '' })

onMounted(() => store.fetch())

function shareUrl(token) {
  return `${window.location.origin}/share/${token}`
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

async function copyLink(token) {
  await navigator.clipboard.writeText(shareUrl(token))
  copied.value = token
  setTimeout(() => { copied.value = null }, 2000)
}

function openCreateForm() {
  editingLink.value = null
  form.value = defaultForm()
  usePassword.value = false
  showPw.value = false
  error.value = null
  createdToken.value = null
  showForm.value = true
}

function editLink(link) {
  editingLink.value = link
  form.value = {
    name: link.name || '',
    password: '',
    expiresAt: link.expiresAt ? link.expiresAt.slice(0, 10) : '',
    filter: {
      all: link.filter.all,
      categories: [...link.filter.categories],
      collections: [...link.filter.collections],
      persons: [...link.filter.persons],
      markers: [...(link.filter.markers || [])],
    },
  }
  usePassword.value = link.hasPassword
  showPw.value = false
  error.value = null
  createdToken.value = null
  showForm.value = true
}

function cancelForm() {
  showForm.value = false
  editingLink.value = null
  createdToken.value = null
}

async function save() {
  error.value = null
  if (!form.value.filter.all && !hasAnyFilter.value) {
    error.value = 'Select at least one filter or enable "All markers".'
    return
  }
  if (usePassword.value && !editingLink.value && !form.value.password) {
    error.value = 'Enter a password or disable password protection.'
    return
  }

  saving.value = true
  try {
    const payload = {
      name: form.value.name || null,
      filter: form.value.filter,
      expiresAt: form.value.expiresAt || null,
    }
    if (usePassword.value && form.value.password) {
      payload.password = form.value.password
    } else if (!usePassword.value && editingLink.value?.hasPassword) {
      payload.removePassword = true
    }

    if (editingLink.value) {
      await store.update(editingLink.value.token, payload)
      showForm.value = false
      editingLink.value = null
    } else {
      const created = await store.create(payload)
      createdToken.value = created.token
    }
  } catch (err) {
    error.value = err.message
  } finally {
    saving.value = false
  }
}

async function deleteLink(token) {
  if (!confirm('Delete this share link? Anyone with the link will lose access.')) return
  deleting.value = token
  try {
    await store.remove(token)
  } finally {
    deleting.value = null
  }
}
</script>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3000;
}

.modal {
  background: var(--surface);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  width: 420px;
  max-width: calc(100vw - 32px);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

h2 { font-size: 16px; font-weight: 700; }

.close-btn {
  background: none;
  color: var(--text-2);
  padding: 4px 8px;
  border-radius: 4px;
}
.close-btn:hover { background: var(--surface-2); }

.modal-body {
  overflow-y: auto;
  padding: 16px 20px 20px;
  flex: 1;
}

form { display: flex; flex-direction: column; gap: 0; }

.field { margin-bottom: 14px; }

.empty-state {
  text-align: center;
  padding: 24px 0 8px;
  color: var(--text-2);
  font-size: 13px;
}

.link-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}
.link-row:last-of-type { border-bottom: none; }

.link-info { flex: 1; min-width: 0; }

.link-name {
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lock-icon { color: var(--text-2); flex-shrink: 0; }

.link-meta { font-size: 12px; color: var(--text-2); margin-top: 2px; }

.link-actions { display: flex; gap: 4px; flex-shrink: 0; }

.icon-btn {
  background: none;
  border: none;
  box-shadow: none;
  color: var(--text-2);
  padding: 5px 6px;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
}
.icon-btn:hover { background: var(--surface-2); color: var(--text); }
.icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.edit-btn:hover { color: var(--accent); }
.danger-btn:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, var(--surface)); }

.create-btn-row {
  padding-top: 14px;
  display: flex;
  justify-content: flex-end;
}

.filter-section { margin-bottom: 12px; }

.filter-section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-2);
  margin-bottom: 6px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
  padding: 2px 0;
}
.checkbox-label input[type="checkbox"] { width: 14px; height: 14px; cursor: pointer; flex-shrink: 0; }

.bold-label { font-weight: 600; }

.color-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  display: inline-block;
}

.optional { font-size: 11px; color: var(--text-2); font-weight: 400; }

.hint-text { font-size: 11px; color: var(--text-2); margin-top: 5px; }
.warning-text { color: var(--danger); }

.password-input-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}
.pw-input { flex: 1; }

.error { color: var(--danger); font-size: 13px; margin-bottom: 10px; }

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 4px;
}

.btn-primary {
  background: var(--accent);
  color: #fff;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-secondary { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); }
.btn-secondary:hover { background: var(--border); }

.created-link-box {
  margin-top: 16px;
  padding: 12px 14px;
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--accent) 25%, var(--border));
  border-radius: var(--radius);
}

.created-label { font-size: 12px; font-weight: 600; color: var(--accent); margin-bottom: 6px; }

.created-url-row { display: flex; gap: 6px; align-items: center; }

.url-input {
  flex: 1;
  font-size: 12px;
  font-family: monospace;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 6px 8px;
}

@media (max-width: 640px) {
  .overlay { align-items: flex-end; }
  .modal {
    width: 100vw;
    max-width: 100vw;
    max-height: 85vh;
    border-radius: 16px 16px 0 0;
  }
  .modal-header { padding-top: 16px; }
}
</style>
