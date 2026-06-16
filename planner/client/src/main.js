import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router/index.js'
import App from './App.vue'
import AppIcon from './components/AppIcon.vue'

const app = createApp(App)
app.component('AppIcon', AppIcon)
app.use(createPinia())
app.use(router)
app.mount('#app')
