import type { Expense, Order, OrderStatus } from './types'
import { orderTotals } from './orders'

export type Period = 'dia' | 'semana' | 'mes'

export function periodRange(p: Period, now = new Date()): [Date, Date] {
  const s = new Date(now); s.setHours(0, 0, 0, 0)
  const e = new Date(s)
  if (p === 'dia') e.setDate(e.getDate() + 1)
  else if (p === 'semana') { s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); e.setTime(s.getTime()); e.setDate(e.getDate() + 7) }
  else { s.setDate(1); e.setTime(s.getTime()); e.setMonth(e.getMonth() + 1) }
  return [s, e]
}

/** Las fechas sin hora (YYYY-MM-DD) se interpretan en hora local, no UTC. */
const parseLocal = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : new Date(s))
const inRange = (iso: string | undefined, [a, b]: [Date, Date]) => !!iso && parseLocal(iso) >= a && parseLocal(iso) < b
const isSale = (o: Order) => o.status !== 'cotizacion' && o.status !== 'cancelado'

export interface Summary {
  salesCents: number        // pedidos confirmados (comprometidos), por fecha de confirmación
  collectedCents: number    // pagos recibidos en el periodo (netos de reembolsos)
  costCents: number         // costo ESTIMADO de producción + comisiones + ajustes
  expensesCents: number     // gastos registrados
  grossProfitCents: number  // ventas − costos estimados
  netProfitCents: number    // ganancia bruta estimada − gastos registrados
  marginPct: number | null
  orderCount: number
  hasData: boolean
}

export function summarize(orders: Order[], expenses: Expense[], p: Period, now = new Date()): Summary {
  const range = periodRange(p, now)
  const sales = orders.filter((o) => isSale(o) && inRange(o.confirmedAt ?? o.createdAt, range))
  let salesCents = 0, costCents = 0
  for (const o of sales) { const t = orderTotals(o); salesCents += t.totalCents; costCents += t.costCents + t.commissionCents + t.adjustmentsCents }
  const collectedCents = orders.filter((o) => o.status !== 'cotizacion').flatMap((o) => o.payments)
    .filter((x) => inRange(x.date, range)).reduce((s, x) => s + x.amountCents, 0)
  const expensesCents = expenses.filter((e) => inRange(e.date, range)).reduce((s, e) => s + e.amountCents, 0)
  const grossProfitCents = salesCents - costCents
  return {
    salesCents, collectedCents, costCents, expensesCents, grossProfitCents,
    netProfitCents: grossProfitCents - expensesCents,
    marginPct: salesCents > 0 ? (grossProfitCents / salesCents) * 100 : null,
    orderCount: sales.length, hasData: sales.length > 0 || expensesCents > 0 || collectedCents !== 0,
  }
}

export function statusCounts(orders: Order[]): Record<OrderStatus, number> {
  const c: Record<OrderStatus, number> = { cotizacion: 0, confirmado: 0, preparacion: 0, listo: 0, entregado: 0, cancelado: 0 }
  for (const o of orders) c[o.status]++
  return c
}

export const upcoming = (orders: Order[], limit = 5, now = new Date()) =>
  orders.filter((o) => ['confirmado', 'preparacion', 'listo'].includes(o.status))
    .sort((a, b) => a.deliveryAt.localeCompare(b.deliveryAt)).filter((o) => new Date(o.deliveryAt) >= new Date(now.getTime() - 86400000)).slice(0, limit)

export interface Ranked { recipeId: string; name: string; units: number; revenueCents: number; profitCents: number }
/** Ventas y ganancia por producto usando los costos congelados en cada pedido. */
export function topRecipes(orders: Order[]): Ranked[] {
  const m = new Map<string, Ranked>()
  for (const o of orders.filter(isSale))
    for (const l of o.lines) {
      const rev = Math.round(l.qty * l.unitPriceCents)
      const profit = rev - Math.round(l.qty * l.unitCostCents) - Math.round((rev * l.commissionPct) / 100)
      const r = m.get(l.recipeId) ?? { recipeId: l.recipeId, name: l.name, units: 0, revenueCents: 0, profitCents: 0 }
      r.units += l.qty; r.revenueCents += rev; r.profitCents += profit; m.set(l.recipeId, r)
    }
  return [...m.values()].sort((a, b) => b.units - a.units)
}
