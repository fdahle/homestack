import { defineStore } from 'pinia'

import { loadSettings, saveSettings } from '../utils/settings.js'

export const useStyleStore = defineStore('style', {
  state: () => {
    const s = loadSettings()
    return {
      colorMode: s.colorMode ?? 'category',
      firstNameOnly: s.firstNameOnly ?? false,
      showRatings: s.showRatings ?? true,
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
    // Only hides ratings and favorites; stored values are kept and come back when switched on again.
    setShowRatings(v) {
      this.showRatings = v
      saveSettings({ showRatings: v })
    },
  },
})
