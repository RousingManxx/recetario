import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDB, createBackup, deleteDemoData, restoreBackup, snapshot } from '../db/db'
import { buildBackup, mergeSnapshots, parseBackup, SCHEMA_VERSION } from '../domain/backup'
import { recipeCost } from '../domain/costing'
import { exportCsvs } from '../domain/csv'
import { computeMetrics, costDistribution, dataWarnings, NO_FILTERS, resolveRange, type Ctx } from '../domain/finance'
import { lineFromRecipe, orderTotals, transition } from '../domain/orders'
import { summarize } from '../domain/dashboard'
import type { Expense, Ingredient, Order, Recipe, Tool } from '../domain/types'

const tool = (o: Partial<Tool> = {}): Tool => ({ id: 't1', name: 'Tapete', priceCents: 30000, priceUpdatedAt: '2026-01-01', notes: '', createdAt: '2026-01-01', ...o })
const ing = (cost = 18): Ingredient => ({ id: 'choc', name: 'Choc', category: '', costPerBase: cost, dimension: 'masa', priceUpdatedAt: '2026-01-01', createdAt: '2026-01-01' })
const rec = (o: Partial<Recipe> = {}): Recipe => ({
  id: 'r1', name: 'Pastel', category: 'Pasteles', kind: 'pastel', description: '', favorite: false, components: [{ ingredientId: 'choc', qty: 200, unit: 'g' }], yieldQty: 1, portionsPerUnit: 1,
  activeMin: 0, bakeMin: 0, restMin: 0, ingredientWastePct: 0, finishedWastePct: 0, laborMode: 'hora', laborRateCents: 0, laborOps: 0, energyMode: 'fijo', energyValue: 0, otherCents: 0,
  packagingCentsPerUnit: 0, commissionPct: 0, targetMarginPct: 60, steps: '', notes: '', updatedAt: '', toolUses: [{ toolId: 't1', pct: 0.5 }], ...o,
})
const ings = new Map([['choc', ing()]])
const tools = (t = tool()) => new Map([[t.id, t]])

describe('costo de herramientas en la receta', () => {
  it('0.5 % de un tapete de $300 suma $1.50 a la tanda', () => {
    const c = recipeCost(rec(), ings, tools())
    expect(c.toolsCents).toBe(150)
    expect(c.totalCents).toBe(3600 + 150)
  })
  it('varias herramientas se suman; el porcentaje se limita a 0–100', () => {
    const r = rec({ toolUses: [{ toolId: 't1', pct: 0.5 }, { toolId: 't2', pct: 250 }, { toolId: 't1', pct: -5 }] })
    const c = recipeCost(r, ings, new Map([...tools(), ['t2', tool({ id: 't2', priceCents: 1000 })]]))
    expect(c.toolsCents).toBe(150 + 1000 + 0)
  })
  it('herramientas inexistentes se reportan y no suman', () => {
    const c = recipeCost(rec({ toolUses: [{ toolId: 'x', pct: 10 }] }), ings, tools())
    expect(c.toolsCents).toBe(0); expect(c.missingTools).toEqual(['x'])
  })
  it('recetas sin herramientas (datos anteriores) siguen igual', () => {
    const r = rec(); delete r.toolUses
    expect(recipeCost(r, ings, tools()).toolsCents).toBe(0)
    expect(recipeCost(r, ings, tools()).totalCents).toBe(3600)
  })
  it('cambiar el precio de la herramienta recalcula la receta', () => {
    expect(recipeCost(rec(), ings, tools(tool({ priceCents: 60000 }))).toolsCents).toBe(300)
  })
  it('el desglose congelado suma 1 e incluye herramientas', () => {
    const l = lineFromRecipe(rec(), ings, 1, tools())
    const s = l.costShares!
    expect(s.tools).toBeCloseTo(150 / 3750)
    expect(s.ingredients + s.labor + s.energy + s.packaging + s.other + (s.tools ?? 0)).toBeCloseTo(1)
  })
  it('al confirmar se congela el costo con herramientas; cambios posteriores no lo alteran', () => {
    const r = rec()
    let o: Order = { id: 'o', folio: 'P1', customerName: 'A', createdAt: '2026-05-10T10:00:00', deliveryAt: '', status: 'cotizacion', lines: [lineFromRecipe(r, ings, 1, tools())], discountCents: 0, deliveryFeeCents: 0, payments: [], adjustments: [], message: '', notes: '' }
    o = transition(o, 'confirmado', new Map([[r.id, r]]), ings, new Date('2026-05-10T10:00:00'), tools())
    expect(o.lines[0].unitCostCents).toBe(3750)
    expect(recipeCost(r, ings, tools(tool({ priceCents: 99999 }))).unitCostCents).toBeGreaterThan(3750)
    expect(orderTotals(o).costCents).toBe(3750)
  })
})

describe('uso de herramientas general (%) en la receta', () => {
  const base = (o: Partial<Recipe> = {}) => rec({ toolUses: undefined, otherCents: 400, ...o }) // ingredientes $36 + otros $4 = $40
  it('3 % sobre el costo de la receta: $40 → $1.20', () => {
    const c = recipeCost(base({ toolWearPct: 3 }), ings)
    expect(c.toolsCents).toBe(120); expect(c.totalCents).toBe(4000 + 120)
  })
  it('incluye mano de obra, energía y empaque en la base', () => {
    const r = base({ toolWearPct: 10, laborMode: 'hora', laborRateCents: 6000, activeMin: 60, energyValue: 500, packagingCentsPerUnit: 100 })
    const c = recipeCost(r, ings) // 3600 + 6000 + 500 + 400 + 100 = 10600
    expect(c.toolsCents).toBe(1060)
  })
  it('sin porcentaje o con recetas antiguas no suma nada; se limita a 0–100', () => {
    expect(recipeCost(base(), ings).toolsCents).toBe(0)
    expect(recipeCost(base({ toolWearPct: -5 }), ings).toolsCents).toBe(0)
    expect(recipeCost(base({ toolWearPct: 500 }), ings).toolsCents).toBe(4000)
  })
  it('se suma al desgaste por herramienta de recetas anteriores sin duplicar el subtotal', () => {
    const c = recipeCost(base({ toolWearPct: 3, toolUses: [{ toolId: 't1', pct: 0.5 }] }), ings, tools())
    expect(c.toolsCents).toBe(150 + 120)
  })
  it('el desglose congelado suma 1 y al confirmar el costo queda fijo aunque cambie el porcentaje', () => {
    const r = base({ toolWearPct: 3 })
    const l = lineFromRecipe(r, ings, 1)
    const s = l.costShares!
    expect(s.ingredients + s.labor + s.energy + s.packaging + s.other + (s.tools ?? 0)).toBeCloseTo(1)
    expect(s.tools).toBeCloseTo(120 / 4120)
    let o: Order = { id: 'o', folio: 'P1', customerName: 'A', createdAt: '2026-05-10T10:00:00', deliveryAt: '', status: 'cotizacion', lines: [l], discountCents: 0, deliveryFeeCents: 0, payments: [], adjustments: [], message: '', notes: '' }
    o = transition(o, 'confirmado', new Map([[r.id, r]]), ings, new Date('2026-05-10T10:00:00'))
    expect(recipeCost({ ...r, toolWearPct: 20 }, ings).unitCostCents).toBe(4800)
    expect(o.lines[0].unitCostCents).toBe(4120)
  })
})

describe('finanzas con herramientas y gastos ya cobrados en recetas', () => {
  const mk = (extra: Partial<Expense>[] = []): Ctx => {
    const r = rec()
    const line = { ...lineFromRecipe(r, ings, 2, tools()), unitPriceCents: 10000 }
    const o: Order = { id: 'o', folio: 'P1', customerName: 'A', createdAt: '2026-05-10T10:00:00', confirmedAt: '2026-05-10T10:00:00', deliveryAt: '', status: 'confirmado', lines: [line], discountCents: 0, deliveryFeeCents: 0, payments: [{ id: 'p', date: '2026-05-10', amountCents: 20000, method: 'efectivo' }], adjustments: [], message: '', notes: '' }
    return { orders: [o], recipes: [r], purchases: [], expenses: extra.map((e, i) => ({ id: 'e' + i, date: '2026-05-12', concept: 'Gas', category: '', amountCents: 1000, fixed: false, ...e })) }
  }
  const range = resolveRange('mes', new Date('2026-05-20T15:00:00')).range
  it('la distribución de costos muestra «Herramientas (desgaste)» y suma el costo total', () => {
    const c = mk(), d = costDistribution(c, range, NO_FILTERS)
    expect(d.find((x) => x.key === 'tools')!.cents).toBe(300) // 2 × $1.50
    expect(d.reduce((s, x) => s + x.cents, 0)).toBe(computeMetrics(c, range, NO_FILTERS).cost)
  })
  it('un gasto normal resta de la neta; uno «ya cobrado en recetas» solo de la caja', () => {
    const m = computeMetrics(mk([{ amountCents: 1000 }, { amountCents: 500, coveredInRecipes: true }]), range, NO_FILTERS)
    expect(m.expenses).toBe(1000); expect(m.expensesCovered).toBe(500)
    expect(m.net).toBe(m.gross - 1000)
    expect(m.cashNet).toBe(20000 - 1000 - 500)
  })
  it('el Resumen usa el mismo criterio y no avisa «sin gastos» si todos son cubiertos', () => {
    const c = mk([{ amountCents: 500, coveredInRecipes: true }])
    expect(summarize(c.orders, c.expenses, 'mes', new Date('2026-05-20T15:00:00')).expensesCents).toBe(0)
    expect(dataWarnings(c, range, NO_FILTERS, computeMetrics(c, range, NO_FILTERS)).join()).not.toMatch(/No hay gastos/)
  })
})

describe('respaldo, migración y CSV', () => {
  const empty = { ingredients: [], purchases: [], recipes: [], customers: [], orders: [], expenses: [], tools: [], settings: null }
  it('el esquema es v2 y una copia v1 (sin herramientas) se migra', () => {
    expect(SCHEMA_VERSION).toBe(2)
    const v1 = { ...buildBackup(empty), schemaVersion: 1 } as Record<string, unknown>
    delete v1.tools
    const rep = parseBackup(JSON.stringify(v1))
    expect(rep.ok).toBe(true); expect(rep.data!.schemaVersion).toBe(2); expect(rep.data!.tools).toEqual([]); expect(rep.warnings.join()).not.toMatch(/tools/)
  })
  it('rechaza recetas que usan herramientas inexistentes', () => {
    const b = buildBackup({ ...empty, ingredients: [ing()], recipes: [rec()] })
    expect(parseBackup(JSON.stringify(b)).errors.join()).toMatch(/herramienta inexistente/)
    const ok = buildBackup({ ...empty, ingredients: [ing()], recipes: [rec()], tools: [tool()] })
    expect(parseBackup(JSON.stringify(ok)).ok).toBe(true)
  })
  it('combinar incluye herramientas y el respaldo excluye las de demostración', () => {
    const m = mergeSnapshots({ ...empty, tools: [tool()] }, { ...empty, tools: [tool(), tool({ id: 't9' })] })
    expect(m.result.tools).toHaveLength(2); expect(m.skipped).toBe(1)
    expect(buildBackup({ ...empty, tools: [tool({ demo: true }), tool({ id: 'x' })] }).tools).toHaveLength(1)
  })
  it('CSV de herramientas y del vínculo receta–herramienta con ids', () => {
    const f = exportCsvs({ ...empty, tools: [tool()], recipes: [rec()] })
    expect(f['herramientas.csv']).toContain('t1,Tapete,300.00')
    expect(f['recetas_herramientas.csv'].replace(/^﻿/, '').trim().split('\r\n')[1]).toBe('r1,t1,0.5')
  })
})

describe('persistencia de herramientas', () => {
  let d: AppDB
  beforeEach(async () => { d = new AppDB('tt' + Math.random()); await d.open() })
  it('respaldo → borrar → restaurar recupera herramientas y su uso en recetas', async () => {
    await d.ingredients.add(ing()); await d.tools.add(tool()); await d.recipes.add(rec())
    const file = await createBackup(d)
    const rep = parseBackup(JSON.stringify(file))
    expect(rep.ok).toBe(true)
    await d.tools.clear(); await d.recipes.clear(); await d.ingredients.clear()
    await restoreBackup(rep.data!, 'reemplazar', d)
    expect(await d.tools.count()).toBe(1)
    expect((await d.recipes.toArray())[0].toolUses).toEqual([{ toolId: 't1', pct: 0.5 }])
  })
  it('borrar demo elimina también las herramientas demo y conserva las reales', async () => {
    await d.tools.bulkAdd([tool(), tool({ id: 'd', demo: true })])
    await deleteDemoData(d)
    expect((await snapshot(d)).tools.map((t) => t.id)).toEqual(['t1'])
  })
  it('migración real: una base v1 con datos se abre en v2 sin perder nada y con la tabla de herramientas', async () => {
    const name = 'migra' + Math.random()
    const old = new Dexie(name)
    old.version(1).stores({ ingredients: 'id, name, category', purchases: 'id, ingredientId, date', recipes: 'id, name, category, favorite', customers: 'id, name', orders: 'id, folio, status, deliveryAt, customerId', expenses: 'id, date', settings: 'id' })
    await old.open()
    await old.table('ingredients').add(ing()); await old.table('recipes').add({ ...rec(), toolUses: undefined })
    await old.table('settings').add({ id: 'main', businessName: 'Dulce Rosa', nextFolio: 7 })
    old.close()
    const upgraded = new AppDB(name)
    await upgraded.open()
    expect(upgraded.verno).toBe(2)
    expect(await upgraded.ingredients.count()).toBe(1)
    expect((await upgraded.recipes.toArray())[0].name).toBe('Pastel')
    expect((await upgraded.settings.get('main'))!.nextFolio).toBe(7)
    expect(await upgraded.tools.count()).toBe(0)
    await upgraded.tools.add(tool()); expect(await upgraded.tools.count()).toBe(1)
  })
})
