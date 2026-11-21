import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Haken works offline: the service worker keeps the app itself (every built file) on the
// device. This writes dist/sw.js from web/sw.js with the list of those files, and a version
// that changes with them, so a new build replaces the old copy.
function serviceWorker() {
  return {
    name: 'haken-service-worker',
    apply: 'build',
    // After Vite's own plugins, so index.html is in the bundle too
    enforce: 'post',
    generateBundle(options, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map')).map((f) => `/${f}`);
      const files = [...built, '/manifest.webmanifest', '/icon.svg', '/icon-192.png'];
      const version = createHash('sha256').update(built.join('\n')).digest('hex').slice(0, 12);
      const source = readFileSync(new URL('./web/sw.js', import.meta.url), 'utf8')
        .replace('__FILES__', JSON.stringify(files))
        .replace('__VERSION__', version);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  root: 'web',
  plugins: [vue(), serviceWorker()],
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: {
    port: 5173,
    // `npm run dev` (API on :3073) + `npm run dev:web` (this, with hot reload)
    proxy: { '/api': 'http://localhost:3073', '/ics': 'http://localhost:3073' },
  },
});
