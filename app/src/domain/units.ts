import type { Dimension, Unit } from './types'

interface UnitDef { dim: Dimension; toBase: number; label: string }

// Base: g, ml, pza. Cucharadas/tazas son volumen (no se mezclan con masa sin densidad).
export const UNITS: Record<Unit, UnitDef> = {
  g: { dim: 'masa', toBase: 1, label: 'g' },
  kg: { dim: 'masa', toBase: 1000, label: 'kg' },
  ml: { dim: 'volumen', toBase: 1, label: 'ml' },
  l: { dim: 'volumen', toBase: 1000, label: 'l' },
  cda: { dim: 'volumen', toBase: 15, label: 'cda' },
  cdta: { dim: 'volumen', toBase: 5, label: 'cdta' },
  taza: { dim: 'volumen', toBase: 240, label: 'taza' },
  pza: { dim: 'pieza', toBase: 1, label: 'pza' },
  docena: { dim: 'pieza', toBase: 12, label: 'docena' },
}

export const unitsOf = (d: Dimension): Unit[] =>
  (Object.keys(UNITS) as Unit[]).filter((u) => UNITS[u].dim === d)

export const dimensionOf = (u: Unit): Dimension => UNITS[u].dim

export class UnitError extends Error {}

/** Convierte a la unidad base de su dimensión (g, ml, pza). */
export function toBase(qty: number, unit: Unit): number {
  return qty * UNITS[unit].toBase
}

/**
 * Convierte entre unidades. Misma dimensión: directo. Masa↔volumen: solo con densidad (g/ml)
 * explícita. Pieza no se convierte con nada más.
 */
export function convert(qty: number, from: Unit, to: Unit, density?: number): number {
  const a = UNITS[from], b = UNITS[to]
  const base = qty * a.toBase
  if (a.dim === b.dim) return base / b.toBase
  if (a.dim === 'pieza' || b.dim === 'pieza') throw new UnitError(`No se puede convertir ${from} a ${to}`)
  if (!density || density <= 0) throw new UnitError(`Falta la densidad para convertir ${from} a ${to}`)
  const inB = a.dim === 'masa' ? base / density : base * density
  return inB / b.toBase
}

/** Cantidad `qty unit` expresada en la unidad base de la dimensión `target`. */
export function qtyInBase(qty: number, unit: Unit, target: Dimension, density?: number): number {
  const baseUnit: Unit = target === 'masa' ? 'g' : target === 'volumen' ? 'ml' : 'pza'
  return convert(qty, unit, baseUnit, density)
}
