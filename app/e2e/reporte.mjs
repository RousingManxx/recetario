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
await p.goto(URL + '#/ajustes'); await p.getByRole('button', { name: 'Cargar ejemplos' }).click(); await p.waitForTimeout(600)
await p.getByRole('button', { name: 'Crear nuevo' }).click(); await p.getByRole('menuitem', { name: 'Nuevo gasto' }).click()
const d = p.getByRole('dialog').last()
await d.getByPlaceholder('Gas del mes').fill('Renta del local'); await d.getByLabel('Monto (MXN)').fill('350')
await d.getByRole('button', { name: 'Guardar' }).click()
await p.getByRole('link', { name: 'Finanzas' }).click(); await p.waitForTimeout(500)
const card = p.locator('section[aria-labelledby=t8]')
await card.scrollIntoViewIfNeeded()
expect(await card.getByText('Exportar reporte').count() === 1, 'Tarjeta «Exportar reporte» al final de Finanzas')
const from = await card.getByLabel('Desde').inputValue(), to = await card.getByLabel('Hasta').inputValue()
expect(/^\d{4}-\d{2}-01$/.test(from), `Fechas por defecto = periodo elegido (${from} a ${to})`)

// PDF
const [pdf] = await Promise.all([p.waitForEvent('download'), card.getByRole('button', { name: 'Descargar PDF' }).click()])
expect(/^reporte-finanzas_\d{4}-\d{2}-\d{2}_a_\d{4}-\d{2}-\d{2}\.pdf$/.test(pdf.suggestedFilename()), 'PDF con nombre ' + pdf.suggestedFilename())
fs.copyFileSync(await pdf.path(), 'e2e/reporte.pdf')
expect(fs.readFileSync('e2e/reporte.pdf').subarray(0, 5).toString() === '%PDF-', 'Archivo PDF descargado')

// CSV
await card.getByRole('button', { name: 'CSV (Excel)' }).click()
const [csv] = await Promise.all([p.waitForEvent('download'), card.getByRole('button', { name: 'Descargar CSV' }).click()])
const text = fs.readFileSync(await csv.path(), 'utf8')
expect(text.charCodeAt(0) === 0xfeff && text.includes('RESUMEN') && text.includes('Renta del local'), 'CSV con BOM, resumen y el gasto registrado')
fs.copyFileSync(await csv.path(), 'e2e/reporte.csv')
// el CSV coincide con la pantalla
const screenSales = (await p.getByRole('button', { name: /^Ingresos por ventas:/ }).locator('.v').innerText()).replace(/[^0-9.]/g, '')
const csvSales = text.split('\r\n').find((l) => l.startsWith('Ingresos por ventas,')).split(',')[1]
expect(Number(screenSales) === Number(csvSales), `Ventas del CSV (${csvSales}) = pantalla ($${screenSales})`)

// fechas inválidas y filtros
await card.getByLabel('Desde').fill('2026-12-31'); await card.getByLabel('Hasta').fill('2026-01-01')
expect(await card.getByRole('alert').count() === 1 && await card.getByRole('button', { name: /Descargar/ }).isDisabled(), 'Fechas invertidas: aviso y botón deshabilitado')
await card.getByLabel('Desde').fill(from); await card.getByLabel('Hasta').fill(to)
await card.getByLabel('Categoría').selectOption('Galletas')
await card.getByRole('button', { name: 'Descargar CSV' }).scrollIntoViewIfNeeded()
const [csv2] = await Promise.all([p.waitForEvent('download'), card.getByRole('button', { name: 'Descargar CSV' }).click()])
const t2 = fs.readFileSync(await csv2.path(), 'utf8')
expect(!t2.includes('FLUJO DE CAJA') && t2.includes('Galletas'), 'Con filtro de categoría el CSV omite caja y solo trae Galletas')
await p.screenshot({ path: 'e2e/reporte-card.png' })
console.log(errors.length ? 'Errores:\n' + errors.join('\n') : '✔ sin errores de consola')
await b.close()
