import { createApp } from 'vue';
import './i18n.js';
import './icons.js';
import App from './App.vue';
import { router } from './router.js';
import './kit/tokens.css';
import './kit/base.css';
import './style.css';

createApp(App).use(router).mount('#app');

// Installable, for the share target on Android (web/public/sw.js keeps nothing offline)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
