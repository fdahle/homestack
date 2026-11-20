import { createApp } from 'vue';
import './i18n.js';
import './icons.js';
import App from './App.vue';
import { router } from './router.js';
import './kit/tokens.css';
import './kit/base.css';
import './style.css';

createApp(App).use(router).mount('#app');

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
