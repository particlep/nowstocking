import { cloudflare } from '@cloudflare/vite-plugin';
import preact from '@preact/preset-vite';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// The number of commits on the current branch, so each commit gets the next version number. Needs the full git
// history (CI checks out with fetch-depth: 0); outside a git checkout it falls back to "dev".
function commitCount(): string {
  try {
    return execSync('git rev-list --count HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  // Shown on the sign-in screen and in More, so we can tell which version a phone is running.
  define: { __APP_VERSION__: JSON.stringify(commitCount()) },
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
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,wasm}'],
        // The OCR engine is ~7 MB: cached the first time someone scans text, not on install.
        globIgnores: ['ocr/**'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/cdn-cgi\//],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // Part photos never change once stored (a new photo gets a new id), so keep every one that's been shown.
        // Thumbnails in search then work offline too.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/ocr/'),
            handler: 'CacheFirst',
            options: { cacheName: 'ocr-engine', cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: ({ url }) => /^\/api\/w\/[^/]+\/photos\/[^/]+\/(full|thumb)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'part-photos',
              expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
});
