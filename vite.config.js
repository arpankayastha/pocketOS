import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'eChopdo',
        short_name: 'eChopdo',
        description: 'eChopdo — the family chopdo, now digital: budget, dues, hisab, passwords and records in one safe place.',
        theme_color: '#1e2330',
        background_color: '#1e2330',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only — Supabase data always goes over the network, never cached.
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        globIgnores: ['download/**'],
        // The Android download page and Digital Asset Links are plain files, not the app.
        navigateFallbackDenylist: [/^\/download/, /^\/\.well-known/],
      },
    }),
  ],
})
