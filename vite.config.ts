import { cloudflare } from '@cloudflare/vite-plugin';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Shown on the sign-in screen and in More, so we can tell which version a phone is running.
  define: { __APP_VERSION__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  plugins: [
    preact(),
    cloudflare(),
    VitePWA({
      // A new version takes over in the background (skipWaiting + clientsClaim below) and is used from the next
      // page load. The open page is never reloaded for it, which would wipe half-done work such as a sign-in
      // waiting for its emailed code.
      registerType: 'prompt',
      // Access sits in front of the manifest too; send the session cookie when fetching it.
      useCredentials: true,
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'NowStocking',
        short_name: 'NowStocking',
        description: 'Parts inventory · find it, scan it, pull it.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f5f3ee',
        theme_color: '#f5f3ee',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/cdn-cgi\//],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
