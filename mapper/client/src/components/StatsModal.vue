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
        <div v-if="stats.visited > 0" class="stat-row">
          <span class="stat-label">
            Countries visited
            <span v-if="geocoding" class="geocoding-hint">geocoding…</span>
          </span>
          <span class="stat-value">{{ stats.countriesVisited }}</span>
        </div>

        <template v-if="stats.byCategory.length">
          <div class="stat-divider" />
          <div class="stat-section-label">By category</div>
          <div v-for="row in stats.byCategory" :key="row.name" class="stat-row">
            <span class="stat-label">
              <span class="dot" :style="{ background: row.color }" />
              {{ row.name }}
            </span>
            <span class="stat-value-group">
              <span class="stat-value">{{ row.total }}</span>
              <span v-if="stats.visited > 0" class="stat-sub">
                {{ row.visited }} visited
                <span class="stat-pct">({{ pct(row.visited, row.total) }}%)</span>
              </span>
            </span>
          </div>
        </template>

        <template v-if="stats.byCollection.length">
          <div class="stat-divider" />
          <div class="stat-section-label">By collection</div>
          <div v-for="row in stats.byCollection" :key="row.name" class="stat-row">
            <span class="stat-label">
              <span class="dot" :style="{ background: row.color }" />
              {{ row.name }}
            </span>
            <span class="stat-value-group">
              <span class="stat-value">{{ row.total }}</span>
              <span v-if="stats.visited > 0" class="stat-sub">
                {{ row.visited }} visited
                <span class="stat-pct">({{ pct(row.visited, row.total) }}%)</span>
              </span>
            </span>
          </div>
        </template>

        <p v-if="!stats.total" class="empty">No markers yet.</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useMarkersStore } from '../stores/markers.js'

defineEmits(['close'])

const markersStore = useMarkersStore()
const geocoding = ref(false)

const stats = computed(() => {
  const markers = markersStore.items
  const visited = markers.filter((m) => m.visited_at).length

  const visitedCountries = new Set(
    markers.filter((m) => m.visited_at && m.country).map((m) => m.country)
  )

  const catMap = {}
  const collectionMap = {}
  for (const m of markers) {
    for (const c of m.categories ?? []) {
      if (!catMap[c.id]) catMap[c.id] = { name: c.name, color: c.color, total: 0, visited: 0 }
      catMap[c.id].total++
      if (m.visited_at) catMap[c.id].visited++
    }
    for (const c of m.collections ?? []) {
      if (!collectionMap[c.id]) collectionMap[c.id] = { name: c.name, color: c.color, total: 0, visited: 0 }
      collectionMap[c.id].total++
      if (m.visited_at) collectionMap[c.id].visited++
    }
  }

  return {
    total: markers.length,
    visited,
    unvisited: markers.length - visited,
    countriesVisited: visitedCountries.size,
    byCategory: Object.values(catMap).sort((a, b) => b.total - a.total),
    byCollection: Object.values(collectionMap).sort((a, b) => b.total - a.total),
  }
})

function pct(n, total) {
  if (!total) return 0
  return Math.round((n / total) * 100)
}

onMounted(async () => {
  const toGeocode = markersStore.items.filter((m) => m.visited_at && !m.country)
  if (!toGeocode.length) return
  geocoding.value = true
  for (let i = 0; i < toGeocode.length; i++) {
    const m = toGeocode[i]
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${m.lat}&lon=${m.lng}&format=json`,
        { headers: { 'Accept-Language': 'en' } }
      )
      const data = await res.json()
      const country = data.address?.country ?? null
      await markersStore.patchCountry(m.id, country)
    } catch {}
    if (i < toGeocode.length - 1) await new Promise((r) => setTimeout(r, 1100))
  }
  geocoding.value = false
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
  width: 380px;
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
  gap: 8px;
}

.stat-label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-2);
  flex-shrink: 0;
}

.stat-value {
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.stat-value-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.stat-sub {
  font-size: 12px;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}

.stat-pct {
  color: var(--text-3, var(--text-2));
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

.geocoding-hint {
  font-size: 11px;
  color: var(--text-2);
  font-weight: 400;
  font-style: italic;
}

.empty {
  font-size: 13px;
  color: var(--text-2);
  text-align: center;
  padding: 20px 0;
}

@media (max-width: 640px) {
  .overlay { align-items: stretch; padding: 0; }
  .modal {
    width: 100vw;
    max-width: 100vw;
    height: 100vh;
    max-height: 100vh;
    border-radius: 0;
  }
  .modal-header { padding-top: calc(16px + var(--sat, 0px)); }
  .modal-body { padding-bottom: calc(16px + var(--sab, 0px)); }
}
</style>
