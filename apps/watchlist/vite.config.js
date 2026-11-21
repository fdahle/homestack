import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: 'web',
  plugins: [vue()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5171,
    // `npm run dev` (API on :3071) + `npm run dev:web` (this, with hot reload)
    proxy: { '/api': 'http://localhost:3071', '/posters': 'http://localhost:3071' },
  },
});
