<template>
  <RouterView />
  <!-- Writes rejected with 401 keep the page; signing in elsewhere renews the shared cookie. -->
  <div v-if="route.meta.requiresAuth && authStore.sessionExpired" class="app-banner" role="alert">
    Session expired — <a href="/login" target="_blank" rel="noopener">sign in</a> in a new tab, then save again.
  </div>
  <div v-else-if="route.meta.requiresAuth && authStore.offline" class="app-banner" role="status">
    Offline — the server can’t be reached right now.
  </div>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { useAuthStore } from './stores/auth.js'

const authStore = useAuthStore()
const route = useRoute()

function onVisible() {
  if (document.hidden) return
  authStore.invalidateSession()
  authStore.recheck()
}
const onOnline = () => authStore.recheck()

onMounted(() => {
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onOnline)
})
onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisible)
  window.removeEventListener('online', onOnline)
})
</script>

<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* Disable tap flash on touch devices */
* { -webkit-tap-highlight-color: transparent; }

/* Remove 300ms click delay on touch devices */
button, a, [role="button"] { touch-action: manipulation; }

:root {
  --sat: env(safe-area-inset-top, 0px);
  --sar: env(safe-area-inset-right, 0px);
  --sab: env(safe-area-inset-bottom, 0px);
  --sal: env(safe-area-inset-left, 0px);
  --bg: #f8f9fa;
  --surface: #ffffff;
  --surface-2: #f1f3f5;
  --border: #dee2e6;
  --text: #212529;
  --text-2: #6c757d;
  --accent: #3b82f6;
  --accent-hover: #2563eb;
  --danger: #ef4444;
  --danger-hover: #dc2626;
  --radius: 8px;
  --shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08);
  --shadow-lg: 0 4px 16px rgba(0,0,0,0.12);
}

[data-theme="dark"] {
  --bg: #1a1b1e;
  --surface: #25262b;
  --surface-2: #2c2e33;
  --border: #373a40;
  --text: #c9cdd4;
  --text-2: #868e96;
  --accent: #4dabf7;
  --accent-hover: #339af0;
  --danger: #ff6b6b;
  --danger-hover: #fa5252;
  --shadow: 0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2);
  --shadow-lg: 0 4px 16px rgba(0,0,0,0.4);
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
  line-height: 1.5;
}

button {
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
  border: none;
  border-radius: var(--radius);
  padding: 7px 14px;
  transition: background 0.15s, opacity 0.15s;
}

button:disabled { opacity: 0.5; cursor: not-allowed; }

input, textarea, select {
  font-family: inherit;
  font-size: 14px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  outline: none;
  transition: border-color 0.15s;
}

input:focus, textarea:focus, select:focus {
  border-color: var(--accent);
}

label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 4px;
}
.app-banner {
  position: fixed;
  top: calc(8px + var(--sat, 0px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 5000;
  max-width: calc(100% - 24px - var(--sal, 0px) - var(--sar, 0px));
  padding: 8px 14px;
  background: var(--text);
  color: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  font-size: 13px;
  text-align: center;
}
.app-banner a { color: inherit; font-weight: 700; }
</style>
