// E2E: flujo completo de un usuario nuevo en el build de producción (vite preview en :4173).
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const log = (m) => console.log('✔', m)
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-MX', timezoneId: 'America/Mexico_City', acceptDownloads: true })
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'])
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const URL = 'http://localhost:4173/'
const sheet = page.locator('[role=dialog]').last()
const expect = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); log(m) }

await page.goto(URL)
await page.waitForURL(/#\/inicio/)
log('primer inicio abre la guía')
await page.getByPlaceholder('Dulce Rosa').fill('Dulce Rosa')
await page.getByRole('button', { name: 'Siguiente' }).click()

// Ingrediente: chocolate 1 kg $180
await page.getByRole('button', { name: 'Registrar un ingrediente real' }).click()
await sheet.getByPlaceholder('Chocolate semiamargo').fill('Chocolate')
await sheet.getByPlaceholder('1', { exact: true }).fill('1')
await sheet.locator('select').nth(1).selectOption('kg')
await sheet.getByPlaceholder('180').fill('180')
expect(await sheet.getByText('$18.00 por 100 g').count() === 1, 'Costo calculado: $18.00 por 100 g')
await sheet.getByRole('button', { name: 'Guardar', exact: true }).click()
// Segundo ingrediente: harina 1 kg $24
await page.getByRole('button', { name: 'Registrar un ingrediente real' }).click()
await sheet.getByPlaceholder('Chocolate semiamargo').fill('Harina')
await sheet.getByPlaceholder('1', { exact: true }).fill('1')
await sheet.locator('select').nth(1).selectOption('kg')
await sheet.getByPlaceholder('180').fill('24')
await sheet.getByRole('button', { name: 'Guardar', exact: true }).click()
log('2 ingredientes registrados')

// Receta
await page.getByRole('button', { name: 'Siguiente' }).click()
await page.getByRole('button', { name: 'Crear mi primera receta' }).click()
await sheet.getByPlaceholder('Pastel de chocolate').fill('Pastel de chocolate')
for (const [ing, q] of [['Chocolate', '200'], ['Harina', '250']]) {
  await sheet.getByRole('button', { name: '+ Agregar ingrediente' }).click()
  const card = sheet.locator('.card').filter({ has: page.getByLabel('Ingrediente', { exact: true }) }).last()
  await card.getByLabel('Ingrediente', { exact: true }).selectOption({ label: ing })
  await card.getByLabel('Cantidad', { exact: true }).fill(q)
}
await sheet.getByLabel('Porciones por unidad').fill('8')
await sheet.getByRole('tab', { name: '2 · Costos' }).click()
await sheet.getByLabel('Tarifa por hora (MXN)').fill('60')
await sheet.getByRole('tab', { name: '1 · Receta' }).click()
await sheet.getByLabel('Activo').fill('60')
await sheet.getByRole('tab', { name: '3 · Precio' }).click()
// chocolate 200g*0.18=36 + harina 250g*0.024=6 + mano de obra 60 = 102
expect(await sheet.getByText('$102.00').first().isVisible(), 'Costo total correcto: $36 + $6 + $60 de mano de obra = $102.00')
expect(await sheet.getByText('Recomendado: $255.00').count() === 1, 'Precio para margen 60 %: $255.00 (102 / 0.4)')
await sheet.getByRole('button', { name: /Usar precio recomendado/ }).click()
expect(await sheet.getByText('Recargo sobre costo').locator('..').getByText('150 %').count() === 1, 'Recargo 150 % ≠ margen 60 %')
await sheet.getByRole('button', { name: 'Guardar receta' }).click()

// Pedido
await page.getByRole('button', { name: 'Siguiente' }).click()
await page.getByRole('button', { name: 'Siguiente' }).click()
await page.getByRole('button', { name: 'Registrar mi primer pedido' }).click()
await sheet.getByRole('button', { name: '+ Nuevo' }).click()
await page.locator('[role=dialog]').last().getByLabel('Nombre', { exact: true }).fill('Ana Pérez')
await page.locator('[role=dialog]').last().getByRole('button', { name: 'Guardar' }).click()
await sheet.getByLabel('Cantidad').first().fill('2')
await sheet.getByRole('button', { name: 'Confirmar pedido' }).click()
await sheet.getByRole('button', { name: '+ Pago' }).click()
await sheet.getByLabel('Monto (MXN)').first().fill('200')
await sheet.getByRole('button', { name: 'Registrar', exact: true }).click()
await page.waitForTimeout(400); const txt = await sheet.innerText(); if (!txt.includes('$310.00')) console.log(txt.slice(-900))
expect(txt.includes('PED-0001'), 'Folio PED-0001 asignado')
expect(txt.includes('$510.00'), 'Total $510.00 (2 × $255)')
expect(txt.includes('$310.00'), 'Saldo pendiente $310.00 tras anticipo de $200')
expect(txt.includes('$306.00'), 'Ganancia estimada $306.00 (510 − 2×102)')
expect(txt.includes('Anticipo recibido') && await sheet.locator('.badge', { hasText: 'Confirmado' }).count() === 1, 'Estado de pago separado del de pedido')

// Congelado: subir precio del ingrediente no altera el pedido
await sheet.getByRole('button', { name: 'Cerrar', exact: true }).click()
await page.goto(URL + '#/ingredientes')
await page.locator('.item', { hasText: 'Chocolate' }).first().click()
await sheet.getByRole('button', { name: '+ Nueva compra' }).click()
await page.locator('[role=dialog]').last().getByPlaceholder('1', { exact: true }).fill('1')
await page.locator('[role=dialog]').last().locator('select').selectOption('kg'); await page.locator('[role=dialog]').last().getByPlaceholder('180').fill('360')
await page.locator('[role=dialog]').last().getByRole('button', { name: 'Guardar compra' }).click()
await page.waitForTimeout(300)
console.log((await page.locator('[role=dialog]').last().innerText()).slice(-500)); expect(await page.getByText('▲ 100.0 %').count() >= 1, 'Historial de precios muestra alza de 100 %')
await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
await page.goto(URL + '#/pedidos')
await page.getByText('Ana Pérez').first().click()
expect((await page.locator('[role=dialog]').last().innerText()).includes('$306.00'), 'Pedido confirmado conserva su ganancia histórica tras subir el chocolate')
await page.keyboard.press('Escape')

// Resumen
await page.goto(URL + '#/')
await page.waitForTimeout(300)
const home = await page.innerText('main')
expect(home.includes('$510.00') && home.includes('$200.00'), 'Resumen: ventas $510.00 y cobrado $200.00 por separado')

// Respaldo
await page.goto(URL + '#/ajustes')
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Descargar copia' }).click()])
const p = await dl.path()
const backup = JSON.parse(fs.readFileSync(p, 'utf8'))
expect(backup.schemaVersion === 1 && backup.orders.length === 1 && backup.recipes.length === 1, 'Respaldo JSON descargado con 1 pedido y 1 receta')
fs.copyFileSync(p, 'e2e/backup.json')
const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Pedidos', exact: true }).click()])
const csvText = fs.readFileSync(await csv.path(), 'utf8')
expect(csvText.charCodeAt(0) === 0xfeff && csvText.includes('PED-0001'), 'CSV de pedidos con BOM y folio')

// Borrar todo y restaurar
await page.getByRole('button', { name: 'Borrar todos los datos' }).click()
await page.getByRole('button', { name: 'Borrar todo', exact: true }).click()
await page.getByRole('button', { name: 'Sí, borrar todo' }).click()
await page.waitForTimeout(300)
await page.locator('input[type=file]').setInputFiles('e2e/backup.json')
await page.getByRole('combobox', { name: 'Modo de restauración' }).selectOption('reemplazar')
await page.getByRole('button', { name: 'Reemplazar datos' }).click()
await page.getByRole('button', { name: 'Reemplazar todo' }).click()
await page.waitForTimeout(500)
expect((await page.innerText('main')).includes('Restauración completada'), 'Restauración completada')
await page.goto(URL + '#/pedidos')
expect(await page.getByText('Ana Pérez').count() >= 1, 'Pedido recuperado tras restaurar')

// Archivo inválido
fs.writeFileSync('e2e/bad.json', '{"format":"otro"}')
await page.goto(URL + '#/ajustes')
await page.locator('input[type=file]').setInputFiles('e2e/bad.json')
await page.getByText('No se puede importar').waitFor(); expect(await page.getByText('No se puede importar').count() === 1, 'Archivo inválido rechazado')
await page.keyboard.press('Escape')

// Recarga: persistencia
await page.reload(); await page.goto(URL + '#/recetas')
expect(await page.getByText('Pastel de chocolate').count() >= 1, 'Datos persisten tras recargar')

// Desktop
await page.setViewportSize({ width: 1280, height: 800 })
await page.screenshot({ path: 'e2e/desktop.png' })
await page.setViewportSize({ width: 390, height: 844 })
await page.goto(URL + '#/'); await page.waitForTimeout(300)
await page.screenshot({ path: 'e2e/mobile-resumen.png' })
await page.getByRole('button', { name: 'Crear nuevo' }).click()
await page.screenshot({ path: 'e2e/mobile-menu.png' })

console.log(errors.length ? 'Errores de consola:\n' + errors.join('\n') : '✔ sin errores de consola')
await browser.close()
