import { ref } from 'vue'
import { useMarkersStore } from '../stores/markers.js'

export function useModals() {
  const markersStore = useMarkersStore()

  const modalOpen = ref(false)
  const editingMarker = ref(null)
  const pendingLatLng = ref(null)
  const markerSuggestedLabel = ref('')

  const manageOpen = ref(false)
  const manageType = ref('category')
  const manageItem = ref(null)

  const settingsOpen = ref(false)

  const markerListOpen = ref(false)

  function closeModal() {
    modalOpen.value = false
    editingMarker.value = null
    pendingLatLng.value = null
    markerSuggestedLabel.value = ''
  }

  function openManageModal(type, item) {
    manageType.value = type
    manageItem.value = item
    manageOpen.value = true
  }

  function openMarkerModal(marker) {
    editingMarker.value = marker
    pendingLatLng.value = null
    markerSuggestedLabel.value = ''
    modalOpen.value = true
  }

  function openNewMarkerModal(latlng, suggestedLabel = '') {
    editingMarker.value = null
    pendingLatLng.value = latlng
    markerSuggestedLabel.value = suggestedLabel
    modalOpen.value = true
  }

  async function onMarkerSave(data) {
    if (editingMarker.value) {
      await markersStore.update(editingMarker.value.id, data)
    } else {
      await markersStore.create(data)
    }
    closeModal()
  }

  async function onMarkerDelete(id) {
    await markersStore.remove(id)
    closeModal()
  }

  return {
    modalOpen,
    editingMarker,
    pendingLatLng,
    markerSuggestedLabel,
    manageOpen,
    manageType,
    manageItem,
    settingsOpen,
    markerListOpen,
    closeModal,
    openManageModal,
    openMarkerModal,
    openNewMarkerModal,
    onMarkerSave,
    onMarkerDelete,
  }
}
