import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router.js';
import './style.css';

createApp(App).use(router).mount('#app');

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
