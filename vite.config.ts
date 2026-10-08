import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// BASE_PATH erlaubt das Hosting in einem Unterverzeichnis (z. B. GitHub Pages: /retro-player/)
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: base,
        name: 'Retro Player für Spotify',
        short_name: 'Retro Player',
        description:
          'Spotify über fotorealistische Retro-Geräte hören: Plattenspieler, Boombox, Receiver, Walkman und Discman.',
        lang: 'de',
        start_url: base,
        scope: base,
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'any',
        background_color: '#0b0a09',
        theme_color: '#0b0a09',
        categories: ['music', 'entertainment'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Texturen & HDRIs: groß, ändern sich nie → Cache-First
            urlPattern: ({ url }) => url.pathname.includes('/assets/textures/') || url.pathname.includes('/assets/hdri/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'retro-assets',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            // Album-Cover vom Spotify-CDN
            urlPattern: ({ url }) => url.hostname === 'i.scdn.co',
            handler: 'CacheFirst',
            options: {
              cacheName: 'album-art',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
