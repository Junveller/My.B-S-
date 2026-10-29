import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// `--mode artifact`: claude.ai 페이지로 열 수 있게 한 파일로 묶는 빌드 (서비스 워커 없음)
export default defineConfig(({ mode }) => ({
  base: mode === 'artifact' ? './' : '/',
  build: mode === 'artifact'
    ? { outDir: 'dist-artifact', assetsInlineLimit: 100_000_000, rollupOptions: { output: { inlineDynamicImports: true } } }
    : undefined,
  plugins: [
    react(),
    VitePWA({
      disable: mode === 'artifact',
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Bisje',
        short_name: 'Bisje',
        description: '개인 일정관리 플래너',
        lang: 'ko',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#F4F4F2',
        theme_color: '#F4F4F2',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
}));
