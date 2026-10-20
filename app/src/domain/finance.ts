/**
 * Cálculos financieros. Criterios (documentados también en la pantalla Finanzas):
 *  - VENTA: pedido confirmado (no cotización ni cancelado), asignada al periodo de su fecha de confirmación.
 *    Importe = subtotal − descuento + cargo de envío. Un anticipo NO es una venta: es un cobro parcial del mismo pedido.
 *  - COSTO: costos congelados en las líneas al confirmar + comisiones + ajustes de costo; mismo periodo que su venta.
 *  - GANANCIA BRUTA = ventas − costos. GANANCIA NETA ESTIMADA = bruta − gastos registrados con fecha en el periodo.
 *  - COBRADO: pagos recibidos con fecha en el periodo (reembolsos son salidas). Independiente de la venta.
 *  - POR COBRAR: saldo vigente HOY de pedidos confirmados (no depende del periodo).
 *  - FLUJO DE CAJA: cobros − reembolsos − gastos − compras de ingredientes, por fecha de movimiento.
 */
import type { Expense, Order, Payment, Purchase, Recipe } from './types'
import { orderTotals } from './orders'
import { round } from './money'

export type PeriodKey = 'hoy' | '7d' | 'mes' | 'mes_ant' | '3m' | 'anio' | 'custom'
export const PERIOD_LABEL: Record<PeriodKey, string> = {
  hoy: 'Hoy', '7d': 'Últimos 7 días', mes: 'Mes actual', mes_ant: 'Mes anterior', '3m': 'Últimos 3 meses', anio: 'Año actual', custom: 'Personalizado',
}
export interface Range { from: Date; to: Date } // [from, to)
export type Granularity = 'dia' | 'semana' | 'mes'
export type StatusGroup = 'todos' | 'por_entregar' | 'entregados'
export interface Filters { status: StatusGroup; category: string; recipeId: string }
export const NO_FILTERS: Filters = { status: 'todos', category: '', recipeId: '' }

const sod = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
/** Suma meses sin desbordar (31 mar − 1 mes = 28/29 feb). */
function addMonths(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth() + n, 1, d.getHours(), d.getMinutes())
  x.setDate(Math.min(d.getDate(), new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()))
  return x
}
const parseLocal = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : new Date(s))

export function resolveRange(key: PeriodKey, now = new Date(), custom?: { from: string; to: string }): { range: Range; prev: Range; days: number } {
  const today = sod(now), tomorrow = addDays(today, 1)
  let range: Range, prev: Range
  switch (key) {
    case 'hoy': range = { from: today, to: tomorrow }; prev = { from: addDays(today, -1), to: today }; break
    case '7d': { const f = addDays(today, -6); range = { from: f, to: tomorrow }; prev = { from: addDays(f, -7), to: f }; break }
    case 'mes': { const f = new Date(today.getFullYear(), today.getMonth(), 1); range = { from: f, to: tomorrow }; prev = { from: addMonths(f, -1), to: new Date(Math.min(addMonths(tomorrow, -1).getTime(), f.getTime())) }; break }
    case 'mes_ant': { const f = new Date(today.getFullYear(), today.getMonth() - 1, 1), t = new Date(today.getFullYear(), today.getMonth(), 1); range = { from: f, to: t }; prev = { from: addMonths(f, -1), to: f }; break }
    case '3m': { const f = addMonths(tomorrow, -3); range = { from: f, to: tomorrow }; prev = { from: addMonths(f, -3), to: f }; break }
    case 'anio': { const f = new Date(today.getFullYear(), 0, 1); range = { from: f, to: tomorrow }; prev = { from: new Date(today.getFullYear() - 1, 0, 1), to: new Date(Math.min(addMonths(tomorrow, -12).getTime(), f.getTime())) }; break }
    default: {
      let f = custom?.from ? parseLocal(custom.from) : addDays(today, -29)
      let t = custom?.to ? addDays(parseLocal(custom.to), 1) : tomorrow
      if (isNaN(f.getTime())) f = addDays(today, -29)
      if (isNaN(t.getTime())) t = tomorrow
      if (t <= f) t = addDays(f, 1)
      range = { from: f, to: t }
      const len = Math.round((t.getTime() - f.getTime()) / 86400000)
      prev = { from: addDays(f, -len), to: f }
    }
  }
  return { range, prev, days: Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / 86400000)) }
}

export const defaultGranularity = (days: number): Granularity => (days <= 31 ? 'dia' : days <= 120 ? 'semana' : 'mes')

const inRange = (iso: string | undefined, r: Range) => { if (!iso) return false; const d = parseLocal(iso); return d >= r.from && d < r.to }
export const isSale = (o: Order) => o.status !== 'cotizacion' && o.status !== 'cancelado'
const saleDate = (o: Order) => o.confirmedAt ?? o.createdAt
const statusOk = (o: Order, s: StatusGroup) => s === 'todos' || (s === 'entregados' ? o.status === 'entregado' : o.status !== 'entregado')

export interface Ctx {
  orders: Order[]; expenses: Expense[]; purchases: Purchase[]; recipes: Recipe[]
}
const catOf = (c: Ctx, recipeId: string) => c.recipes.find((r) => r.id === recipeId)?.category ?? 'Sin categoría'
export const hasLineFilter = (f: Filters) => !!(f.category || f.recipeId)

interface LineFig { recipeId: string; name: string; category: string; units: number; revenue: number; cost: number; commission: number; shares?: Order['lines'][number]['costShares']; zeroCost: boolean; zeroPrice: boolean; lineCost: number }
/** Cifras por línea; el descuento del pedido se reparte proporcionalmente (el envío y los ajustes no se asignan a productos). */
function lineFigs(o: Order, c: Ctx, f: Filters): LineFig[] {
  const sub = o.lines.reduce((s, l) => s + l.qty * l.unitPriceCents, 0)
  const k = sub > 0 ? Math.max(sub - o.discountCents, 0) / sub : 1
  return o.lines.filter((l) => (!f.recipeId || l.recipeId === f.recipeId) && (!f.category || catOf(c, l.recipeId) === f.category)).map((l) => {
    const gross = l.qty * l.unitPriceCents, revenue = gross * k
    const lineCost = l.qty * l.unitCostCents
    return { recipeId: l.recipeId, name: l.name, category: catOf(c, l.recipeId), units: l.qty, revenue, cost: lineCost, commission: (revenue * l.commissionPct) / 100, shares: l.costShares, zeroCost: l.unitCostCents <= 0, zeroPrice: l.unitPriceCents <= 0, lineCost }
  })
}

export function saleOrdersIn(c: Ctx, r: Range, f: Filters): Order[] {
  return c.orders.filter((o) => isSale(o) && statusOk(o, f.status) && inRange(saleDate(o), r))
}

/** Ventas y costos de un pedido. Sin filtro de producto son exactos (incluyen envío y ajustes). */
function orderSaleCost(o: Order, c: Ctx, f: Filters): { sales: number; cost: number } {
  if (!hasLineFilter(f)) { const t = orderTotals(o); return { sales: t.totalCents, cost: t.costCents + t.commissionCents + t.adjustmentsCents } }
  const figs = lineFigs(o, c, f)
  return { sales: round(figs.reduce((s, x) => s + x.revenue, 0)), cost: round(figs.reduce((s, x) => s + x.cost + x.commission, 0)) }
}

export interface Metrics {
  sales: number; cost: number; gross: number; marginPct: number | null
  expenses: number; net: number
  collected: number          // cobros brutos
  refunds: number            // reembolsos (positivo)
  advances: number           // cobros del periodo sobre pedidos aún no entregados
  purchasesOut: number       // compras de ingredientes registradas (salida de caja, no entra a la ganancia)
  cashNet: number
  orderCount: number
  productFiltered: boolean
}

export function computeMetrics(c: Ctx, r: Range, f: Filters): Metrics {
  let sales = 0, cost = 0
  const sold = saleOrdersIn(c, r, f)
  for (const o of sold) { const x = orderSaleCost(o, c, f); sales += x.sales; cost += x.cost }
  const filtered = hasLineFilter(f)
  const pays: { p: Payment; o: Order }[] = c.orders.filter((o) => statusOk(o, f.status)).flatMap((o) => o.payments.map((p) => ({ p, o }))).filter((x) => inRange(x.p.date, r))
  const collected = filtered ? 0 : pays.filter((x) => x.p.amountCents > 0).reduce((s, x) => s + x.p.amountCents, 0)
  const refunds = filtered ? 0 : -pays.filter((x) => x.p.amountCents < 0).reduce((s, x) => s + x.p.amountCents, 0)
  const advances = filtered ? 0 : pays.filter((x) => x.p.amountCents > 0 && x.o.status !== 'entregado' && x.o.status !== 'cancelado').reduce((s, x) => s + x.p.amountCents, 0)
  const expenses = filtered ? 0 : c.expenses.filter((e) => inRange(e.date, r)).reduce((s, e) => s + e.amountCents, 0)
  const purchasesOut = filtered ? 0 : c.purchases.filter((p) => inRange(p.date, r)).reduce((s, p) => s + (p.priceCents - p.discountCents + p.extraCents), 0)
  const gross = sales - cost
  return {
    sales, cost, gross, marginPct: sales > 0 ? (gross / sales) * 100 : null, expenses, net: gross - expenses,
    collected, refunds, advances, purchasesOut, cashNet: collected - refunds - expenses - purchasesOut, orderCount: sold.length, productFiltered: filtered,
  }
}

export interface Delta { abs: number; pct: number | null }
export const delta = (cur: number, prev: number): Delta => ({ abs: cur - prev, pct: prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : null })

/** Saldo pendiente vigente (no depende del periodo). */
export function receivables(c: Ctx, f: Filters) {
  const rows = c.orders.filter((o) => isSale(o) && statusOk(o, f.status)).map((o) => ({ o, balance: orderTotals(o).balanceCents })).filter((x) => x.balance > 0)
  const sum = (a: typeof rows) => a.reduce((s, x) => s + x.balance, 0)
  const delivered = rows.filter((x) => x.o.status === 'entregado'), future = rows.filter((x) => x.o.status !== 'entregado')
  return { total: sum(rows), delivered: sum(delivered), future: sum(future), orders: rows.map((x) => x.o) }
}

/* ---------- Series ---------- */
export interface Point { start: Date; label: string; sales: number; cost: number; gross: number; collected: number; marginPct: number | null }

const bucketStart = (d: Date, g: Granularity): Date => {
  const x = sod(d)
  if (g === 'semana') x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  if (g === 'mes') x.setDate(1)
  return x
}
const nextBucket = (d: Date, g: Granularity) => (g === 'dia' ? addDays(d, 1) : g === 'semana' ? addDays(d, 7) : new Date(d.getFullYear(), d.getMonth() + 1, 1))
const fmtLabel = (d: Date, g: Granularity) => g === 'mes' ? d.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }) : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })

export function buildSeries(c: Ctx, r: Range, g: Granularity, f: Filters): Point[] {
  const pts: Point[] = []
  for (let s = bucketStart(r.from, g); s < r.to; s = nextBucket(s, g)) pts.push({ start: s, label: fmtLabel(s, g), sales: 0, cost: 0, gross: 0, collected: 0, marginPct: null })
  const idx = (d: Date) => { const b = bucketStart(d, g).getTime(); return pts.findIndex((p) => p.start.getTime() === b) }
  for (const o of saleOrdersIn(c, r, f)) { const i = idx(parseLocal(saleDate(o))); if (i < 0) continue; const x = orderSaleCost(o, c, f); pts[i].sales += x.sales; pts[i].cost += x.cost }
  if (!hasLineFilter(f))
    for (const o of c.orders.filter((o) => statusOk(o, f.status)))
      for (const p of o.payments) if (inRange(p.date, r)) { const i = idx(parseLocal(p.date)); if (i >= 0) pts[i].collected += p.amountCents }
  for (const p of pts) { p.gross = p.sales - p.cost; p.marginPct = p.sales > 0 ? (p.gross / p.sales) * 100 : null }
  return pts
}

/* ---------- Distribución de costos ---------- */
export type CostKey = 'ingredients' | 'labor' | 'energy' | 'packaging' | 'other' | 'commission' | 'adjustments' | 'unknown'
export const COST_LABEL: Record<CostKey, string> = {
  ingredients: 'Ingredientes (con merma)', labor: 'Mano de obra', energy: 'Energía', packaging: 'Empaque', other: 'Otros costos de receta',
  commission: 'Comisiones', adjustments: 'Ajustes de pedidos', unknown: 'Sin desglose (pedidos anteriores)',
}
export function costDistribution(c: Ctx, r: Range, f: Filters): { key: CostKey; label: string; cents: number; pct: number }[] {
  const acc: Record<CostKey, number> = { ingredients: 0, labor: 0, energy: 0, packaging: 0, other: 0, commission: 0, adjustments: 0, unknown: 0 }
  for (const o of saleOrdersIn(c, r, f)) {
    for (const x of lineFigs(o, c, f)) {
      acc.commission += x.commission
      if (x.shares) for (const k of ['ingredients', 'labor', 'energy', 'packaging', 'other'] as const) acc[k] += x.lineCost * x.shares[k]
      else acc.unknown += x.lineCost
    }
    if (!hasLineFilter(f)) acc.adjustments += o.adjustments.reduce((s, a) => s + a.amountCents, 0)
  }
  const total = Object.values(acc).reduce((s, v) => s + v, 0)
  return (Object.keys(acc) as CostKey[]).filter((k) => acc[k] > 0.5).map((k) => ({ key: k, label: COST_LABEL[k], cents: round(acc[k]), pct: total > 0 ? (acc[k] / total) * 100 : 0 })).sort((a, b) => b.cents - a.cents)
}

/* ---------- Por producto ---------- */
export interface ProductRow { recipeId: string; name: string; category: string; units: number; revenue: number; cost: number; profit: number; marginPct: number | null }
export function productRows(c: Ctx, r: Range, f: Filters): ProductRow[] {
  const m = new Map<string, ProductRow & { _c: number }>()
  for (const o of saleOrdersIn(c, r, f))
    for (const x of lineFigs(o, c, f)) {
      const row = m.get(x.recipeId) ?? { recipeId: x.recipeId, name: x.name, category: x.category, units: 0, revenue: 0, cost: 0, profit: 0, marginPct: null, _c: 0 }
      row.units += x.units; row.revenue += x.revenue; row._c += x.cost + x.commission; m.set(x.recipeId, row)
    }
  return [...m.values()].map(({ _c, ...row }) => {
    const revenue = round(row.revenue), cost = round(_c)
    return { ...row, revenue, cost, profit: revenue - cost, marginPct: revenue > 0 ? ((revenue - cost) / revenue) * 100 : null }
  })
}

/* ---------- Pedidos y cobros ---------- */
export function ordersAndCollections(c: Ctx, r: Range, f: Filters) {
  const sold = saleOrdersIn(c, r, { ...f, category: '', recipeId: '' })
  const grp = (a: Order[]) => {
    const confirmed = a.reduce((s, o) => s + orderTotals(o).totalCents, 0)
    const collected = a.reduce((s, o) => s + orderTotals(o).paidCents, 0)
    return { count: a.length, confirmed, collected, pending: Math.max(confirmed - collected, 0) }
  }
  return { delivered: grp(sold.filter((o) => o.status === 'entregado')), future: grp(sold.filter((o) => o.status !== 'entregado')) }
}

/* ---------- Advertencias de datos incompletos ---------- */
export function dataWarnings(c: Ctx, r: Range, f: Filters, m: Metrics): string[] {
  const w: string[] = []
  const sold = saleOrdersIn(c, r, f)
  if (m.productFiltered) w.push('Con filtro de producto o categoría solo se muestran ventas y costos: los cobros, gastos y la ganancia neta no se pueden asignar a un producto.')
  else if (m.sales > 0 && m.expenses === 0) w.push('No hay gastos registrados en este periodo: la ganancia neta no descuenta renta, servicios ni otros gastos, así que no es definitiva. Registra tus gastos con el botón «+».')
  const figs = sold.flatMap((o) => lineFigs(o, c, NO_FILTERS))
  const z = figs.filter((x) => x.zeroCost).length
  if (z) w.push(`${z} producto(s) vendidos no tenían costo calculado (receta sin ingredientes): la ganancia está sobreestimada.`)
  if (figs.some((x) => x.zeroPrice)) w.push('Hay productos vendidos con precio $0.00; revisa los pedidos.')
  const noLabor = new Set(figs.map((x) => x.recipeId).filter((id) => { const rc = c.recipes.find((x) => x.id === id); return rc && rc.laborRateCents === 0 }))
  if (noLabor.size) w.push(`${noLabor.size} receta(s) vendidas no incluyen mano de obra (tarifa $0): tu trabajo no está contando como costo.`)
  return w
}

/* ---------- Detalle de una cifra ---------- */
export function movementsIn(c: Ctx, r: Range, f: Filters): { payments: { p: Payment; o: Order }[]; expenses: Expense[]; purchases: Purchase[] } {
  return {
    payments: c.orders.filter((o) => statusOk(o, f.status)).flatMap((o) => o.payments.map((p) => ({ p, o }))).filter((x) => inRange(x.p.date, r)).sort((a, b) => b.p.date.localeCompare(a.p.date)),
    expenses: c.expenses.filter((e) => inRange(e.date, r)).sort((a, b) => b.date.localeCompare(a.date)),
    purchases: c.purchases.filter((p) => inRange(p.date, r)).sort((a, b) => b.date.localeCompare(a.date)),
  }
}
