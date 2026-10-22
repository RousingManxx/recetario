// E2E del respaldo en Google Drive con Google y Drive SIMULADOS (no toca ninguna cuenta real).
// Requiere un build con un Client ID cualquiera:
//   $env:VITE_GOOGLE_CLIENT_ID='prueba.apps.googleusercontent.com'; npx vite build ; npx vite preview --port 4173 ; node e2e/drive.mjs
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:4173/'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const errors = []
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); if (!ok) failed++ }

/* Google simulado. Modos: ok | revoked (Client ID revocado) | needs-click (la ventana solo se permite con un clic reciente y el acceso siempre queda «viejo»). */
const GIS = (mode) => {
  window.__gis = { mode }
  window.google = { accounts: { oauth2: {
    initTokenClient: (c) => ({ requestAccessToken: () => setTimeout(() => {
      const m = window.__gis.mode
      if (m === 'revoked') return c.callback({ error: 'invalid_client' })
      if (m === 'needs-click' && !navigator.userActivation.isActive) return c.error_callback({ type: 'popup_failed_to_open' })
      c.callback({ access_token: 'tok', expires_in: m === 'needs-click' ? 200 : 3600 })
    }, 10) }),
    revoke() {},
  } } }
}

/* Drive simulado y compartido por todos los «dispositivos». */
const drive = { files: new Map(), n: 0, calls: 0 }
const meta = (f) => ({ id: f.id, version: String(f.version), modifiedTime: new Date().toISOString(), appProperties: f.appProperties })
async function route(r) {
  drive.calls++
  const req = r.request(), url = new URL(req.url()), m = req.method()
  const cors = { 'access-control-allow-origin': '*' }
  const ok = (b) => r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(b) })
  if (m === 'OPTIONS') { drive.calls--; return r.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } }) }
  if (url.pathname.startsWith('/upload/')) {
    const body = req.postData() ?? '', b = body.slice(2, body.indexOf('\r\n'))
    const [mt, ct] = body.split('--' + b).slice(1, 3).map((p) => p.slice(p.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, ''))
    const id = m === 'POST' ? 'f' + ++drive.n : url.pathname.split('/').pop()
    const prev = drive.files.get(id)
    const f = { id, name: m === 'POST' ? JSON.parse(mt).name : prev.name, version: (prev?.version ?? 0) + 1, appProperties: JSON.parse(mt).appProperties, content: ct }
    drive.files.set(id, f)
    return ok(meta(f))
  }
  if (url.pathname === '/drive/v3/files') return ok({ files: [...drive.files.values()].map(meta) })
  const f = drive.files.get(url.pathname.split('/').pop())
  if (!f) return r.fulfill({ status: 404, headers: cors, body: '{}' })
  return url.searchParams.get('alt') === 'media' ? r.fulfill({ status: 200, headers: cors, body: f.content }) : ok(meta(f))
}
const only = () => [...drive.files.values()][0]
const ingredientsIn = (f) => JSON.parse(f.content).ingredients.map((i) => i.name)

/** Un «dispositivo»: contexto de navegador propio (almacenamiento aparte) con Google simulado en el modo indicado. */
async function device(mode = 'ok') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-MX', timezoneId: 'America/Mexico_City', acceptDownloads: true })
  await ctx.addInitScript(GIS, mode)
  await ctx.route('https://www.googleapis.com/**', route)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  return { ctx, page }
}
const sheet = (p) => p.locator('[role=dialog]').last()
async function addIngredient(p, name) {
  await p.getByRole('button', { name: 'Crear nuevo' }).click()
  await p.getByRole('menuitem', { name: 'Nuevo ingrediente' }).click()
  const s = sheet(p)
  await s.getByPlaceholder('Chocolate semiamargo').fill(name)
  await s.getByPlaceholder('1', { exact: true }).fill('1')
  await s.locator('select').nth(1).selectOption('kg')
  await s.getByPlaceholder('180').fill('180')
  await s.getByRole('button', { name: 'Guardar', exact: true }).click()
  await p.locator('[role=dialog]').waitFor({ state: 'hidden' })
  await p.waitForTimeout(300)
}
async function start(p, business) {
  await p.goto(BASE)
  await p.waitForURL(/#\/inicio/)
  await p.getByPlaceholder('Dulce Rosa').fill(business)
  await p.getByRole('button', { name: 'Siguiente' }).click()
}
const ajustes = async (p) => { await p.goto(BASE + '#/ajustes'); await p.getByText('Copia de seguridad (JSON)').waitFor() }
const waitVersion = async (p, v) => { for (let i = 0; i < 40 && (only()?.version ?? 0) < v; i++) await p.waitForTimeout(250); return only()?.version }
const hasText = (p, t, ms = 8000) => p.getByText(t, { exact: typeof t === 'string' }).first().waitFor({ timeout: ms }).then(() => true, () => false)

/* ── Dispositivo A ───────────────────────────────────────────────────────── */
const { page: A } = await device()
await start(A, 'Dulce Rosa')
await addIngredient(A, 'Chocolate')
await ajustes(A)
check('A: la sección de Drive aparece con Client ID', await A.getByRole('button', { name: 'Conectar Google Drive' }).count() === 1)
await A.getByRole('button', { name: 'Conectar Google Drive' }).click()
await A.getByText(/todo respaldado/).waitFor({ timeout: 20000 })
check('A: primer respaldo subido con nombre fijo', drive.files.size === 1 && only().version === 1 && only().name === 'recetario-dulce-rosa.json', only()?.name)

await addIngredient(A, 'Azúcar glass')
await ajustes(A)
check('A: tras el cambio dice "hay cambios por subir"', await A.getByText(/hay cambios por subir/).count() === 1)
await A.getByRole('button', { name: 'Sincronizar ahora' }).click()
check('A: sincronizar actualiza el MISMO archivo (v2, un solo archivo)', await waitVersion(A, 2) === 2 && drive.files.size === 1)
check('A: el archivo contiene los dos ingredientes', ingredientsIn(only()).sort().join() === 'Azúcar glass,Chocolate')

/* ── Dispositivo B: nuevo y vacío ────────────────────────────────────────── */
const { page: B } = await device()
await B.goto(BASE); await B.waitForURL(/#\/inicio/)
await ajustes(B)
await B.getByRole('button', { name: 'Conectar Google Drive' }).click()
check('B: dispositivo vacío ofrece traer la copia de Drive', await hasText(B, /Hay una copia de tu pastelería en Google Drive/, 20000))
check('B: no subió nada sobre la copia de Drive', only().version === 2)
await B.getByRole('button', { name: 'Traer la copia de Drive' }).click()
await B.getByText(/todo respaldado/).waitFor({ timeout: 20000 })
await B.goto(BASE + '#/ingredientes')
check('B: trajo los datos (Chocolate y Azúcar glass)', await hasText(B, 'Chocolate') && await hasText(B, 'Azúcar glass'))
await ajustes(B)
check('B: quedó en sincronía, sin avisos', await B.getByText(/Hay una copia|tienen cambios distintos/).count() === 0)

/* ── A cambia; B se entera ───────────────────────────────────────────────── */
await addIngredient(A, 'Harina')
await ajustes(A)
await A.getByRole('button', { name: 'Sincronizar ahora' }).click()
check('A: segundo cambio sube a v3', await waitVersion(A, 3) === 3)
await B.reload()
check('B: al abrir avisa "copia más nueva"', await hasText(B, /Hay una copia más nueva en Google Drive/, 20000))
await B.getByRole('button', { name: 'Ahora no' }).click()
check('B: "Ahora no" oculta el aviso', await B.getByText(/Hay una copia más nueva/).count() === 0)
await B.reload()
await B.getByText(/Hay una copia más nueva en Google Drive/).waitFor({ timeout: 20000 })
await B.getByRole('button', { name: 'Traer la copia de Drive' }).click()
await B.getByRole('button', { name: 'Traer de Drive' }).click()
await B.getByText(/Copia de Google Drive restaurada/).waitFor({ timeout: 20000 })
await B.goto(BASE + '#/ingredientes')
check('B: tras "Traer" ya tiene Harina', await hasText(B, 'Harina'))

/* ── Conflicto: ambos cambian ────────────────────────────────────────────── */
await addIngredient(B, 'Solo en B')
await addIngredient(A, 'Solo en A')
await ajustes(A)
await A.getByRole('button', { name: 'Sincronizar ahora' }).click()
check('A: sube su cambio (v4)', await waitVersion(A, 4) === 4)
await B.reload()
check('B: con cambios en ambos lados ofrece Combinar / Subir la mía / Usar la de Drive', await hasText(B, /tienen cambios distintos/, 20000) && await B.getByRole('button', { name: 'Combinar' }).count() === 1)
check('B: no sobrescribió Drive (sigue v4)', only().version === 4)
await B.getByRole('button', { name: 'Combinar' }).click()
await B.goto(BASE + '#/ingredientes')
check('B: combinar conserva lo suyo y suma lo de A', await hasText(B, 'Solo en B') && await hasText(B, 'Solo en A'))
await ajustes(B)
await B.getByRole('button', { name: 'Sincronizar ahora' }).click()
check('B: lo combinado se sube (v5) con ambos cambios', await waitVersion(B, 5) === 5 && ingredientsIn(only()).includes('Solo en A') && ingredientsIn(only()).includes('Solo en B'))

/* ── «Borrar todos los datos» no sube una copia vacía ────────────────────── */
await ajustes(A)
await A.getByRole('button', { name: 'Borrar todos los datos' }).click()
await A.getByRole('button', { name: 'Borrar todo', exact: true }).click()
await A.getByRole('button', { name: 'Sí, borrar todo' }).click()
await A.waitForTimeout(800)
const antes = only().content
await ajustes(A)
await A.getByRole('button', { name: 'Sincronizar ahora' }).click()
check('A: tras borrar todo, Drive NO recibe una copia vacía', await hasText(A, /Hay una copia de tu pastelería en Google Drive/, 20000) && only().content === antes && only().version === 5)

/* ── Client ID revocado ──────────────────────────────────────────────────── */
drive.files.clear() // otra persona con su propia cuenta de Google y su propio Drive
const callsAntes = drive.calls
const { page: C } = await device('revoked')
await start(C, 'Pastelería C')
await addIngredient(C, 'Dato local C')
await ajustes(C)
await C.getByRole('button', { name: 'Conectar Google Drive' }).click()
check('C (Client ID revocado): avisa que el respaldo está inhabilitado', await hasText(C, /Respaldo en Drive inhabilitado/, 10000))
check('C: no hubo ninguna petición a Drive', drive.calls === callsAntes)
await C.goto(BASE + '#/ingredientes')
check('C: la app y sus datos siguen funcionando', await hasText(C, 'Dato local C'))
await ajustes(C)
check('C: sigue disponible la copia manual', await C.getByRole('button', { name: 'Descargar copia' }).count() === 1)
await C.evaluate(() => { window.__gis.mode = 'ok' }) // «se corrigió la configuración»
await C.getByRole('button', { name: 'Reintentar' }).click()
check('C: tras corregir, "Reintentar" conecta y respalda', await hasText(C, /todo respaldado/, 20000) && drive.files.size === 1 && ingredientsIn(only()).includes('Dato local C'))

/* ── Renovación del acceso con un clic ───────────────────────────────────── */
drive.files.clear() // otra persona con su propia cuenta de Google y su propio Drive
const { page: E } = await device('needs-click')
await start(E, 'Pastelería E')
await addIngredient(E, 'Dato E')
await ajustes(E)
await E.getByRole('button', { name: 'Conectar Google Drive' }).click()
const okE = await hasText(E, /todo respaldado/, 20000)
check('E: el primer respaldo se sube (la ventana se permite justo tras el clic)', okE && drive.files.size === 1 && only().version === 1,
  okE ? '' : `archivos en Drive: ${drive.files.size}; pantalla: ${(await E.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 500)}`)
await addIngredient(E, 'Otro dato E')
// OJO: Playwright ejecuta sus consultas (count, waitFor…) como un gesto del usuario y mantendría viva la «activación», así
// que se espera pasivamente (sin sondear) a que venza el minuto de espera y falle la renovación automática.
await E.waitForTimeout(68000)
const aviso = await hasText(E, /necesita renovar el acceso/, 5000)
check('E: con la ventana bloqueada sin clic aparece el aviso de renovar', aviso)
check('E: mientras tanto el cambio sigue sin subirse', only().version === 1)
await E.mouse.click(300, 600) // un clic cualquiera, no en el aviso
await E.waitForFunction(() => !document.body.innerText.includes('necesita renovar el acceso'), null, { timeout: 15000 }).catch(() => {})
await E.waitForTimeout(1500)
check('E: un clic cualquiera renueva el acceso y sube el cambio pendiente (v2)', !(await E.getByText(/necesita renovar el acceso/).count()) && await waitVersion(E, 2) === 2 && ingredientsIn(only()).includes('Otro dato E'))

// Los 404 son esperados: al vaciar el Drive simulado, un dispositivo pregunta por un archivo que ya no existe y la app lo tolera.
const real = errors.filter((e) => !/status of 404/.test(e))
check('sin errores de consola/página', real.length === 0, real.slice(0, 3).join(' | '))
await browser.close()
console.log(failed ? `\n${failed} comprobación(es) FALLARON` : '\nTodas las comprobaciones pasaron')
process.exit(failed ? 1 : 0)
