import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: 'web',
  plugins: [vue()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5172,
    // `npm run dev` (API on :3072) + `npm run dev:web` (this, with hot reload)
    proxy: { '/api': 'http://localhost:3072', '/covers': 'http://localhost:3072' },
  },
});
