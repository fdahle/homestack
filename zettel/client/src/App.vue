<template>
  <RouterView />

  <!-- SW update banner -->
  <Transition name="pwa-banner">
    <div v-if="needRefresh" class="pwa-update-banner">
      <span>A new version is available.</span>
      <button @click="updateServiceWorker()">Reload</button>
      <button class="pwa-dismiss" @click="needRefresh = false" aria-label="Dismiss">✕</button>
    </div>
  </Transition>
</template>

<script setup>
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { useTheme } from './composables/useTheme.js'

const { needRefresh, updateServiceWorker } = useRegisterSW()
useTheme() // initialise theme from localStorage on first load
</script>

<style>
/* ── Design tokens ───────────────────────────────────────────────────────── */
:root {
  --bg:           #f5f5f5;
  --surface:      #ffffff;
  --surface-2:    #f8f9fa;
  --surface-3:    #f1f3f4;
  --border:       #e0e0e0;
  --border-2:     #c9cdd4;
  --text-1:       #202124;
  --text-2:       #3c4043;
  --text-3:       #5f6368;
  --text-muted:   #9aa0a6;
  --accent:       #1a73e8;
  --accent-h:     #1765cc;
  --accent-bg:    #e8f0fe;
  --accent-text:  #1a56db;
  --danger:       #d93025;
  --danger-bg:    #fce8e6;
  --danger-bdr:   #f5c6c3;
  --panel:        #ebecf0;
  --panel-h:      #dde0e6;
  --warning:      #7a5f00;
  --warning-bg:   #fef7e0;
  --success:      #137333;
  --success-bg:   #e6f4ea;
  --bulk-bg:      #202124;
  --bulk-text:    #ffffff;
}
:root[data-theme="dark"] {
  --bg:           #111113;
  --surface:      #1c1c20;
  --surface-2:    #242428;
  --surface-3:    #2c2c32;
  --border:       #38383f;
  --border-2:     #4a4a55;
  --text-1:       #e8e8ea;
  --text-2:       #c0c0c8;
  --text-3:       #8f8fa0;
  --text-muted:   #60607a;
  --accent:       #6aabff;
  --accent-h:     #8ac0ff;
  --accent-bg:    #1a2f4a;
  --accent-text:  #6aabff;
  --danger:       #f28b82;
  --danger-bg:    #3c1f1e;
  --danger-bdr:   #5c3030;
  --panel:        #252530;
  --panel-h:      #2f2f3c;
  --warning:      #e8b73a;
  --warning-bg:   #2d2200;
  --success:      #4caf72;
  --success-bg:   #0d2b1a;
  --bulk-bg:      #2d2d35;
  --bulk-text:    #e8e8ea;
}

*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--text-1);
}
</style>

<style scoped>
.pwa-update-banner {
  position: fixed;
  bottom: 1rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: #1e1b4b;
  color: #e0e7ff;
  border: 1px solid #4f46e5;
  border-radius: 0.5rem;
  padding: 0.65rem 1rem;
  font-size: 0.875rem;
  box-shadow: 0 4px 24px rgba(0,0,0,0.4);
  z-index: 9999;
  white-space: nowrap;
}

.pwa-update-banner button {
  background: #4f46e5;
  color: white;
  border: none;
  border-radius: 0.35rem;
  padding: 0.3rem 0.8rem;
  cursor: pointer;
  font-size: 0.85rem;
}

.pwa-update-banner button:hover { background: #4338ca; }

.pwa-update-banner .pwa-dismiss {
  background: transparent;
  color: #818cf8;
  padding: 0.3rem 0.4rem;
  font-size: 0.8rem;
}

.pwa-banner-enter-active,
.pwa-banner-leave-active { transition: opacity 0.25s, transform 0.25s; }
.pwa-banner-enter-from,
.pwa-banner-leave-to    { opacity: 0; transform: translateX(-50%) translateY(1rem); }
</style>
