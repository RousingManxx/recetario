import { createIngredient, db, saveOrder, saveSettings, uid } from './db'
import { recipeCost } from '../domain/costing'
import { lineFromRecipe, transition } from '../domain/orders'
import { priceForMargin } from '../domain/pricing'
import type { Ingredient, Recipe, Tool, Unit } from '../domain/types'

/** Fecha local YYYY-MM-DD (no UTC: por la noche en México la fecha UTC ya es «mañana»). */
const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Carga ejemplos marcados con demo:true. Se pueden borrar sin tocar los datos reales. */
export async function loadDemo() {
  const date = localDate(new Date(Date.now() - 20 * 86400000))
  const mk = async (name: string, category: string, qty: number, unit: Unit, price: number) =>
    createIngredient({ name, category, demo: true }, { date, qty, unit, priceCents: price * 100, discountCents: 0, extraCents: 0, demo: true })
  const [harina, azucar, cacao, huevo, mantequilla, choc] = await Promise.all([
    mk('Harina de trigo (demo)', 'Harinas y secos', 1, 'kg', 24), mk('Azúcar (demo)', 'Azúcares', 1, 'kg', 32),
    mk('Cacao en polvo (demo)', 'Chocolates', 500, 'g', 140), mk('Huevo (demo)', 'Lácteos y huevo', 30, 'pza', 90),
    mk('Mantequilla (demo)', 'Grasas', 90, 'g', 38), mk('Chocolate semiamargo (demo)', 'Chocolates', 1, 'kg', 180),
  ])
  const ings = new Map<string, Ingredient>([harina, azucar, cacao, huevo, mantequilla, choc].map((i) => [i.id, i]))
  const base = { category: 'Pasteles', description: '', favorite: false, portionsPerUnit: 1, ingredientWastePct: 3, finishedWastePct: 0, laborMode: 'hora' as const, laborRateCents: 6000, laborOps: 1, energyMode: 'fijo' as const, energyValue: 600, otherCents: 0, packagingCentsPerUnit: 1500, commissionPct: 0, targetMarginPct: 60, steps: '', notes: '', updatedAt: new Date().toISOString(), demo: true }
  const tapete: Tool = { id: uid(), name: 'Tapete de silicón (demo)', priceCents: 30000, priceUpdatedAt: date, lifeUses: 200, notes: 'Dura ~200 tandas', createdAt: new Date().toISOString(), demo: true }
  await db.tools.add(tapete)
  const tools = new Map<string, Tool>([[tapete.id, tapete]]) // catálogo de ejemplo; el cobro va en «Uso de herramientas %» de la receta
  const cake: Recipe = {
    ...base, id: uid(), name: 'Pastel de chocolate (demo)', kind: 'pastel', portionsPerUnit: 8, yieldQty: 1, activeMin: 60, bakeMin: 40, restMin: 120,
    components: [{ ingredientId: harina.id, qty: 250, unit: 'g' }, { ingredientId: azucar.id, qty: 200, unit: 'g' }, { ingredientId: cacao.id, qty: 60, unit: 'g' }, { ingredientId: huevo.id, qty: 4, unit: 'pza' }, { ingredientId: mantequilla.id, qty: 180, unit: 'g' }, { ingredientId: choc.id, qty: 200, unit: 'g' }],
    steps: '1. Mezclar secos. 2. Batir huevos y azúcar. 3. Hornear a 175 °C.',
    toolWearPct: 2,
  }
  const cookies: Recipe = {
    ...base, id: uid(), name: 'Galletas de chispas (demo)', category: 'Galletas', kind: 'producto', yieldQty: 24, activeMin: 30, bakeMin: 15, restMin: 20, packagingCentsPerUnit: 300, energyValue: 400,
    components: [{ ingredientId: harina.id, qty: 300, unit: 'g' }, { ingredientId: azucar.id, qty: 150, unit: 'g' }, { ingredientId: mantequilla.id, qty: 180, unit: 'g' }, { ingredientId: huevo.id, qty: 2, unit: 'pza' }, { ingredientId: choc.id, qty: 150, unit: 'g' }],
  }
  for (const r of [cake, cookies]) r.priceCents = priceForMargin(recipeCost(r, ings, tools).unitCostCents, 60) ?? 0
  await db.recipes.bulkAdd([cake, cookies])
  const rm = new Map([cake, cookies].map((r) => [r.id, r]))
  const cust = { id: uid(), name: 'Ana López (demo)', phone: '55 0000 0000', notes: 'Prefiere poco dulce.', createdAt: new Date().toISOString(), demo: true }
  await db.customers.add(cust)
  const soon = new Date(Date.now() + 2 * 86400000).toISOString()
  let o = await saveOrder({
    id: uid(), folio: '', customerId: cust.id, customerName: cust.name, createdAt: new Date().toISOString(), deliveryAt: soon, status: 'cotizacion',
    lines: [lineFromRecipe(cake, ings, 1, tools), lineFromRecipe(cookies, ings, 2, tools)], discountCents: 0, deliveryFeeCents: 0, payments: [], adjustments: [], message: 'Feliz cumpleaños, Ana', notes: '', demo: true,
  })
  o = transition(o, 'confirmado', rm, ings, new Date(), tools)
  await saveOrder({ ...o, payments: [{ id: uid(), date: localDate(new Date()), amountCents: 20000, method: 'transferencia' }] })
  await saveSettings({ demoLoaded: true })
}
