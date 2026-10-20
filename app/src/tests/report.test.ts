import { describe, expect, it } from 'vitest'
import type { Expense, Order, OrderLine, Recipe } from '../domain/types'
import { NO_FILTERS, computeMetrics, resolveRange, type Ctx } from '../domain/finance'
import { buildReport, reportCsv, reportFileName } from '../domain/report'
import { reportPdf } from '../domain/reportPdf'

const NOW = new Date('2026-05-20T15:00:00')
const ln = (o: Partial<OrderLine> = {}): OrderLine => ({ id: 'l' + Math.random(), recipeId: 'r1', name: 'Pastel de piña', qty: 1, unitPriceCents: 10000, unitCostCents: 4000, commissionPct: 0, customization: '', ...o })
const ord = (id: string, at: string, o: Partial<Order> = {}): Order => ({
  id, folio: id.toUpperCase(), customerName: 'Ana, "la güera"', createdAt: at, confirmedAt: at, deliveryAt: at, status: 'confirmado', lines: [ln()],
  discountCents: 0, deliveryFeeCents: 0, payments: [], adjustments: [], message: '', notes: '', ...o,
})
const rec = (o: Partial<Recipe> = {}): Recipe => ({
  id: 'r1', name: 'Pastel de piña', category: 'Pasteles', kind: 'pastel', description: '', favorite: false, components: [], yieldQty: 1, portionsPerUnit: 1,
  activeMin: 0, bakeMin: 0, restMin: 0, ingredientWastePct: 0, finishedWastePct: 0, laborMode: 'hora', laborRateCents: 6000, laborOps: 0,
  energyMode: 'fijo', energyValue: 0, otherCents: 0, packagingCentsPerUnit: 0, commissionPct: 0, targetMarginPct: 60, steps: '', notes: '', updatedAt: '', ...o,
})
const exp = (date: string, amountCents: number): Expense => ({ id: 'e' + date, date, concept: 'Gas', category: 'Servicios', amountCents, fixed: false })
const pay = (date: string, amountCents: number) => ({ id: 'p' + date + amountCents, date, amountCents, method: 'efectivo' as const })

const ctx: Ctx = {
  orders: [
    ord('a', '2026-05-03T10:00:00', { payments: [pay('2026-05-03', 3000), pay('2026-05-10', 7000)] }),
    ord('b', '2026-05-15T10:00:00', { lines: [ln({ recipeId: 'r2', name: 'Galleta', qty: 10, unitPriceCents: 3000, unitCostCents: 1000 })], payments: [pay('2026-05-16', 5000)] }),
    ord('q', '2026-05-16T10:00:00', { status: 'cotizacion', confirmedAt: undefined }),
  ],
  expenses: [exp('2026-05-12', 1500)],
  purchases: [{ id: 'pu', ingredientId: 'i', date: '2026-05-05', qty: 1, unit: 'kg', priceCents: 2000, discountCents: 0, extraCents: 0 }],
  recipes: [rec(), rec({ id: 'r2', name: 'Galleta', category: 'Galletas' })],
}
const base = { ctx, from: '2026-05-01', to: '2026-05-20', filters: NO_FILTERS, granularity: 'auto' as const, businessName: 'Dulce Rosa', includeDetail: true, now: NOW }

const csvRows = (csv: string) => csv.replace(/^﻿/, '').split('\r\n')
const sectionOf = (csv: string, title: string) => { const rows = csvRows(csv); const i = rows.indexOf(title); expect(i).toBeGreaterThanOrEqual(0); const out: string[] = []; for (let j = i + 2; j < rows.length && rows[j] !== ''; j++) out.push(rows[j]); return out }

describe('reporte: datos', () => {
  it('las cifras del reporte son las del motor financiero', () => {
    const r = buildReport(base), m = computeMetrics(ctx, resolveRange('custom', NOW, { from: base.from, to: base.to }).range, NO_FILTERS)
    expect(r.metrics).toEqual(m)
    expect(r.kpis.find((k) => k.label === 'Ingresos por ventas')!.value).toBe(40000)
    expect(r.kpis.find((k) => k.label === 'Ganancia neta estimada')!.value).toBe(m.gross - 1500)
    expect(r.series.reduce((s, p) => s + p.sales, 0)).toBe(m.sales)
  })
  it('compara con el periodo anterior de igual duración', () => {
    const r = buildReport({ ...base, from: '2026-05-10', to: '2026-05-19' })
    expect(r.meta.days).toBe(10); expect(r.meta.prevFrom).toBe('2026-04-30'); expect(r.meta.prevTo).toBe('2026-05-09')
  })
  it('el filtro de categoría deja solo ventas/costos y omite caja', () => {
    const r = buildReport({ ...base, filters: { ...NO_FILTERS, category: 'Galletas' } })
    expect(r.productFiltered).toBe(true)
    expect(r.kpis.map((k) => k.label)).not.toContain('Cobrado (neto de reembolsos)')
    expect(r.metrics.sales).toBe(30000)
    expect(r.detail!.orders.map((o) => o.folio)).toEqual(['B'])
    expect(r.detail!.payments).toEqual([])
  })
  it('sin detalle no incluye listados', () => {
    expect(buildReport({ ...base, includeDetail: false }).detail).toBeUndefined()
  })
  it('rango invertido se corrige y fechas fuera de datos dan reporte vacío', () => {
    const r = buildReport({ ...base, from: '2025-01-01', to: '2025-01-31' })
    expect(r.metrics.sales).toBe(0); expect(r.products).toEqual([]); expect(r.detail!.orders).toEqual([])
  })
})

describe('reporte: CSV', () => {
  const csv = reportCsv(buildReport(base))
  it('UTF-8 con BOM y secciones esperadas', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    for (const s of ['REPORTE FINANCIERO', 'RESUMEN', 'DISTRIBUCIÓN DE COSTOS', 'RENTABILIDAD POR RECETA', 'FLUJO DE CAJA', 'DETALLE: PEDIDOS DEL PERIODO', 'CRITERIOS DE CÁLCULO'])
      expect(csvRows(csv)).toContain(s)
  })
  it('el resumen coincide con las cifras y los importes van en pesos con 2 decimales', () => {
    const res = sectionOf(csv, 'RESUMEN')
    expect(res.find((l) => l.startsWith('Ingresos por ventas'))!.split(',')[1]).toBe('400.00')
    expect(res.find((l) => l.startsWith('Costos de producción'))!.split(',')[1]).toBe('140.00')
  })
  it('escapa comas y comillas en nombres y conserva acentos', () => {
    expect(csv).toContain('"Ana, ""la güera"""')
    expect(csv).toContain('Pastel de piña')
  })
  it('la suma de las filas de la serie = ventas', () => {
    const rows = sectionOf(csv, 'SERIE POR DÍA').map((l) => Number(l.split(',')[1]))
    expect(rows.reduce((a, b) => a + b, 0)).toBeCloseTo(400)
  })
  it('flujo de caja = cobros − reembolsos − gastos − compras', () => {
    const f = Object.fromEntries(sectionOf(csv, 'FLUJO DE CAJA').map((l) => l.split(',')))
    expect(Number(f['Cobros recibidos'])).toBe(150); expect(Number(f['Flujo neto'])).toBe(150 - 15 - 20)
  })
  it('punto y coma como separador y nombre de archivo con fechas', () => {
    expect(reportCsv(buildReport(base), ';')).toContain('Ingresos por ventas;400.00;')
    expect(reportFileName(buildReport(base), 'pdf')).toBe('reporte-finanzas_2026-05-01_a_2026-05-20.pdf')
  })
  it('con filtro de producto no hay sección de caja', () => {
    expect(csvRows(reportCsv(buildReport({ ...base, filters: { ...NO_FILTERS, recipeId: 'r1' } })))).not.toContain('FLUJO DE CAJA')
  })
  it('protege contra fórmulas en nombres de clientes', () => {
    const c2 = { ...ctx, orders: [ord('z', '2026-05-04T10:00:00', { customerName: '=HYPERLINK("x")' })] }
    expect(reportCsv(buildReport({ ...base, ctx: c2 }))).toContain("'=HYPERLINK")
  })
})

describe('reporte: PDF', () => {
  const bytes = reportPdf(buildReport(base))
  const txt = Array.from(bytes, (b) => String.fromCharCode(b)).join('')
  const hex = (s: string) => Array.from(s, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  it('es un PDF bien formado: cabecera, xref con offsets exactos y EOF', () => {
    expect(txt.startsWith('%PDF-1.4')).toBe(true); expect(txt.trimEnd().endsWith('%%EOF')).toBe(true)
    const xref = Number(/startxref\n(\d+)/.exec(txt)![1])
    expect(txt.slice(xref, xref + 4)).toBe('xref')
    const n = Number(/\/Size (\d+)/.exec(txt)![1])
    const entries = [...txt.slice(xref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]))
    expect(entries.length).toBe(n - 1)
    entries.forEach((off, i) => expect(txt.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`))
  })
  it('longitudes de stream correctas y páginas contadas', () => {
    for (const m of txt.matchAll(/\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) expect(m[2].length).toBe(Number(m[1]))
    expect(Number(/\/Count (\d+)/.exec(txt)![1])).toBeGreaterThanOrEqual(1)
  })
  it('contiene título, negocio y acentos en WinAnsi', () => {
    expect(txt).toContain(hex('Reporte financiero')); expect(txt).toContain(hex('Dulce Rosa'))
    expect(txt).toContain(hex('Pastel de pi') + 'f1' + hex('a')) // ñ = 0xF1
    expect(txt).toContain('/Encoding /WinAnsiEncoding')
  })
  it('un reporte grande pagina sin romperse', () => {
    const orders = Array.from({ length: 160 }, (_, i) => ord('o' + i, `2026-05-${String((i % 19) + 1).padStart(2, '0')}T10:00:00`, { payments: [pay('2026-05-05', 1000)] }))
    const big = reportPdf(buildReport({ ...base, ctx: { ...ctx, orders } }))
    const t = Array.from(big, (b) => String.fromCharCode(b)).join('')
    expect(Number(/\/Count (\d+)/.exec(t)![1])).toBeGreaterThan(3)
  })
  it('reporte vacío también genera PDF válido', () => {
    const e = reportPdf(buildReport({ ...base, from: '2025-01-01', to: '2025-01-31' }))
    expect(Array.from(e.slice(0, 8), (b) => String.fromCharCode(b)).join('')).toBe('%PDF-1.4')
  })
})
