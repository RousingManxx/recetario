import { round } from './money'

export interface PriceAnalysis {
  profitCents: number
  commissionCents: number
  marginPct: number | null
  markupPct: number | null
}

/** Ganancia = precio − costo − comisión. Margen sobre venta; recargo sobre costo. null si el divisor es 0. */
export function analyzePrice(priceCents: number, unitCostCents: number, commissionPct = 0): PriceAnalysis {
  const commissionCents = round((priceCents * commissionPct) / 100)
  const profitCents = priceCents - unitCostCents - commissionCents
  return {
    profitCents, commissionCents,
    marginPct: priceCents > 0 ? (profitCents / priceCents) * 100 : null,
    markupPct: unitCostCents > 0 ? (profitCents / unitCostCents) * 100 : null,
  }
}

/**
 * Precio = costo / (1 − margen − comisión%). Devuelve null si el margen+comisión ≥ 100 % o son inválidos.
 * La comisión se integra a la ecuación para no subestimar el costo.
 */
export function priceForMargin(unitCostCents: number, targetMarginPct: number, commissionPct = 0): number | null {
  if (![unitCostCents, targetMarginPct, commissionPct].every(Number.isFinite)) return null
  if (unitCostCents < 0 || targetMarginPct < 0 || commissionPct < 0) return null
  const d = 1 - (targetMarginPct + commissionPct) / 100
  if (d <= 1e-9) return null
  return round(unitCostCents / d)
}

export function scenarios(unitCostCents: number, commissionPct: number, margins = [30, 40, 50, 60, 70]) {
  return margins.map((m) => {
    const price = priceForMargin(unitCostCents, m, commissionPct)
    return { marginPct: m, priceCents: price, analysis: price == null ? null : analyzePrice(price, unitCostCents, commissionPct) }
  })
}
