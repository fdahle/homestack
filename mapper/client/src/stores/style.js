import { defineStore } from 'pinia'

const SETTINGS_KEY = 'mapper_settings'

function loadColorMode() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}').colorMode ?? 'category'
  } catch { return 'category' }
}

export const useStyleStore = defineStore('style', {
  state: () => ({
    colorMode: loadColorMode(),
  }),
  actions: {
    setColorMode(mode) {
      this.colorMode = mode
      try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
        s.colorMode = mode
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
      } catch {}
    },
  },
})
