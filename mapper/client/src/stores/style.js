import { defineStore } from 'pinia'

const SETTINGS_KEY = 'mapper_settings'

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') } catch { return {} }
}

function saveSettings(patch) {
  try {
    const s = loadSettings()
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...s, ...patch }))
  } catch {}
}

export const useStyleStore = defineStore('style', {
  state: () => {
    const s = loadSettings()
    return {
      colorMode: s.colorMode ?? 'category',
      firstNameOnly: s.firstNameOnly ?? false,
    }
  },
  actions: {
    setColorMode(mode) {
      this.colorMode = mode
      saveSettings({ colorMode: mode })
    },
    setFirstNameOnly(v) {
      this.firstNameOnly = v
      saveSettings({ firstNameOnly: v })
    },
  },
})
