<template>
  <div class="shortcuts-backdrop" @click.self="$emit('close')" @keydown.escape.window="$emit('close')">
    <div class="shortcuts-modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div class="shortcuts-header">
        <h2 class="shortcuts-title">Keyboard Shortcuts</h2>
        <button class="shortcuts-close" title="Close" @click="$emit('close')">
          <AppIcon name="x" :size="16" />
        </button>
      </div>
      <div class="shortcuts-body">
        <table class="shortcuts-table">
          <tbody>
            <tr v-for="s in shortcuts" :key="s.action">
              <td class="shortcuts-keys">
                <kbd v-for="k in s.keys" :key="k" class="shortcuts-kbd">{{ k }}</kbd>
              </td>
              <td class="shortcuts-action">{{ s.action }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup>
import AppIcon from './AppIcon.vue'

defineEmits(['close'])

const mod = navigator.userAgent?.includes('Mac') ? '⌘' : 'Ctrl'

const shortcuts = [
  { keys: [mod, 'N'],      action: 'New note' },
  { keys: [mod, '⇧', 'N'], action: 'New task' },
  { keys: [mod, '/'],      action: 'Focus search' },
  { keys: ['Esc'],         action: 'Close modal / clear search' },
  { keys: ['?'],           action: 'Open this reference' },
]
</script>

<style scoped>
.shortcuts-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.shortcuts-modal {
  background: var(--surface);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  width: 380px;
  max-width: calc(100vw - 2rem);
  overflow: hidden;
}

.shortcuts-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem 0.75rem;
  border-bottom: 1px solid var(--border);
}

.shortcuts-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.shortcuts-close {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.25rem;
  color: var(--text-3);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.shortcuts-close:hover { background: var(--surface-3); }

.shortcuts-body {
  padding: 0.75rem 1.25rem 1.25rem;
}

.shortcuts-table {
  width: 100%;
  border-collapse: collapse;
}

.shortcuts-table tr + tr td {
  border-top: 1px solid var(--border);
}

.shortcuts-keys {
  padding: 0.6rem 0.75rem 0.6rem 0;
  white-space: nowrap;
  width: 1%;
}

.shortcuts-action {
  padding: 0.6rem 0;
  font-size: 0.875rem;
  color: var(--text-2);
}

.shortcuts-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.6rem;
  height: 1.6rem;
  padding: 0 0.4rem;
  background: var(--surface-3);
  border: 1px solid var(--border-2);
  border-bottom-width: 2px;
  border-radius: 4px;
  font-size: 0.78rem;
  font-family: inherit;
  color: var(--text-1);
  font-weight: 500;
}
.shortcuts-kbd + .shortcuts-kbd {
  margin-left: 0.25rem;
}
</style>
