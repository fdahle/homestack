import { ref, watchEffect } from 'vue'

const STORAGE_KEY = 'theme'
const stored      = localStorage.getItem(STORAGE_KEY)
const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches

const theme = ref(stored || (prefersDark ? 'dark' : 'light'))

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t)
  localStorage.setItem(STORAGE_KEY, t)
}

watchEffect(() => applyTheme(theme.value))

export function useTheme() {
  function toggle() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
  }
  return { theme, toggle }
}
