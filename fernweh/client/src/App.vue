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

/* Colours, radii and shadows: kit/tokens.css and theme.css (imported in main.js) */
:root {
  --sat: env(safe-area-inset-top, 0px);
  --sar: env(safe-area-inset-right, 0px);
  --sab: env(safe-area-inset-bottom, 0px);
  --sal: env(safe-area-inset-left, 0px);
}

body {
  font-family: var(--font);
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
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
}
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
input:focus-visible, textarea:focus-visible, select:focus-visible { outline: none; }
a { color: var(--accent); }

label {
  display: block;
  font-size: 12.5px;
  font-weight: 550;
  color: var(--text-2);
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
  border-radius: 999px;
  box-shadow: var(--shadow-lg);
  font-size: 13px;
  text-align: center;
}
.app-banner a { color: inherit; font-weight: 700; }
</style>
