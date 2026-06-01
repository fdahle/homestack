import { defineStore } from 'pinia'

export const useStyleStore = defineStore('style', {
  state: () => ({
    colorMode: 'category', // 'marker' | 'category' | 'collection'
  }),
})
