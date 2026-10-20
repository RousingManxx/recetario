import type { Customer, Expense, Ingredient, Order, Purchase, Recipe, Settings } from './types'

export const SCHEMA_VERSION = 1
export const FORMAT = 'recetasapp-backup'

export interface Snapshot {
  ingredients: Ingredient[]
  purchases: Purchase[]
  recipes: Recipe[]
  customers: Customer[]
  orders: Order[]
  expenses: Expense[]
  settings: Settings | null
}

export interface BackupFile extends Snapshot {
  format: typeof FORMAT
  schemaVersion: number
  createdAt: string
  appVersion: string
}

export const TABLES = ['ingredients', 'purchases', 'recipes', 'customers', 'orders', 'expenses'] as const
export type TableName = (typeof TABLES)[number]

export function buildBackup(s: Snapshot, now = new Date()): BackupFile {
  const real = <T extends { demo?: boolean }>(a: T[]) => a.filter((x) => !x.demo)
  return {
    format: FORMAT, schemaVersion: SCHEMA_VERSION, createdAt: now.toISOString(), appVersion: '1.0.0',
    ingredients: real(s.ingredients), purchases: real(s.purchases), recipes: real(s.recipes),
    customers: real(s.customers), orders: real(s.orders), expenses: real(s.expenses), settings: s.settings,
  }
}

/** Migraciones: clave = versión de origen. Cada una devuelve datos en la versión siguiente. */
const MIGRATIONS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {}

export interface ValidationReport {
  ok: boolean
  errors: string[]
  warnings: string[]
  counts: Record<TableName, number>
  data?: BackupFile
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

export function parseBackup(text: string): ValidationReport {
  const rep: ValidationReport = {
    ok: false, errors: [], warnings: [],
    counts: { ingredients: 0, purchases: 0, recipes: 0, customers: 0, orders: 0, expenses: 0 },
  }
  let raw: unknown
  try { raw = JSON.parse(text) } catch { rep.errors.push('El archivo no es un JSON válido.'); return rep }
  if (!isObj(raw) || raw.format !== FORMAT) { rep.errors.push('No es una copia de seguridad de esta aplicación.'); return rep }
  let v = raw.schemaVersion
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) { rep.errors.push('Falta la versión del esquema.'); return rep }
  if (v > SCHEMA_VERSION) { rep.errors.push(`La copia es de una versión más nueva (v${v}). Actualiza la aplicación.`); return rep }
  let d: Record<string, unknown> = raw
  while (v < SCHEMA_VERSION) {
    const m = MIGRATIONS[v]
    if (!m) { rep.errors.push(`No hay migración desde la versión ${v}.`); return rep }
    d = m(d); v++
  }
  for (const t of TABLES) {
    const arr = d[t]
    if (arr === undefined) { d[t] = []; rep.warnings.push(`La copia no incluye «${t}».`); continue }
    if (!Array.isArray(arr)) { rep.errors.push(`«${t}» debe ser una lista.`); continue }
    const seen = new Set<string>()
    arr.forEach((r, i) => {
      if (!isObj(r) || typeof r.id !== 'string' || !r.id) { rep.errors.push(`${t}[${i}]: registro sin id válido.`); return }
      if (seen.has(r.id)) rep.errors.push(`${t}: id duplicado «${r.id}».`)
      seen.add(r.id)
    })
    rep.counts[t] = arr.length
  }
  if (rep.errors.length) return rep
  const ids = (t: TableName) => new Set((d[t] as { id: string }[]).map((x) => x.id))
  const ing = ids('ingredients'), rec = ids('recipes'), cus = ids('customers')
  for (const c of d.recipes as Recipe[])
    for (const k of c.components ?? []) if (!ing.has(k.ingredientId)) rep.errors.push(`Receta «${c.name}»: ingrediente inexistente (${k.ingredientId}).`)
  for (const p of d.purchases as Purchase[]) if (!ing.has(p.ingredientId)) rep.errors.push(`Compra ${p.id}: ingrediente inexistente.`)
  for (const o of d.orders as Order[]) {
    if (o.customerId && !cus.has(o.customerId)) rep.errors.push(`Pedido ${o.folio}: cliente inexistente.`)
    for (const l of o.lines ?? []) if (!rec.has(l.recipeId)) rep.warnings.push(`Pedido ${o.folio}: la receta «${l.name}» ya no existe (se conserva la instantánea).`)
  }
  if (rep.errors.length) return rep
  rep.ok = true
  rep.data = { ...(d as unknown as BackupFile), schemaVersion: SCHEMA_VERSION }
  return rep
}

/** Fusión: añade registros nuevos; ante id repetido gana el más reciente (updatedAt) o se conserva el local. */
export function mergeSnapshots(local: Snapshot, incoming: Snapshot): { result: Snapshot; added: number; skipped: number } {
  let added = 0, skipped = 0
  const merge = <T extends { id: string }>(a: T[], b: T[]): T[] => {
    const m = new Map(a.map((x) => [x.id, x]))
    for (const r of b) { if (m.has(r.id)) skipped++; else { m.set(r.id, r); added++ } }
    return [...m.values()]
  }
  const result: Snapshot = {
      ingredients: merge(local.ingredients, incoming.ingredients),
      purchases: merge(local.purchases, incoming.purchases),
      recipes: merge(local.recipes, incoming.recipes),
      customers: merge(local.customers, incoming.customers),
      orders: merge(local.orders, incoming.orders),
      expenses: merge(local.expenses, incoming.expenses),
      settings: local.settings ?? incoming.settings,
  }
  return { result, added, skipped }
}
