import type { CostShares, Ingredient, Order, OrderLine, OrderStatus, PaymentStatus, Recipe, Tool } from './types'
import { recipeCost, type CostBreakdown } from './costing'
import { round } from './money'

export const STATUS_LABEL: Record<OrderStatus, string> = {
  cotizacion: 'Cotización', confirmado: 'Confirmado', preparacion: 'En preparación',
  listo: 'Listo para entregar', entregado: 'Entregado', cancelado: 'Cancelado',
}
export const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  sin_pago: 'Sin pago', anticipo: 'Anticipo recibido', parcial: 'Parcialmente pagado', pagado: 'Pagado', reembolsado: 'Reembolsado',
}

const lineTotal = (l: OrderLine) => round(l.qty * l.unitPriceCents)

export interface OrderTotals {
  subtotalCents: number
  totalCents: number
  paidCents: number
  balanceCents: number
  costCents: number
  commissionCents: number
  adjustmentsCents: number
  profitCents: number
  marginPct: number | null
}

export function orderTotals(o: Order): OrderTotals {
  const subtotalCents = o.lines.reduce((s, l) => s + lineTotal(l), 0)
  const totalCents = Math.max(subtotalCents - o.discountCents, 0) + o.deliveryFeeCents
  const paidCents = o.payments.reduce((s, p) => s + p.amountCents, 0)
  const costCents = o.lines.reduce((s, l) => s + round(l.qty * l.unitCostCents), 0)
  const commissionCents = o.lines.reduce((s, l) => s + round((lineTotal(l) * l.commissionPct) / 100), 0)
  const adjustmentsCents = o.adjustments.reduce((s, a) => s + a.amountCents, 0)
  const profitCents = totalCents - costCents - commissionCents - adjustmentsCents
  return {
    subtotalCents, totalCents, paidCents, balanceCents: totalCents - paidCents,
    costCents, commissionCents, adjustmentsCents, profitCents,
    marginPct: totalCents > 0 ? (profitCents / totalCents) * 100 : null,
  }
}

/** El estado de pago se deriva de los pagos; es independiente del estado de preparación. */
export function paymentStatus(o: Order): PaymentStatus {
  const t = orderTotals(o)
  const hasRefund = o.payments.some((p) => p.amountCents < 0)
  if (t.paidCents <= 0) return hasRefund ? 'reembolsado' : 'sin_pago'
  if (t.paidCents >= t.totalCents && t.totalCents > 0) return 'pagado'
  const first = o.payments.filter((p) => p.amountCents > 0)
  return first.length === 1 && o.status !== 'entregado' ? 'anticipo' : 'parcial'
}

export function sharesOf(c: CostBreakdown): CostShares | undefined {
  if (c.totalCents <= 0) return undefined
  const t = c.totalCents
  return { ingredients: (c.ingredientsCents + c.wasteCents) / t, labor: c.laborCents / t, energy: c.energyCents / t, packaging: c.packagingCents / t, other: c.otherCents / t, tools: c.toolsCents / t }
}

export function lineFromRecipe(r: Recipe, ings: Map<string, Ingredient>, qty = 1, tools?: Map<string, Tool>): OrderLine {
  const c = recipeCost(r, ings, tools)
  return {
    id: crypto.randomUUID(), recipeId: r.id, name: r.name, qty,
    unitPriceCents: r.priceCents ?? 0, unitCostCents: c.unitCostCents, costShares: sharesOf(c),
    commissionPct: r.commissionPct, customization: '',
  }
}

const ORDER: OrderStatus[] = ['cotizacion', 'confirmado', 'preparacion', 'listo', 'entregado']
export const nextStatus = (s: OrderStatus): OrderStatus | null =>
  s === 'cancelado' ? null : ORDER[ORDER.indexOf(s) + 1] ?? null

export class OrderError extends Error {}

/**
 * Cambia el estado. Al confirmar se congelan los costos con las recetas vigentes en ese momento; después
 * los cambios en recetas/ingredientes no alteran el pedido. Un pedido sin líneas no se confirma.
 */
export function transition(
  o: Order, to: OrderStatus, recipes: Map<string, Recipe>, ings: Map<string, Ingredient>, now = new Date(), tools?: Map<string, Tool>,
): Order {
  if (o.status === to) return o
  if (o.status === 'cancelado' || o.status === 'entregado' && to !== 'cancelado')
    throw new OrderError('Este pedido ya está cerrado')
  if (to !== 'cancelado' && o.lines.length === 0) throw new OrderError('Agrega al menos un producto')
  let lines = o.lines
  let confirmedAt = o.confirmedAt
  if (o.status === 'cotizacion' && to !== 'cancelado') {
    lines = o.lines.map((l) => {
      const r = recipes.get(l.recipeId)
      if (!r) return l
      const c = recipeCost(r, ings, tools)
      return { ...l, unitCostCents: c.unitCostCents, costShares: sharesOf(c), commissionPct: r.commissionPct }
    })
    confirmedAt = now.toISOString()
  }
  return { ...o, status: to, lines, confirmedAt }
}

/** Una cotización refleja costos vigentes; un pedido confirmado nunca se refresca. */
export function refreshQuote(o: Order, recipes: Map<string, Recipe>, ings: Map<string, Ingredient>, tools?: Map<string, Tool>): Order {
  if (o.status !== 'cotizacion') return o
  return { ...o, lines: o.lines.map((l) => {
    const r = recipes.get(l.recipeId)
    if (!r) return l
    const c = recipeCost(r, ings, tools)
    return { ...l, unitCostCents: c.unitCostCents, costShares: sharesOf(c) }
  }) }
}

export const formatFolio = (n: number) => `PED-${String(n).padStart(4, '0')}`
