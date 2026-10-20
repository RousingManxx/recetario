import Dexie, { type Table } from 'dexie'
import type { Customer, Expense, Ingredient, Order, Purchase, Recipe, Settings } from '../domain/types'
import { buildBackup, mergeSnapshots, type BackupFile, type Snapshot } from '../domain/backup'
import { costPerBaseFromPurchase } from '../domain/costing'
import { dimensionOf } from '../domain/units'
import { formatFolio } from '../domain/orders'

export class AppDB extends Dexie {
  ingredients!: Table<Ingredient, string>
  purchases!: Table<Purchase, string>
  recipes!: Table<Recipe, string>
  customers!: Table<Customer, string>
  orders!: Table<Order, string>
  expenses!: Table<Expense, string>
  settings!: Table<Settings, string>

  constructor(name = 'recetasapp') {
    super(name)
    this.version(1).stores({
      ingredients: 'id, name, category',
      purchases: 'id, ingredientId, date',
      recipes: 'id, name, category, favorite',
      customers: 'id, name',
      orders: 'id, folio, status, deliveryAt, customerId',
      expenses: 'id, date',
      settings: 'id',
    })
  }
}

export let db = new AppDB()
export const useDb = (d: AppDB) => { db = d }

export const uid = () => crypto.randomUUID()

export const defaultSettings = (): Settings => ({
  id: 'main', businessName: '', currency: 'MXN', locale: 'es-MX', nextFolio: 1,
  defaultLaborMode: 'hora', defaultLaborRateCents: 0, defaultMarginPct: 60, staleDays: 60,
  onboarding: {}, onboardingDone: false, demoLoaded: false,
})

export async function getSettings(d = db): Promise<Settings> {
  return (await d.settings.get('main')) ?? defaultSettings()
}
export const saveSettings = (s: Partial<Settings>, d = db) =>
  d.transaction('rw', d.settings, async () => d.settings.put({ ...(await getSettings(d)), ...s, id: 'main' }))

/** Registra una compra y actualiza el costo vigente; el historial de compras se conserva. */
export async function addPurchase(p: Omit<Purchase, 'id'>, d = db): Promise<Purchase> {
  const full: Purchase = { ...p, id: uid(), at: new Date().toISOString() }
  const cost = costPerBaseFromPurchase(full)
  await d.transaction('rw', d.purchases, d.ingredients, async () => {
    const ing = await d.ingredients.get(p.ingredientId)
    if (!ing) throw new Error('Ingrediente inexistente')
    if (ing.dimension !== dimensionOf(p.unit)) throw new Error('La unidad no coincide con el tipo de ingrediente')
    await d.purchases.add(full)
    await d.ingredients.update(ing.id, { costPerBase: cost, priceUpdatedAt: p.date })
  })
  return full
}

/** Crea un ingrediente junto con su primera compra. */
export async function createIngredient(
  base: Omit<Ingredient, 'id' | 'costPerBase' | 'priceUpdatedAt' | 'createdAt' | 'dimension'>,
  purchase: Omit<Purchase, 'id' | 'ingredientId'>, d = db,
): Promise<Ingredient> {
  const now = new Date().toISOString()
  const ing: Ingredient = {
    ...base, id: uid(), dimension: dimensionOf(purchase.unit),
    costPerBase: costPerBaseFromPurchase(purchase), priceUpdatedAt: purchase.date, createdAt: now,
  }
  await d.transaction('rw', d.ingredients, d.purchases, async () => {
    await d.ingredients.add(ing)
    await d.purchases.add({ ...purchase, id: uid(), at: now, ingredientId: ing.id, demo: base.demo })
  })
  return ing
}

/** Guarda un pedido; si es nuevo asigna folio único de forma atómica. */
export async function saveOrder(o: Order, d = db): Promise<Order> {
  return d.transaction('rw', d.orders, d.settings, async () => {
    const existing = await d.orders.get(o.id)
    let order = o
    if (!existing && !o.folio) {
      const s = await getSettings(d)
      order = { ...o, folio: formatFolio(s.nextFolio) }
      await d.settings.put({ ...s, nextFolio: s.nextFolio + 1 })
    }
    await d.orders.put(order)
    return order
  })
}

export async function ingredientInUse(id: string, d = db): Promise<string[]> {
  return (await d.recipes.toArray()).filter((r) => r.components.some((c) => c.ingredientId === id)).map((r) => r.name)
}

export async function snapshot(d = db): Promise<Snapshot> {
  const [ingredients, purchases, recipes, customers, orders, expenses, settings] = await Promise.all([
    d.ingredients.toArray(), d.purchases.toArray(), d.recipes.toArray(), d.customers.toArray(),
    d.orders.toArray(), d.expenses.toArray(), d.settings.get('main'),
  ])
  return { ingredients, purchases, recipes, customers, orders, expenses, settings: settings ?? null }
}

export async function createBackup(d = db): Promise<BackupFile> {
  const now = new Date()
  await saveSettings({ lastBackupAt: now.toISOString() }, d)
  return buildBackup(await snapshot(d), now)
}

/**
 * Restaura en una sola transacción: si algo falla, Dexie revierte todo y los datos previos quedan intactos.
 * 'reemplazar' conserva los registros demo ajenos a la copia solo si mode='combinar'.
 */
export async function restoreBackup(file: BackupFile, mode: 'reemplazar' | 'combinar', d = db) {
  const local = await snapshot(d)
  const before = { ...local }
  let result: Snapshot, added: number, skipped = 0
  if (mode === 'combinar') {
    const m = mergeSnapshots(local, file)
    result = m.result; added = m.added; skipped = m.skipped
  } else {
    result = file
    added = file.ingredients.length + file.purchases.length + file.recipes.length + file.customers.length + file.orders.length + file.expenses.length
  }
  await d.transaction('rw', [d.ingredients, d.purchases, d.recipes, d.customers, d.orders, d.expenses, d.settings], async () => {
    if (mode === 'reemplazar') await Promise.all([d.ingredients, d.purchases, d.recipes, d.customers, d.orders, d.expenses].map((t) => t.clear()))
    await d.ingredients.bulkPut(result.ingredients)
    await d.purchases.bulkPut(result.purchases)
    await d.recipes.bulkPut(result.recipes)
    await d.customers.bulkPut(result.customers)
    await d.orders.bulkPut(result.orders)
    await d.expenses.bulkPut(result.expenses)
    if (result.settings) await d.settings.put({ ...result.settings, id: 'main' })
  })
  return { added, skipped, replacedCounts: before.orders.length }
}

export async function deleteDemoData(d = db) {
  await d.transaction('rw', [d.ingredients, d.purchases, d.recipes, d.customers, d.orders, d.expenses, d.settings], async () => {
    for (const t of [d.ingredients, d.purchases, d.recipes, d.customers, d.orders, d.expenses] as Dexie.Table<{ id: string; demo?: boolean }, string>[]) {
      const ids = (await t.toArray()).filter((x) => x.demo).map((x) => x.id)
      await t.bulkDelete(ids)
    }
    await saveSettings({ demoLoaded: false }, d)
  })
}
