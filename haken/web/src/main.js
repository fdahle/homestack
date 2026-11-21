import { createApp } from 'vue';
import './i18n.js';
import './icons.js';
import { restoreSession } from './session.js';
import App from './App.vue';
import { router } from './router.js';
import './kit/tokens.css';
import './kit/base.css';
import './style.css';

// Offline, the login check can't reach the server: start with the account this device knew
restoreSession(router);
createApp(App).use(router).mount('#app');

if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {});
