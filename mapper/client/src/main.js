import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router/index.js'
import App from './App.vue'

try {
  const s = JSON.parse(localStorage.getItem('mapper_settings'))
  if (s?.theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark')
} catch {}

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
