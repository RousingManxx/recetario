import { chromium } from 'playwright-core'
import fs from 'node:fs'
const log = (m) => console.log('✔', m)
const expect = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); log(m) }
const b = await chromium.launch({ channel: 'msedge' })
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-MX', timezoneId: 'America/Mexico_City', acceptDownloads: true })
const p = await ctx.newPage()
const errors = []
p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const URL = 'http://localhost:4173/'
const dlg = () => p.getByRole('dialog').last()

await p.goto(URL); await p.getByRole('link', { name: 'Salir' }).click()
await p.getByRole('button', { name: 'Crear nuevo' }).click()
expect((await p.getByRole('menuitem').allInnerTexts()).includes('Nueva herramienta'), 'El botón «+» ofrece «Nueva herramienta»')
await p.keyboard.press('Escape')

// Pestaña Herramientas en Ingredientes
await p.getByRole('link', { name: 'Ingredientes' }).click()
await p.getByRole('button', { name: /^Herramientas \(0\)/ }).click()
expect(await p.getByText('Aún no hay herramientas').count() === 1, 'Estado vacío de Herramientas')
await p.getByRole('button', { name: '+ Herramienta' }).click()
await dlg().getByPlaceholder('Tapete de silicón').fill('Tapete de silicón')
await dlg().getByPlaceholder('300').fill('300')
await dlg().getByPlaceholder('200').fill('200')
expect((await dlg().innerText()).includes('0.5 %') && (await dlg().innerText()).includes('$1.50'), 'Sugiere 0.5 % (= $1.50 por tanda) con vida útil de 200 usos')
await dlg().getByRole('button', { name: 'Guardar', exact: true }).click()
await p.waitForTimeout(300)
expect(await p.locator('.item', { hasText: 'Tapete de silicón' }).count() === 1, 'Herramienta guardada y listada')

// Receta con 0.5 % de uso
await p.getByRole('button', { name: 'Crear nuevo' }).click(); await p.getByRole('menuitem', { name: 'Nueva receta' }).click()
await dlg().getByPlaceholder('Pastel de chocolate').fill('Galletas de mantequilla')
await dlg().getByRole('tab', { name: '2 · Costos' }).click()
await dlg().getByRole('button', { name: '+ Agregar herramienta' }).click()
await dlg().getByLabel('Herramienta', { exact: true }).selectOption({ index: 1 })
await dlg().getByLabel('Porcentaje de uso por tanda').fill('0.5')
const foot = await dlg().innerText()
expect(foot.includes('$1.50'), 'La receta suma $1.50 de desgaste (0.5 % de $300)')
await dlg().getByRole('tab', { name: '3 · Precio' }).click()
await dlg().getByLabel(/Tu precio por unidad/).fill('10')
expect((await dlg().innerText()).includes('Costo por unidad') && (await dlg().innerText()).includes('$1.50'), 'Costo por unidad $1.50 en el resumen')
await dlg().getByRole('button', { name: 'Guardar receta' }).click()
await p.getByRole('link', { name: 'Recetas' }).click(); await p.waitForTimeout(300)
expect((await p.locator('.item', { hasText: 'Galletas de mantequilla' }).innerText()).includes('Costo $1.50'), 'Lista de recetas muestra costo $1.50')

// Validación: porcentaje inválido
await p.locator('.item', { hasText: 'Galletas de mantequilla' }).click()
await dlg().getByRole('tab', { name: '2 · Costos' }).click()
await dlg().getByLabel('Porcentaje de uso por tanda').fill('150')
await dlg().getByRole('button', { name: 'Guardar receta' }).click()
expect(await p.getByText('porcentaje de uso entre 0 y 100').count() === 1, 'Porcentaje > 100 es rechazado con mensaje')
await dlg().getByLabel('Porcentaje de uso por tanda').fill('0.5')
await p.keyboard.press('Escape')

// Pedido confirmado: congela el costo
await p.getByRole('button', { name: 'Crear nuevo' }).click(); await p.getByRole('menuitem', { name: 'Nuevo pedido' }).click()
await dlg().getByRole('button', { name: '+ Nuevo' }).click()
await p.getByRole('dialog').last().getByLabel('Nombre', { exact: true }).fill('Ana')
await p.getByRole('dialog').last().getByRole('button', { name: 'Guardar' }).click()
await dlg().getByLabel('Agregar producto').selectOption({ index: 1 })
await dlg().getByRole('button', { name: 'Confirmar pedido' }).click()
await p.waitForTimeout(300)
expect((await dlg().innerText()).includes('Costo unitario (congelado): $1.50'), 'Pedido confirmado congela costo $1.50')
await p.keyboard.press('Escape')

// Subir el precio de la herramienta: receta se recalcula, pedido no
await p.getByRole('link', { name: 'Ingredientes' }).click()
await p.getByRole('button', { name: /^Herramientas \(1\)/ }).click()
expect((await p.locator('.item', { hasText: 'Tapete' }).innerText()).includes('En 1 receta'), 'La herramienta muestra en qué receta se usa')
await p.locator('.item', { hasText: 'Tapete' }).click()
await dlg().getByPlaceholder('300').fill('600')
await dlg().getByRole('button', { name: 'Guardar', exact: true }).click()
await p.getByRole('link', { name: 'Recetas' }).click(); await p.waitForTimeout(300)
expect((await p.locator('.item', { hasText: 'Galletas de mantequilla' }).innerText()).includes('Costo $3.00'), 'Al subir la herramienta a $600 la receta cuesta $3.00')
await p.getByRole('link', { name: 'Pedidos' }).click()
await p.locator('.item', { hasText: 'Ana' }).first().click()
expect((await dlg().innerText()).includes('Costo unitario (congelado): $1.50'), 'El pedido confirmado sigue con $1.50')
await p.keyboard.press('Escape')

// No se puede eliminar una herramienta en uso
await p.getByRole('link', { name: 'Ingredientes' }).click()
await p.getByRole('button', { name: /^Herramientas \(1\)/ }).click()
await p.locator('.item', { hasText: 'Tapete' }).click()
await dlg().getByRole('button', { name: 'Eliminar' }).click()
await p.getByText(/No se puede eliminar: la usan Galletas/).waitFor({ timeout: 4000 }).catch(() => {})
expect(await p.getByText(/No se puede eliminar: la usan Galletas/).count() === 1, 'No deja eliminar una herramienta que usa una receta')
await p.keyboard.press('Escape')

// Gasto «ya cobrado en recetas»
await p.getByRole('button', { name: 'Crear nuevo' }).click(); await p.getByRole('menuitem', { name: 'Nuevo gasto' }).click()
await dlg().getByPlaceholder('Gas del mes').fill('Reposición espátula'); await dlg().getByLabel('Monto (MXN)').fill('100')
await dlg().getByLabel(/Ya lo cobro dentro de mis recetas/).check()
await dlg().getByRole('button', { name: 'Guardar' }).click()
await p.getByRole('link', { name: 'Finanzas' }).click(); await p.waitForTimeout(500)
const net = (await p.getByRole('button', { name: /^Ganancia neta estimada:/ }).locator('.v').innerText()).replace(/[^0-9.\-]/g, '')
const gross = (await p.getByRole('button', { name: /^Ganancia bruta:/ }).locator('.v').innerText()).replace(/[^0-9.\-]/g, '')
expect(Number(net) === Number(gross), `Gasto cubierto no resta de la neta (neta $${net} = bruta $${gross})`)
expect((await p.innerText('main')).includes('Gastos ya cobrados en recetas'), 'El flujo de caja lo muestra aparte')
expect((await p.locator('.donut-l').innerText()).includes('Herramientas (desgaste)'), 'La distribución de costos incluye «Herramientas (desgaste)»')

// Respaldo y CSV
await p.getByRole('link', { name: 'Ajustes' }).click()
const [bk] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Descargar copia' }).click()])
const json = JSON.parse(fs.readFileSync(await bk.path(), 'utf8'))
expect(json.schemaVersion === 2 && json.tools.length === 1 && json.recipes[0].toolUses[0].pct === 0.5, 'Respaldo v2 incluye la herramienta y su porcentaje por receta')
const [cv] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Herramientas', exact: true }).click()])
expect(fs.readFileSync(await cv.path(), 'utf8').includes('Tapete de silicón'), 'CSV de herramientas')
const [cv2] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Herramientas de recetas' }).click()])
expect(fs.readFileSync(await cv2.path(), 'utf8').includes(json.tools[0].id), 'CSV receta–herramienta con ids')

// Restaurar una copia v1 antigua (sin herramientas)
const v1 = { ...json, schemaVersion: 1, tools: undefined, recipes: json.recipes.map((r) => ({ ...r, toolUses: undefined })) }
fs.writeFileSync('e2e/v1.json', JSON.stringify(v1))
await p.locator('input[type=file]').setInputFiles('e2e/v1.json')
await p.getByText('Revisar copia de seguridad').waitFor()
expect((await dlg().innerText()).includes('v2'), 'Copia v1 aceptada y migrada a v2 en la revisión')
await p.keyboard.press('Escape')
fs.rmSync('e2e/v1.json')

// Borrar todo y restaurar la v2
await p.screenshot({ path: 'e2e/tools-ajustes.png' })
console.log(errors.length ? 'Errores:\n' + errors.join('\n') : '✔ sin errores de consola')
await b.close()
