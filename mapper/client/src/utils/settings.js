const KEY = 'mapper_settings'
export function loadSettings() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch { return {} }
}
export function saveSettings(patch) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...loadSettings(), ...patch })) } catch { /* storage can be unavailable */ }
}
