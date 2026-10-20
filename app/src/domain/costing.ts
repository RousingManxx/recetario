import type { Ingredient, Purchase, Recipe, Tool } from './types'
import { dimensionOf, qtyInBase } from './units'
import { round } from './money'

/** Costo unitario (centavos por g/ml/pza) a partir de una compra: (precio − descuento + extras) / cantidad base. */
export function costPerBaseFromPurchase(p: Pick<Purchase, 'qty' | 'unit' | 'priceCents' | 'discountCents' | 'extraCents'>): number {
  if (!(p.qty > 0)) throw new Error('La cantidad comprada debe ser mayor que cero')
  const total = p.priceCents - p.discountCents + p.extraCents
  if (total < 0) throw new Error('El total de la compra no puede ser negativo')
  return total / qtyInBase(p.qty, p.unit, dimensionOf(p.unit))
}

export interface CostBreakdown {
  ingredientsCents: number
  wasteCents: number
  laborCents: number
  energyCents: number
  otherCents: number
  packagingCents: number
  toolsCents: number
  totalCents: number
  usableUnits: number
  unitCostCents: number
  portionCostCents: number
  missing: string[]
  missingTools: string[]
}

export function ingredientLineCost(ing: Ingredient, qty: number, unit: Recipe['components'][number]['unit']): number {
  return qtyInBase(qty, unit, ing.dimension, ing.density) * ing.costPerBase
}

/**
 * Costo de producción de una tanda. Merma de ingredientes se suma al costo de ingredientes; merma de
 * producto terminado reduce las unidades vendibles. Cada rubro indirecto usa UN solo modo (sin duplicar).
 */
export function recipeCost(r: Recipe, ings: Map<string, Ingredient>, tools: Map<string, Tool> = new Map()): CostBreakdown {
  const missing: string[] = []
  const missingTools: string[] = []
  let toolsRaw = 0
  for (const u of r.toolUses ?? []) {
    const t = tools.get(u.toolId)
    if (!t) { missingTools.push(u.toolId); continue }
    toolsRaw += (t.priceCents * Math.min(Math.max(u.pct, 0), 100)) / 100
  }
  const toolsCents = round(toolsRaw)
  let raw = 0
  for (const c of r.components) {
    const ing = ings.get(c.ingredientId)
    if (!ing) { missing.push(c.ingredientId); continue }
    raw += ingredientLineCost(ing, c.qty, c.unit)
  }
  const waste = raw * (r.ingredientWastePct / 100)
  const ingredientsCents = round(raw)
  const wasteCents = round(raw + waste) - ingredientsCents
  const labor =
    r.laborMode === 'hora' ? (r.laborRateCents * r.activeMin) / 60
    : r.laborMode === 'minuto' ? r.laborRateCents * r.activeMin
    : r.laborRateCents * r.laborOps
  const energy =
    r.energyMode === 'fijo' ? r.energyValue
    : r.energyMode === 'porcentaje' ? (raw * r.energyValue) / 100
    : (r.energyValue * r.bakeMin) / 60
  const usableUnits = Math.max(r.yieldQty * (1 - r.finishedWastePct / 100), 0)
  const packagingCents = round(r.packagingCentsPerUnit * usableUnits)
  const laborCents = round(labor), energyCents = round(energy)
  const totalCents = ingredientsCents + wasteCents + laborCents + energyCents + r.otherCents + packagingCents + toolsCents
  const unitCostCents = usableUnits > 0 ? round(totalCents / usableUnits) : 0
  return {
    ingredientsCents, wasteCents, laborCents, energyCents, otherCents: r.otherCents, packagingCents, toolsCents,
    totalCents, usableUnits, unitCostCents,
    portionCostCents: r.portionsPerUnit > 0 ? round(unitCostCents / r.portionsPerUnit) : unitCostCents,
    missing, missingTools,
  }
}

export const totalMinutes = (r: Recipe): number => r.totalMin ?? r.activeMin + r.bakeMin + r.restMin

/** Ingredientes cuyo precio no se actualiza desde hace `days` días. */
export function staleIngredients(ings: Ingredient[], days: number, now = new Date()): Ingredient[] {
  const limit = now.getTime() - days * 86400000
  return ings.filter((i) => new Date(i.priceUpdatedAt).getTime() < limit)
}
