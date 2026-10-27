import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  envDir: '..',
  plugins: [vue()],
  build: {
    modulePreload: { polyfill: false },
  },
  server: {
    host: true,
    port: 5163,
    proxy: {
      '/api': 'http://localhost:3063',
    },
  },
})
