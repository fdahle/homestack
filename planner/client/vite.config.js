import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  envDir: '..',
  plugins: [
    vue(),
    nodePolyfills(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      // We manage manifest.json manually in public/
      manifest: false,
      registerType: 'autoUpdate',
      injectManifest: {
        // Precache all built assets; exclude source maps and the sw source itself
        globPatterns: ['**/*.{js,css,html,woff,woff2,ico,svg,png,webp}'],
        globIgnores: ['**/sw.js'],
      },
      devOptions: {
        // Enable SW in development for testing (served as classic script)
        enabled: false,
      },
    }),
  ],
  server: {
    host: false,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        // Strip the Basic-auth challenge so a 401 never pops the browser's
        // native sign-in dialog (mirrors the /db handling + prod nginx).
        configure(proxy) {
          proxy.on('proxyRes', (proxyRes) => {
            delete proxyRes.headers['www-authenticate']
          })
        },
      },
      '/db': {
        target: 'http://localhost:5984',
        rewrite: (path) => path.replace(/^\/db/, ''),
        configure(proxy) {
          proxy.on('proxyRes', (proxyRes) => {
            delete proxyRes.headers['www-authenticate']
          })
        },
      },
    },
  },
})
