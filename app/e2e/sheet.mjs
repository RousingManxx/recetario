// Los paneles (Sheet) deben quedar SOBRE la pantalla aunque la página esté desplazada, en teléfono y en escritorio; y en escritorio el menú «+» no
// debe encimarse con la barra de pestañas lateral.
// Regresión: la animación de entrada de `.page` (fill-mode `both`) volvía a la página el «marco» del `position: fixed`, y los paneles que se abren
// desde dentro de una página (Ajustes → Ver formato, Finanzas → cifras clave) aparecían al fondo del contenido, fuera de la pantalla.
// Uso: npx vite build ; npx vite preview --port 4173 ; node e2e/sheet.mjs
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:4173/'
const browser = await chromium.launch({ channel: 'msedge' })
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); if (!ok) failed++ }

async function session(opts) {
  const ctx = await browser.newContext({ locale: 'es-MX', timezoneId: 'America/Mexico_City', ...opts })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(BASE)
  await page.waitForURL(/#\/inicio/)
  await page.goto(BASE + '#/ajustes'); await page.getByText('Copia de seguridad (JSON)').waitFor()
  await page.getByRole('button', { name: 'Cargar ejemplos' }).click(); await page.waitForTimeout(1500)
  return { ctx, page, errors }
}

const geometry = (page) => page.evaluate(() => {
  const vh = window.innerHeight, wrap = document.querySelector('.sheet-wrap'), sheet = document.querySelector('.sheet')
  if (!wrap || !sheet) return null
  const w = wrap.getBoundingClientRect(), s = sheet.getBoundingClientRect(), scrim = document.querySelector('.sheet-wrap .scrim').getBoundingClientRect()
  return { vh, vw: document.documentElement.clientWidth, scrollY: Math.round(window.scrollY), wrapTop: Math.round(w.top), wrapH: Math.round(w.height), sheetTop: Math.round(s.top), sheetBottom: Math.round(s.bottom), scrimW: Math.round(scrim.width), scrimH: Math.round(scrim.height), inBody: wrap.parentElement === document.body }
})

/**
 * Abre un panel tocando `trigger()` y comprueba que cubre la pantalla, se ve completo, el fondo cubre todo y la página no salta.
 * El usuario primero se desplaza hasta el botón (eso no cuenta); lo que se mide es el desplazamiento al abrir el panel.
 */
async function probe(label, page, trigger, pre) {
  if (pre) await pre()
  const el = trigger()
  await el.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  const before = await page.evaluate(() => Math.round(window.scrollY))
  await el.click()
  await page.waitForTimeout(700)
  const after = await page.evaluate(() => Math.round(window.scrollY))
  const g = await geometry(page)
  check(`${label}: se abre el panel`, !!g)
  if (!g) return
  check(`${label}: el contenedor cubre exactamente la pantalla`, g.wrapTop === 0 && Math.abs(g.wrapH - g.vh) <= 1, `top ${g.wrapTop}, alto ${g.wrapH} de ${g.vh}`)
  check(`${label}: el panel se ve completo, sin desplazarse`, g.sheetTop >= 0 && g.sheetBottom <= g.vh + 1, `${g.sheetTop}–${g.sheetBottom} de ${g.vh}`)
  check(`${label}: el fondo oscuro cubre toda la pantalla`, Math.abs(g.scrimW - g.vw) <= 1 && Math.abs(g.scrimH - g.vh) <= 1, `${g.scrimW}×${g.scrimH} de ${g.vw}×${g.vh}`)
  check(`${label}: abrirlo no desplaza la página de atrás`, after === before, `${before} -> ${after}`)
  check(`${label}: cuelga de body`, g.inBody)
}
const close = async (page) => { await page.getByRole('button', { name: 'Cerrar' }).first().click(); await page.waitForTimeout(300) }

/* ── Teléfono ── */
{
  const { ctx, page, errors } = await session({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.goto(BASE + '#/ajustes'); await page.waitForTimeout(600)
  await probe('teléfono · Ajustes → Ver formato', page, () => page.getByRole('button', { name: 'Ver formato' }))
  await close(page)
  await page.goto(BASE + '#/finanzas'); await page.waitForTimeout(1200)
  await probe('teléfono · Finanzas → cifra clave', page, () => page.locator('.page button').filter({ hasText: /Ingresos por ventas|Gastos operativos|Costos de producción/ }).first())
  await close(page)
  await page.goto(BASE + '#/ingredientes'); await page.waitForTimeout(800)
  await probe('teléfono · formulario «Nuevo ingrediente»', page, () => page.getByRole('menuitem', { name: 'Nuevo ingrediente' }), () => page.getByRole('button', { name: 'Crear nuevo' }).click())
  check('teléfono: sin errores de consola/página', errors.length === 0, errors.slice(0, 2).join(' | '))
  await ctx.close()
}

/* ── Escritorio ── */
{
  const { ctx, page, errors } = await session({ viewport: { width: 1280, height: 800 } })
  await page.goto(BASE + '#/ajustes'); await page.waitForTimeout(600)
  await probe('escritorio · Ajustes → Ver formato', page, () => page.getByRole('button', { name: 'Ver formato' }))
  const g = await geometry(page)
  const w = await page.locator('.sheet').evaluate((e) => { const b = e.getBoundingClientRect(); return { w: Math.round(b.width), mid: Math.round((b.left + b.right) / 2) } })
  check('escritorio: el panel respeta su ancho máximo (640) y queda centrado', !!g && w.w <= 640 && Math.abs(w.mid - g.vw / 2) <= 2, `${w.w}px, centro ${w.mid} de ${g?.vw}`)
  await close(page)
  await page.goto(BASE + '#/'); await page.waitForTimeout(900)
  await page.getByRole('button', { name: 'Crear nuevo' }).click(); await page.waitForTimeout(400)
  const m = await page.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom) } }; return { menu: r('.menu'), tabbar: r('.tabbar') } })
  check('escritorio: el menú «+» se abre a la derecha de la barra lateral, sin encimarse', !!m.menu && !!m.tabbar && m.menu.l >= m.tabbar.r, m.menu ? `menú desde ${m.menu.l}, barra hasta ${m.tabbar.r}` : '')
  check('escritorio: sin errores de consola/página', errors.length === 0, errors.slice(0, 2).join(' | '))
  await ctx.close()
}

await browser.close()
console.log(failed ? `\n${failed} comprobación(es) FALLARON` : '\nTodas las comprobaciones pasaron')
process.exit(failed ? 1 : 0)
