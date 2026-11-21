import { ref } from 'vue'

// Module-level singletons shared across all component instances
const flyToTarget = ref(null)       // { lat, lng, zoom }
const csvPreviewMarkers = ref([])   // [{ lat, lng, label, country, rejected }]

export function useMapControl() {
  function flyTo(lat, lng, zoom = 15) {
    flyToTarget.value = { lat, lng, zoom }
  }

  function clearPreviewMarkers() {
    csvPreviewMarkers.value = []
  }

  return { flyToTarget, csvPreviewMarkers, flyTo, clearPreviewMarkers }
}
