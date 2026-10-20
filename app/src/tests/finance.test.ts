import { describe, expect, it } from 'vitest'
import type { Expense, Order, OrderLine, Recipe } from '../domain/types'
import { buildSeries, computeMetrics, costDistribution, dataWarnings, defaultGranularity, delta, NO_FILTERS, ordersAndCollections, productRows, receivables, resolveRange, type Ctx } from '../domain/finance'
import { sharesOf } from '../domain/orders'
import { recipeCost } from '../domain/costing'
import { transition } from '../domain/orders'

const NOW = new Date('2026-05-20T15:00:00') // miércoles
const ln = (o: Partial<OrderLine> = {}): OrderLine => ({ id: 'l' + Math.random(), recipeId: 'r1', name: 'Pastel', qty: 1, unitPriceCents: 10000, unitCostCents: 4000, commissionPct: 0, customization: '', ...o })
const ord = (id: string, at: string, o: Partial<Order> = {}): Order => ({
  id, folio: id, customerName: 'Ana', createdAt: at, confirmedAt: at, deliveryAt: at, status: 'confirmado', lines: [ln()],
  discountCents: 0, deliveryFeeCents: 0, payments: [], adjustments: [], message: '', notes: '', ...o,
})
const rec = (o: Partial<Recipe> = {}): Recipe => ({
  id: 'r1', name: 'Pastel', category: 'Pasteles', kind: 'pastel', description: '', favorite: false, components: [], yieldQty: 1, portionsPerUnit: 1,
  activeMin: 0, bakeMin: 0, restMin: 0, ingredientWastePct: 0, finishedWastePct: 0, laborMode: 'hora', laborRateCents: 6000, laborOps: 0,
  energyMode: 'fijo', energyValue: 0, otherCents: 0, packagingCentsPerUnit: 0, commissionPct: 0, targetMarginPct: 60, steps: '', notes: '', updatedAt: '', ...o,
})
const ctx = (o: Partial<Ctx> = {}): Ctx => ({ orders: [], expenses: [], purchases: [], recipes: [rec()], ...o })
const pay = (date: string, amountCents: number) => ({ id: 'p' + Math.random(), date, amountCents, method: 'efectivo' as const })
const exp = (date: string, amountCents: number): Expense => ({ id: 'e' + Math.random(), date, concept: 'Gas', category: '', amountCents, fixed: false })
const R = (k: Parameters<typeof resolveRange>[0], custom?: { from: string; to: string }) => resolveRange(k, NOW, custom)

describe('periodos', () => {
  const d = (r: { from: Date; to: Date }) => [r.from.toISOString().slice(0, 10), r.to.toISOString().slice(0, 10)]
  it('mes actual vs mismos días del mes anterior', () => {
    const x = R('mes')
    expect(x.range.from.getDate()).toBe(1); expect(x.range.from.getMonth()).toBe(4)
    expect(x.range.to.getDate()).toBe(21)
    expect(x.prev.from.getMonth()).toBe(3); expect(x.prev.to.getMonth()).toBe(3); expect(x.prev.to.getDate()).toBe(21)
  })
  it('hoy, 7 días, mes anterior, 3 meses y año', () => {
    expect(R('hoy').days).toBe(1)
    expect(R('7d').days).toBe(7)
    expect(R('7d').prev.to.getTime()).toBe(R('7d').range.from.getTime())
    const ma = R('mes_ant'); expect(ma.range.from.getMonth()).toBe(3); expect(ma.range.to.getMonth()).toBe(4); expect(ma.days).toBe(30)
    expect(R('3m').range.from.getMonth()).toBe(1)
    const y = R('anio'); expect(y.range.from.getMonth()).toBe(0); expect(y.prev.from.getFullYear()).toBe(2025)
  })
  it('rango personalizado es inclusivo y su periodo previo tiene la misma duración', () => {
    const x = R('custom', { from: '2026-05-10', to: '2026-05-12' })
    expect(x.days).toBe(3)
    expect((x.prev.to.getTime() - x.prev.from.getTime()) / 86400000).toBe(3)
    expect(R('custom', { from: '2026-05-10', to: '2026-05-01' }).days).toBe(1) // rango invertido se corrige
    void d
  })
  it('granularidad automática', () => {
    expect([defaultGranularity(7), defaultGranularity(90), defaultGranularity(365)]).toEqual(['dia', 'semana', 'mes'])
  })
})

describe('ventas, cobros y ganancias', () => {
  const r = R('mes').range
  it('anticipo + pago final NO duplican la venta', () => {
    const o = ord('a', '2026-05-10T10:00:00', { payments: [pay('2026-05-10', 3000), pay('2026-05-18', 7000)] })
    const m = computeMetrics(ctx({ orders: [o] }), r, NO_FILTERS)
    expect(m.sales).toBe(10000)
    expect(m.collected).toBe(10000)
    expect(m.cost).toBe(4000); expect(m.gross).toBe(6000); expect(m.marginPct).toBeCloseTo(60)
  })
  it('ventas ≠ cobrado: venta de este mes cobrada el mes siguiente', () => {
    const o = ord('a', '2026-04-30T10:00:00', { payments: [pay('2026-05-02', 10000)] })
    const m = computeMetrics(ctx({ orders: [o] }), r, NO_FILTERS)
    expect(m.sales).toBe(0); expect(m.collected).toBe(10000)
  })
  it('cotizaciones y cancelados no son ventas; el dinero ya cobrado sigue contando hasta reembolsarlo', () => {
    const q = ord('q', '2026-05-10T10:00:00', { status: 'cotizacion', confirmedAt: undefined })
    const c = ord('c', '2026-05-11T10:00:00', { status: 'cancelado', payments: [pay('2026-05-11', 2000)] })
    let m = computeMetrics(ctx({ orders: [q, c] }), r, NO_FILTERS)
    expect(m.sales).toBe(0); expect(m.collected).toBe(2000)
    const c2 = { ...c, payments: [pay('2026-05-11', 2000), pay('2026-05-12', -2000)] }
    m = computeMetrics(ctx({ orders: [c2] }), r, NO_FILTERS)
    expect(m.collected).toBe(2000); expect(m.refunds).toBe(2000); expect(m.cashNet).toBe(0)
  })
  it('descuento y envío entran a la venta; comisiones y ajustes al costo', () => {
    const o = ord('a', '2026-05-10T10:00:00', { discountCents: 1000, deliveryFeeCents: 500, lines: [ln({ qty: 2, commissionPct: 10 })], adjustments: [{ id: 'x', date: '', amountCents: 300, note: '' }] })
    const m = computeMetrics(ctx({ orders: [o] }), r, NO_FILTERS)
    expect(m.sales).toBe(2 * 10000 - 1000 + 500)
    expect(m.cost).toBe(8000 + 2000 + 300)
  })
  it('gastos restan a la neta; compras de ingredientes solo al flujo de caja', () => {
    const o = ord('a', '2026-05-10T10:00:00', { payments: [pay('2026-05-10', 10000)] })
    const m = computeMetrics(ctx({ orders: [o], expenses: [exp('2026-05-12', 1500)], purchases: [{ id: 'p', ingredientId: 'i', date: '2026-05-05', qty: 1, unit: 'kg', priceCents: 2000, discountCents: 0, extraCents: 0 }] }), r, NO_FILTERS)
    expect(m.net).toBe(6000 - 1500)
    expect(m.cashNet).toBe(10000 - 1500 - 2000)
    expect(m.purchasesOut).toBe(2000)
  })
  it('anticipos solo de pedidos aún no entregados', () => {
    const a = ord('a', '2026-05-10T10:00:00', { payments: [pay('2026-05-10', 3000)] })
    const b = ord('b', '2026-05-10T10:00:00', { status: 'entregado', payments: [pay('2026-05-10', 10000)] })
    expect(computeMetrics(ctx({ orders: [a, b] }), r, NO_FILTERS).advances).toBe(3000)
  })
  it('por cobrar separa entregados de futuros', () => {
    const a = ord('a', '2026-05-10T10:00:00', { payments: [pay('2026-05-10', 3000)] })
    const b = ord('b', '2026-05-10T10:00:00', { status: 'entregado' })
    const x = receivables(ctx({ orders: [a, b] }), NO_FILTERS)
    expect(x).toMatchObject({ total: 17000, future: 7000, delivered: 10000 })
    const oc = ordersAndCollections(ctx({ orders: [a, b] }), r, NO_FILTERS)
    expect(oc.future).toMatchObject({ confirmed: 10000, collected: 3000, pending: 7000 })
    expect(oc.delivered.pending).toBe(10000)
  })
  it('filtro de estado', () => {
    const a = ord('a', '2026-05-10T10:00:00'), b = ord('b', '2026-05-10T10:00:00', { status: 'entregado' })
    expect(computeMetrics(ctx({ orders: [a, b] }), r, { ...NO_FILTERS, status: 'entregados' }).sales).toBe(10000)
    expect(computeMetrics(ctx({ orders: [a, b] }), r, { ...NO_FILTERS, status: 'por_entregar' }).sales).toBe(10000)
  })
  it('comparación con el periodo anterior', () => {
    expect(delta(150, 100)).toEqual({ abs: 50, pct: 50 })
    expect(delta(10, 0).pct).toBeNull()
  })
})

describe('histórico congelado', () => {
  it('cambiar la receta no altera las cifras de pedidos confirmados', () => {
    const c = ctx({ orders: [ord('a', '2026-05-10T10:00:00')] })
    const before = computeMetrics(c, R('mes').range, NO_FILTERS)
    const after = computeMetrics({ ...c, recipes: [rec({ laborRateCents: 99999, otherCents: 50000 })] }, R('mes').range, NO_FILTERS)
    expect(after).toEqual(before)
  })
})

describe('series, distribución y productos son consistentes con los totales', () => {
  const r = R('mes').range
  const o1 = ord('a', '2026-05-03T10:00:00', { lines: [ln({ qty: 2, costShares: { ingredients: 0.5, labor: 0.3, energy: 0.05, packaging: 0.1, other: 0.05 } })], payments: [pay('2026-05-03', 5000)] })
  const o2 = ord('b', '2026-05-15T10:00:00', { lines: [ln({ recipeId: 'r2', name: 'Galleta', qty: 10, unitPriceCents: 3000, unitCostCents: 1000 })], payments: [pay('2026-05-16', 30000)] })
  const c = ctx({ orders: [o1, o2], recipes: [rec(), rec({ id: 'r2', name: 'Galleta', category: 'Galletas' })] })
  it('la suma de los puntos de la serie = totales', () => {
    for (const g of ['dia', 'semana', 'mes'] as const) {
      const s = buildSeries(c, r, g, NO_FILTERS), m = computeMetrics(c, r, NO_FILTERS)
      expect(s.reduce((a, p) => a + p.sales, 0)).toBe(m.sales)
      expect(s.reduce((a, p) => a + p.cost, 0)).toBe(m.cost)
      expect(s.reduce((a, p) => a + p.collected, 0)).toBe(m.collected)
    }
  })
  it('distribución de costos suma el costo total y usa el desglose congelado', () => {
    const d = costDistribution(c, r, NO_FILTERS)
    expect(d.reduce((s, x) => s + x.cents, 0)).toBe(computeMetrics(c, r, NO_FILTERS).cost)
    expect(d.find((x) => x.key === 'ingredients')!.cents).toBe(4000) // 8000 × 0.5
    expect(d.find((x) => x.key === 'unknown')!.cents).toBe(10000) // pedido sin desglose
    expect(d.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100)
  })
  it('rentabilidad por producto y filtros por categoría/producto', () => {
    const rows = productRows(c, r, NO_FILTERS)
    expect(rows.find((x) => x.recipeId === 'r2')).toMatchObject({ units: 10, revenue: 30000, profit: 20000 })
    expect(rows.find((x) => x.recipeId === 'r2')!.marginPct).toBeCloseTo(66.67, 1)
    const m = computeMetrics(c, r, { ...NO_FILTERS, category: 'Galletas' })
    expect(m).toMatchObject({ sales: 30000, cost: 10000, productFiltered: true, collected: 0, expenses: 0 })
    expect(computeMetrics(c, r, { ...NO_FILTERS, recipeId: 'r1' }).sales).toBe(20000)
  })
  it('el descuento del pedido se reparte entre sus productos', () => {
    const o = ord('d', '2026-05-04T10:00:00', { discountCents: 3000, lines: [ln({ unitPriceCents: 10000 }), ln({ recipeId: 'r2', name: 'G', unitPriceCents: 20000, unitCostCents: 0 })] })
    const rows = productRows(ctx({ orders: [o], recipes: [rec(), rec({ id: 'r2' })] }), r, NO_FILTERS)
    expect(rows.find((x) => x.recipeId === 'r1')!.revenue).toBe(9000)
    expect(rows.find((x) => x.recipeId === 'r2')!.revenue).toBe(18000)
  })
})

describe('advertencias y costos reales', () => {
  const r = R('mes').range
  it('avisa si faltan gastos, costos o mano de obra', () => {
    const o = ord('a', '2026-05-10T10:00:00', { lines: [ln({ unitCostCents: 0 })] })
    const c = ctx({ orders: [o], recipes: [rec({ laborRateCents: 0 })] })
    const w = dataWarnings(c, r, NO_FILTERS, computeMetrics(c, r, NO_FILTERS)).join(' | ')
    expect(w).toMatch(/No hay gastos/); expect(w).toMatch(/sin costo calculado|no tenían costo/); expect(w).toMatch(/mano de obra/)
  })
  it('sin avisos cuando hay gastos y datos completos', () => {
    const c = ctx({ orders: [ord('a', '2026-05-10T10:00:00')], expenses: [exp('2026-05-11', 100)] })
    expect(dataWarnings(c, r, NO_FILTERS, computeMetrics(c, r, NO_FILTERS))).toEqual([])
  })
  it('al confirmar se congela el desglose de costos', () => {
    const rc = rec({ laborRateCents: 6000, activeMin: 60, packagingCentsPerUnit: 1000, components: [] })
    const sh = sharesOf(recipeCost(rc, new Map()))!
    expect(sh.labor + sh.packaging).toBeCloseTo(1)
    const o = ord('a', '2026-05-10T10:00:00', { status: 'cotizacion', confirmedAt: undefined })
    const t = transition(o, 'confirmado', new Map([[rc.id, rc]]), new Map())
    expect(t.lines[0].costShares).toBeDefined()
  })
})
