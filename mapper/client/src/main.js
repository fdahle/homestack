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
setUnauthorizedHandler(() => {
  const auth = useAuthStore()
  auth.isAuthenticated = false
  auth.invalidateSession()
  if (router.currentRoute.value.meta.requiresAuth) router.replace('/login')
})
app.use(router)
app.mount('#app')
