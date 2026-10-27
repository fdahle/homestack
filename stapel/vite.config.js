import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: 'web',
  plugins: [vue()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    // `npm run dev` (API on :3000) + `npm run dev:web` (this, with hot reload)
    proxy: { '/api': 'http://localhost:3000', '/covers': 'http://localhost:3000' },
  },
});
