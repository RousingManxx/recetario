/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // En GitHub Pages la app vive en /<repositorio>/; el workflow define BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Recetario — Gestión de pastelería',
        short_name: 'Recetario',
        description: 'Recetas, costos, pedidos y ganancias de tu pastelería.',
        lang: 'es-MX',
        theme_color: '#f6efe6',
        background_color: '#f6efe6',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  test: { environment: 'node', include: ['src/tests/**/*.test.ts'] },
})
