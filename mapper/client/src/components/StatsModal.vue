<template>
  <div class="overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h2>Statistics</h2>
        <button class="close-btn" @click="$emit('close')">✕</button>
      </div>

      <div class="modal-body">
        <div class="stat-row">
          <span class="stat-label">Total markers</span>
          <span class="stat-value">{{ stats.total }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Visited</span>
          <span class="stat-value">{{ stats.visited }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Not visited</span>
          <span class="stat-value">{{ stats.unvisited }}</span>
        </div>

        <template v-if="stats.byCategory.length">
          <div class="stat-divider" />
          <div class="stat-section-label">By category</div>
          <div v-for="row in stats.byCategory" :key="row.name" class="stat-row">
            <span class="stat-label"><span class="dot" :style="{ background: row.color }" />{{ row.name }}</span>
            <span class="stat-value">{{ row.count }}</span>
          </div>
        </template>

        <template v-if="stats.byCollection.length">
          <div class="stat-divider" />
          <div class="stat-section-label">By collection</div>
          <div v-for="row in stats.byCollection" :key="row.name" class="stat-row">
            <span class="stat-label"><span class="dot" :style="{ background: row.color }" />{{ row.name }}</span>
            <span class="stat-value">{{ row.count }}</span>
          </div>
        </template>

        <p v-if="!stats.total" class="empty">No markers yet.</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useMarkersStore } from '../stores/markers.js'

defineEmits(['close'])

const markersStore = useMarkersStore()

const stats = computed(() => {
  const markers = markersStore.filtered
  const visited = markers.filter((m) => m.visited_at).length
  const catMap = {}
  const collectionMap = {}
  for (const m of markers) {
    for (const c of m.categories ?? []) {
      if (!catMap[c.id]) catMap[c.id] = { name: c.name, color: c.color, count: 0 }
      catMap[c.id].count++
    }
    for (const c of m.collections ?? []) {
      if (!collectionMap[c.id]) collectionMap[c.id] = { name: c.name, color: c.color, count: 0 }
      collectionMap[c.id].count++
    }
  }
  return {
    total: markers.length,
    visited,
    unvisited: markers.length - visited,
    byCategory: Object.values(catMap).sort((a, b) => b.count - a.count),
    byCollection: Object.values(collectionMap).sort((a, b) => b.count - a.count),
  }
})
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
  width: 360px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px);
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
  padding: 16px 20px 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-section-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-2);
  margin-top: 6px;
  margin-bottom: 2px;
}

.stat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  padding: 4px 0;
}

.stat-label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-2);
}

.stat-value {
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.stat-divider {
  height: 1px;
  background: var(--border);
  margin: 6px 0;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  display: inline-block;
}

.empty {
  font-size: 13px;
  color: var(--text-2);
  text-align: center;
  padding: 20px 0;
}
</style>
