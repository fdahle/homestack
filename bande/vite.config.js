import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: 'web',
  plugins: [vue()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5168,
    // `npm run dev` (API on :3068) + `npm run dev:web` (this, with hot reload)
    proxy: { '/api': 'http://localhost:3068', '/photos': 'http://localhost:3068', '/ics': 'http://localhost:3068' },
  },
});
