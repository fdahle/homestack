// The import of friends from Bande (api/utils/bande.js). Off and invisible unless the server
// has BANDE_URL and BANDE_LINK_TOKEN; the status is loaded once and shared.
import { computed, ref } from 'vue'
import { apiJson } from '../api.js'
import { useMarkersStore } from '../stores/markers.js'
import { usePersonsStore } from '../stores/persons.js'
import { useCollectionsStore } from '../stores/collections.js'

const status = ref(null)
const syncing = ref(false)
const syncError = ref('')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function loadBandeStatus() {
  try {
    status.value = await apiJson('/api/bande')
  } catch {
    status.value ??= { enabled: false }
  }
  return status.value
}

// Link to the friend's page in Bande, or null (not linked, gone from Bande, or no BANDE_PUBLIC_URL)
export function bandeFriendUrl(person) {
  const base = status.value?.enabled && status.value.publicUrl
  if (!base || person?.bande_friend_id == null || person.bande_gone) return null
  return `${base}/friend/${encodeURIComponent(person.bande_friend_id)}`
}

export function useBande() {
  const enabled = computed(() => Boolean(status.value?.enabled))
  const last = computed(() => status.value?.last ?? null)

  // Starts a sync on the server and waits for it (a new address takes a second to look up),
  // then reloads what it may have changed.
  async function syncNow() {
    if (syncing.value) return
    syncing.value = true
    syncError.value = ''
    try {
      status.value = await apiJson('/api/bande/sync', { method: 'POST' })
      while (status.value?.running) {
        await wait(1500)
        status.value = await apiJson('/api/bande')
      }
      await Promise.all([usePersonsStore().fetch(), useMarkersStore().fetch(), useCollectionsStore().fetch()])
    } catch (err) {
      syncError.value = err.message
    } finally {
      syncing.value = false
    }
  }

  return { status, enabled, last, syncing, syncError, syncNow, load: loadBandeStatus }
}
