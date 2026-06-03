<template>
  <RouterView />
</template>

<script setup>
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import { useAuthStore } from './stores/auth.js'

const authStore = useAuthStore()

onMounted(() => {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) authStore.invalidateSession()
  })
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
</style>
