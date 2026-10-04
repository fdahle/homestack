import { defineStore } from 'pinia'

import { loadSettings, saveSettings } from '../utils/settings.js'

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
