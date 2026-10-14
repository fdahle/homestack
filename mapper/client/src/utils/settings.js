import { ref } from 'vue'

const KEY = 'mapper_settings'
// Bumped on every save so computed values that read settings (e.g. the ORS key) re-evaluate.
export const settingsRevision = ref(0)
export function loadSettings() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch { return {} }
}
export function saveSettings(patch) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...loadSettings(), ...patch })) } catch { /* storage can be unavailable */ }
  settingsRevision.value++
}
