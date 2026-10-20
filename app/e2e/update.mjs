// Comprueba: SW activo, versión visible, y autoactualización al volver a primer plano.
import { chromium } from 'playwright-core'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }
// Servidor que lee de disco en cada petición (vite preview indexa al arrancar y no ve builds nuevos).
const server = http.createServer((req, res) => {
  let f = path.join('dist', decodeURIComponent(req.url.split('?')[0])); if (f.endsWith(path.sep) || !path.extname(f)) f = path.join('dist', 'index.html')
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end() } else { res.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(d) } })
}).listen(4180)
const log = (m) => console.log('✔', m)
const expect = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); log(m) }
const b = await chromium.launch({ channel: 'msedge' })
const ctx = await b.newContext({ viewport: { width: 390, height: 800 } })
const p = await ctx.newPage()
const errors = []
p.on('pageerror', (e) => errors.push(e.message))
await p.goto('http://localhost:4180/'); await p.waitForTimeout(1500)
await p.reload(); await p.waitForTimeout(800)
expect(await p.evaluate(() => !!navigator.serviceWorker.controller), 'Service worker activo y controlando la página')
await p.getByRole('link', { name: 'Salir' }).click().catch(() => {})
await p.goto('http://localhost:4180/#/ajustes'); await p.waitForTimeout(500)
const v1 = await p.locator('.kbd', { hasText: /UTC/ }).innerText()
expect(/UTC/.test(v1), 'Versión visible en Ajustes: ' + v1)
const fs16 = await p.evaluate(() => [...document.querySelectorAll('input,select,textarea')].every((e) => parseFloat(getComputedStyle(e).fontSize) >= 16))
expect(fs16, 'Todos los campos de Ajustes miden ≥ 16 px')

// nueva versión publicada mientras la app está abierta
await p.evaluate(() => { window.__marker = 'sin-recargar' })
fs.appendFileSync('src/index.css', '\n.e2e-update{outline:1px solid red}\n')
execSync('npm run build', { stdio: 'ignore' })
await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
await p.waitForFunction(() => window.__marker === undefined, null, { timeout: 15000 }).catch(() => {})
expect(await p.evaluate(() => window.__marker === undefined), 'La app detectó la versión nueva y se recargó sola')
fs.writeFileSync('src/index.css', fs.readFileSync('src/index.css', 'utf8').replace('\n.e2e-update{outline:1px solid red}\n', ''))
console.log(errors.length ? 'Errores:\n' + errors.join('\n') : '✔ sin errores de consola')
await b.close(); server.close()
