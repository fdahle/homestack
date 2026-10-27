<template>
  <div class="trip-summary" role="status">
    <AppIcon name="trip" />
    <span>
      {{ formatDistance(summary.distance) }}<template v-if="!summary.routed"> (straight)</template><template v-if="summary.duration != null"> · {{ formatDuration(summary.duration) }}</template>
    </span>
    <button type="button" class="trip-gpx-btn" title="Download the trip as GPX" @click="downloadGpx">GPX</button>
  </div>
</template>

<script setup>
import AppIcon from './AppIcon.vue'
import { formatDistance, formatDuration, buildGpx, gpxFilename } from '../utils/trip.js'

const props = defineProps({
  summary: { type: Object, required: true },
})

function downloadGpx() {
  const { name, stops, legs } = props.summary
  const blob = new Blob([buildGpx(name, stops, legs)], { type: 'application/gpx+xml' })
  const url = URL.createObjectURL(blob)
  Object.assign(document.createElement('a'), { href: url, download: gpxFilename(name) }).click()
  URL.revokeObjectURL(url)
}
</script>

<style scoped>
.trip-summary {
  position: absolute;
  bottom: calc(22px + var(--sab, 0px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 6px 6px 12px;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
  box-shadow: var(--shadow-lg);
  white-space: nowrap;
}
.trip-gpx-btn {
  padding: 3px 10px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.trip-gpx-btn:hover { background: var(--border); }
@media (max-width: 640px) {
  .trip-summary { left: auto; right: 10px; transform: none; bottom: calc(76px + var(--sab, 0px)); }
}
</style>
