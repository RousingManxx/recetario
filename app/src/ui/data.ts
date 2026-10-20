import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db, defaultSettings } from '../db/db'
import type { Customer, Expense, Ingredient, Order, Purchase, Recipe, Settings } from '../domain/types'

export interface Data {
  ready: boolean
  ingredients: Ingredient[]; recipes: Recipe[]; customers: Customer[]; orders: Order[]; expenses: Expense[]; purchases: Purchase[]
  settings: Settings
  ingMap: Map<string, Ingredient>; recipeMap: Map<string, Recipe>
}

const E: never[] = []
export function useData(): Data {
  const ingredients = useLiveQuery(() => db.ingredients.toArray())
  const recipes = useLiveQuery(() => db.recipes.toArray())
  const customers = useLiveQuery(() => db.customers.toArray())
  const orders = useLiveQuery(() => db.orders.toArray())
  const expenses = useLiveQuery(() => db.expenses.toArray())
  const purchases = useLiveQuery(() => db.purchases.toArray())
  const settings = useLiveQuery(async () => (await db.settings.get('main')) ?? null)
  const ready = [ingredients, recipes, customers, orders, expenses, purchases, settings].every((x) => x !== undefined)
  return useMemo(() => {
    const ing = ingredients ?? E, rec = recipes ?? E
    return {
      ready, ingredients: ing, recipes: rec, customers: customers ?? E, orders: orders ?? E, expenses: expenses ?? E, purchases: purchases ?? E,
      settings: settings ?? defaultSettings(),
      ingMap: new Map(ing.map((i) => [i.id, i])), recipeMap: new Map(rec.map((r) => [r.id, r])),
    }
  }, [ready, ingredients, recipes, customers, orders, expenses, purchases, settings])
}

export function download(name: string, content: string | Blob, type = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10) }
export const fmtDate = (iso: string) => iso ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + 'T00:00:00' : iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
export const fmtDateTime = (iso: string) => iso ? new Date(iso).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
/** Valor para <input type="datetime-local"> en hora local. */
export const toLocalInput = (iso: string) => { const d = iso ? new Date(iso) : new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
