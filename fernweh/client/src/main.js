import { setUnauthorizedHandler } from './api.js'
import { useAuthStore } from './stores/auth.js'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { loadSettings } from './utils/settings.js'
import router from './router/index.js'
import App from './App.vue'

try {
  const s = loadSettings()
  if (s?.theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark')
} catch {}

const app = createApp(App)
app.use(createPinia())
setUnauthorizedHandler(({ write } = {}) => {
  const auth = useAuthStore()
  auth.invalidateSession()
  // Writes keep the page (and any open form); App.vue shows a sign-in link instead.
  if (write) { auth.sessionExpired = true; return }
  auth.isAuthenticated = false
  if (router.currentRoute.value.meta.requiresAuth) router.replace('/login')
})

// After a deploy, an open tab still references the previous build's hashed chunks, which the
// server no longer has. Reload once to pick up the new index.html; the timestamp guards against
// a reload loop when the chunk is missing for another reason.
const CHUNK_RELOAD_KEY = 'mapper_chunk_reload'
function reloadForNewBuild(path) {
  let last = 0
  try { last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY)) || 0 } catch {}
  if (Date.now() - last < 60000) return false
  try { sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now())) } catch {}
  if (path) window.location.assign(path)
  else window.location.reload()
  return true
}
const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|Unable to preload CSS|error loading dynamically imported/i
window.addEventListener('vite:preloadError', (event) => { if (reloadForNewBuild()) event.preventDefault() })
router.onError((err, to) => {
  if (CHUNK_ERROR.test(err?.message ?? '')) reloadForNewBuild(to?.fullPath)
})

app.use(router)
app.mount('#app')

// Installable app + fast start; skipped in development so Vite's live reload stays untouched.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
