/// <reference types="vitest/config" />
import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

function version() {
  let sha = process.env.GITHUB_SHA?.slice(0, 7)
  if (!sha) { try { sha = execSync('git rev-parse --short HEAD').toString().trim() } catch { sha = 'local' } }
  return `${sha} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version()) },
  // En GitHub Pages la app vive en /<repositorio>/; el workflow define BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      workbox: { skipWaiting: true, clientsClaim: true },
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
