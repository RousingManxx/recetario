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
  await loadMacaronDemo({ date, mk, ings, base, huevo, azucar, mantequilla, choc, tools })
  await saveSettings({ demoLoaded: true })
}

/**
 * Macarrones armados con recetas SEPARADAS: «Tapas» y un relleno por sabor, más la caja. Cada receta rinde «piezas» (1 tapa, 1 relleno, 1 caja)
 * y se agregan como líneas distintas de un mismo pedido: 1 macarrón = 2 tapas + 1 relleno. Precio de cada pieza con margen del 60 %.
 */
async function loadMacaronDemo(c: {
  date: string; mk: (name: string, category: string, qty: number, unit: Unit, price: number) => Promise<Ingredient>
  ings: Map<string, Ingredient>; base: Omit<Recipe, 'id' | 'name' | 'kind' | 'components' | 'yieldQty' | 'activeMin' | 'bakeMin' | 'restMin'> & Partial<Recipe>
  huevo: Ingredient; azucar: Ingredient; mantequilla: Ingredient; choc: Ingredient; tools: Map<string, Tool>
}) {
  const { date, mk, base, huevo, azucar, mantequilla, choc } = c
  const [almendra, glass, colorante, crema, fresa, pistache, caja] = await Promise.all([
    mk('Harina de almendra (demo)', 'Harinas y secos', 500, 'g', 380), mk('Azúcar glass (demo)', 'Azúcares', 1, 'kg', 38),
    mk('Colorante en gel (demo)', 'Saborizantes', 20, 'g', 60), mk('Crema para batir (demo)', 'Lácteos y huevo', 1, 'l', 75),
    mk('Puré de fresa (demo)', 'Frutas', 500, 'g', 90), mk('Pasta de pistache (demo)', 'Saborizantes', 200, 'g', 260),
    mk('Caja para 6 macarrones (demo)', 'Empaque', 10, 'pza', 85),
  ])
  const ings = new Map(c.ings); for (const i of [almendra, glass, colorante, crema, fresa, pistache, caja]) ings.set(i.id, i)
  const mkTool = (name: string, price: number, lifeUses: number, notes: string): Tool => ({ id: uid(), name: `${name} (demo)`, priceCents: price * 100, priceUpdatedAt: date, lifeUses, notes, createdAt: new Date().toISOString(), demo: true })
  const toolList = [mkTool('Tapete para macarrón', 350, 150, 'Con guía de círculos'), mkTool('Manga pastelera y duya', 120, 100, ''), mkTool('Tamiz fino', 150, 300, 'Para almendra y azúcar glass'), mkTool('Báscula digital', 280, 1000, 'Precisión de 1 g')]
  await db.tools.bulkAdd(toolList)
  const common = { ...base, packagingCentsPerUnit: 0, ingredientWastePct: 3, finishedWastePct: 0, portionsPerUnit: 1, category: 'Macarrones', energyValue: 500 }
  const tapas: Recipe = {
    ...common, id: uid(), name: 'Tapas de macarrón (demo)', kind: 'producto', yieldQty: 60, finishedWastePct: 10, activeMin: 90, bakeMin: 18, restMin: 45, toolWearPct: 3, energyValue: 700,
    description: 'Cascarones sin relleno. Cada unidad = 1 tapa; 2 tapas + 1 relleno = 1 macarrón. Rinde 60 tapas (30 macarrones) y se pierde ~10 % por grietas o huecos.',
    components: [{ ingredientId: almendra.id, qty: 100, unit: 'g' }, { ingredientId: glass.id, qty: 100, unit: 'g' }, { ingredientId: azucar.id, qty: 100, unit: 'g' }, { ingredientId: huevo.id, qty: 3, unit: 'pza' }, { ingredientId: colorante.id, qty: 1, unit: 'g' }],
    steps: '1. Tamizar almendra y azúcar glass. 2. Merengue con claras y azúcar. 3. Macaronage. 4. Manga: círculos en el tapete. 5. Reposar 45 min y hornear.',
    notes: 'Herramientas: tapete para macarrón, manga con duya, tamiz y báscula.',
  }
  const filling = (name: string, sabor: string, components: Recipe['components'], extra: Partial<Recipe> = {}): Recipe => ({
    ...common, id: uid(), name: `${name} (demo)`, kind: 'producto', yieldQty: 30, activeMin: 25, bakeMin: 0, restMin: 60, toolWearPct: 1, energyValue: 0,
    description: `Relleno sabor ${sabor}. Cada unidad = 1 relleno (alcanza para 1 macarrón); la tanda rinde 30.`, components, ...extra,
  })
  const ganache = filling('Relleno de ganache de chocolate', 'chocolate', [{ ingredientId: choc.id, qty: 150, unit: 'g' }, { ingredientId: crema.id, qty: 100, unit: 'ml' }, { ingredientId: mantequilla.id, qty: 20, unit: 'g' }])
  const fresaR = filling('Relleno de fresa', 'fresa', [{ ingredientId: mantequilla.id, qty: 90, unit: 'g' }, { ingredientId: glass.id, qty: 120, unit: 'g' }, { ingredientId: fresa.id, qty: 80, unit: 'g' }])
  const pistacheR = filling('Relleno de pistache', 'pistache', [{ ingredientId: pistache.id, qty: 60, unit: 'g' }, { ingredientId: crema.id, qty: 100, unit: 'ml' }, { ingredientId: glass.id, qty: 40, unit: 'g' }])
  const cajaR: Recipe = {
    ...common, id: uid(), name: 'Caja para 6 macarrones (demo)', kind: 'caja', yieldQty: 1, activeMin: 3, bakeMin: 0, restMin: 0, toolWearPct: 0, energyValue: 0, ingredientWastePct: 0, targetMarginPct: 50,
    description: 'Empaque de regalo; se agrega una caja por cada 6 macarrones.', components: [{ ingredientId: caja.id, qty: 1, unit: 'pza' }],
  }
  const recipes = [tapas, ganache, fresaR, pistacheR, cajaR]
  for (const r of recipes) r.priceCents = priceForMargin(recipeCost(r, ings).unitCostCents, r.targetMarginPct ?? 60) ?? 0
  await db.recipes.bulkAdd(recipes)

  const cust = { id: uid(), name: 'Sofía Ramírez (demo)', phone: '55 1111 2222', notes: 'Pide macarrones surtidos para eventos.', createdAt: new Date().toISOString(), demo: true }
  await db.customers.add(cust)
  // 12 de fresa + 6 de chocolate = 18 macarrones → 36 tapas, 12 + 6 rellenos y 3 cajas de 6.
  const line = (r: Recipe, qty: number, customization = '') => ({ ...lineFromRecipe(r, ings, qty), customization })
  let o = await saveOrder({
    id: uid(), folio: '', customerId: cust.id, customerName: cust.name, createdAt: new Date().toISOString(), deliveryAt: new Date(Date.now() + 4 * 86400000).toISOString(), status: 'cotizacion',
    lines: [line(tapas, 36, '18 rosa y 18 café'), line(fresaR, 12), line(ganache, 6), line(cajaR, 3, 'Moño dorado')],
    discountCents: 0, deliveryFeeCents: 0, payments: [], adjustments: [], message: 'Para el evento de Sofía: 12 macarrones de fresa y 6 de chocolate.', notes: '', demo: true,
  })
  o = transition(o, 'confirmado', new Map(recipes.map((r) => [r.id, r])), ings)
  await saveOrder({ ...o, payments: [{ id: uid(), date: localDate(new Date()), amountCents: 15000, method: 'efectivo' }] })
}
