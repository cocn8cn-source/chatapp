/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt', // never silently reload and destroy unsent drafts
      injectRegister: false,
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon-32.png', 'brand/logo-white.png', 'brand/logo-black.png'],
      manifest: {
        id: '/',
        name: 'ChatSpace — messages, calls, together',
        short_name: 'ChatSpace',
        description: 'Private conversations, group chats, media, voice notes and calls — installable from your browser.',
        // Always launch at the site root. iOS "Add to Home Screen" stores this exact URL.
        // The root route sends signed-in users to /app/chats and shows the welcome page
        // to everyone else, so one stable URL works for every state (and never 404s).
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
        orientation: 'any',
        background_color: '#FAF9F0',
        theme_color: '#FFD000',
        lang: 'en',
        dir: 'ltr',
        categories: ['social', 'communication', 'productivity'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Chats', short_name: 'Chats', url: '/app/chats', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Calls', short_name: 'Calls', url: '/app/calls', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Settings', short_name: 'Settings', url: '/app/settings', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        // Static shell only. Private API, realtime and storage responses are never cached.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        // Never answer these with the app shell: a missing hashed asset or the push worker
        // must fail honestly instead of returning HTML.
        navigateFallbackDenylist: [/^\/assets\//, /^\/push-sw\.js$/, /^\/sw\.js$/, /\.[a-z0-9]{2,5}$/i],
        importScripts: ['push-sw.js'],
        cleanupOutdatedCaches: true,
        runtimeCaching: [],
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
