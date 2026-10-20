import { describe, expect, it } from 'vitest'
import type { Ingredient, Order, Recipe } from '../domain/types'
import { convert, UnitError } from '../domain/units'
import { costPerBaseFromPurchase, recipeCost } from '../domain/costing'
import { analyzePrice, priceForMargin } from '../domain/pricing'
import { orderTotals, paymentStatus, transition, lineFromRecipe, OrderError } from '../domain/orders'
import { parseNum, round } from '../domain/money'
import { buildBackup, parseBackup } from '../domain/backup'
import { exportCsvs, toCsv } from '../domain/csv'

const ing = (id: string, costPerBase: number, dimension: Ingredient['dimension'] = 'masa', density?: number): Ingredient =>
  ({ id, name: id, category: '', costPerBase, dimension, density, priceUpdatedAt: '2026-01-01', createdAt: '2026-01-01' })
const recipe = (o: Partial<Recipe> = {}): Recipe => ({
  id: 'r1', name: 'Pastel', category: '', kind: 'pastel', description: '', favorite: false,
  components: [{ ingredientId: 'choc', qty: 200, unit: 'g' }], yieldQty: 1, portionsPerUnit: 8,
  activeMin: 60, bakeMin: 40, restMin: 120, ingredientWastePct: 0, finishedWastePct: 0,
  laborMode: 'hora', laborRateCents: 6000, laborOps: 0, energyMode: 'fijo', energyValue: 0, otherCents: 0,
  packagingCentsPerUnit: 0, commissionPct: 0, targetMarginPct: 60, steps: '', notes: '', updatedAt: '', ...o,
})
const ings = (...a: Ingredient[]) => new Map(a.map((i) => [i.id, i]))
const order = (o: Partial<Order> = {}): Order => ({
  id: 'o1', folio: 'PED-0001', customerName: 'Ana', createdAt: '', deliveryAt: '', status: 'cotizacion', lines: [],
  discountCents: 0, deliveryFeeCents: 0, payments: [], adjustments: [], message: '', notes: '', ...o,
})

describe('ingredientes y unidades', () => {
  it('1 kg de chocolate a $180 → $18 por 100 g', () => {
    const c = costPerBaseFromPurchase({ qty: 1, unit: 'kg', priceCents: 18000, discountCents: 0, extraCents: 0 })
    expect(c * 100).toBeCloseTo(1800)
  })
  it('descuentos y extras entran al costo', () => {
    expect(costPerBaseFromPurchase({ qty: 1000, unit: 'g', priceCents: 20000, discountCents: 2000, extraCents: 500 })).toBeCloseTo(18.5)
  })
  it('rechaza cantidad 0', () => {
    expect(() => costPerBaseFromPurchase({ qty: 0, unit: 'g', priceCents: 1, discountCents: 0, extraCents: 0 })).toThrow()
  })
  it('convierte masa y volumen dentro de su dimensión', () => {
    expect(convert(1.5, 'kg', 'g')).toBe(1500)
    expect(convert(2, 'taza', 'ml')).toBe(480)
    expect(convert(2, 'docena', 'pza')).toBe(24)
  })
  it('no convierte g↔ml sin densidad, ni pieza con masa', () => {
    expect(() => convert(100, 'g', 'ml')).toThrow(UnitError)
    expect(() => convert(1, 'pza', 'g', 1)).toThrow(UnitError)
    expect(convert(100, 'g', 'ml', 0.5)).toBe(200)
  })
})

describe('costeo de receta', () => {
  const i = ings(ing('choc', 18))
  it('costo de ingredientes', () => {
    expect(recipeCost(recipe({ laborRateCents: 0 }), i).ingredientsCents).toBe(3600)
  })
  it('merma de ingredientes aumenta el costo', () => {
    expect(recipeCost(recipe({ laborRateCents: 0, ingredientWastePct: 10 }), i).totalCents).toBe(3960)
  })
  it('merma del terminado reduce unidades vendibles', () => {
    const c = recipeCost(recipe({ laborRateCents: 0, yieldQty: 10, finishedWastePct: 20 }), i)
    expect(c.usableUnits).toBe(8)
    expect(c.unitCostCents).toBe(450)
  })
  it('mano de obra por hora, minuto y operación', () => {
    expect(recipeCost(recipe({ laborMode: 'hora' }), i).laborCents).toBe(6000)
    expect(recipeCost(recipe({ laborMode: 'minuto', laborRateCents: 100 }), i).laborCents).toBe(6000)
    expect(recipeCost(recipe({ laborMode: 'operacion', laborRateCents: 2500, laborOps: 3 }), i).laborCents).toBe(7500)
  })
  it('energía: un solo modo, sin duplicar', () => {
    const base = recipe({ laborRateCents: 0 })
    expect(recipeCost({ ...base, energyMode: 'fijo', energyValue: 500 }, i).energyCents).toBe(500)
    expect(recipeCost({ ...base, energyMode: 'porcentaje', energyValue: 10 }, i).energyCents).toBe(360)
    expect(recipeCost({ ...base, energyMode: 'tarifa', energyValue: 3000 }, i).energyCents).toBe(2000)
  })
  it('costo por porción y empaque', () => {
    const c = recipeCost(recipe({ laborRateCents: 0, packagingCentsPerUnit: 400 }), i)
    expect(c.totalCents).toBe(4000)
    expect(c.portionCostCents).toBe(500)
  })
  it('cambio de precio del ingrediente recalcula la receta', () => {
    expect(recipeCost(recipe({ laborRateCents: 0 }), ings(ing('choc', 36))).totalCents).toBe(7200)
  })
  it('reporta ingredientes faltantes', () => {
    expect(recipeCost(recipe(), new Map()).missing).toEqual(['choc'])
  })
})

describe('precios y márgenes', () => {
  it('margen y recargo distintos', () => {
    const a = analyzePrice(10000, 4000)
    expect(a.profitCents).toBe(6000)
    expect(a.marginPct).toBeCloseTo(60)
    expect(a.markupPct).toBeCloseTo(150)
  })
  it('precio para margen objetivo 60 %', () => {
    expect(priceForMargin(4000, 60)).toBe(10000)
  })
  it('comisión integrada: margen real = objetivo', () => {
    const p = priceForMargin(4000, 50, 10)!
    expect(analyzePrice(p, 4000, 10).marginPct).toBeCloseTo(50, 0)
  })
  it('valida inválidos y divisiones por cero', () => {
    expect(priceForMargin(4000, 100)).toBeNull()
    expect(priceForMargin(4000, 90, 10)).toBeNull()
    expect(priceForMargin(4000, -5)).toBeNull()
    expect(priceForMargin(NaN, 50)).toBeNull()
    expect(analyzePrice(0, 100).marginPct).toBeNull()
    expect(analyzePrice(100, 0).markupPct).toBeNull()
  })
})

describe('pedidos', () => {
  const line = (q = 2) => ({ id: 'l', recipeId: 'r1', name: 'Pastel', qty: q, unitPriceCents: 10000, unitCostCents: 4000, commissionPct: 0, customization: '' })
  it('total, descuento, anticipo y saldo', () => {
    const o = order({ lines: [line()], discountCents: 1000, deliveryFeeCents: 500, payments: [{ id: 'p', date: '', amountCents: 5000, method: 'efectivo' }] })
    const t = orderTotals(o)
    expect(t.totalCents).toBe(19500)
    expect(t.balanceCents).toBe(14500)
    expect(t.profitCents).toBe(19500 - 8000)
    expect(paymentStatus(o)).toBe('anticipo')
  })
  it('estados de pago independientes del estado del pedido', () => {
    const base = order({ lines: [line(1)], status: 'confirmado' })
    expect(paymentStatus(base)).toBe('sin_pago')
    expect(paymentStatus({ ...base, payments: [{ id: 'p', date: '', amountCents: 10000, method: 'tarjeta' }] })).toBe('pagado')
    expect(paymentStatus({ ...base, payments: [{ id: 'a', date: '', amountCents: 10000, method: 'tarjeta' }, { id: 'b', date: '', amountCents: -10000, method: 'tarjeta' }] })).toBe('reembolsado')
  })
  it('ajustes de costo reducen la ganancia sin tocar líneas', () => {
    const o = order({ lines: [line(1)], adjustments: [{ id: 'a', date: '', amountCents: 700, note: 'extra' }] })
    expect(orderTotals(o).profitCents).toBe(10000 - 4000 - 700)
  })
  it('confirmar congela costos; cambios posteriores no lo alteran', () => {
    const r = recipe({ laborRateCents: 0, priceCents: 10000 })
    const m = new Map([[r.id, r]])
    let o = order({ lines: [lineFromRecipe(r, ings(ing('choc', 18)), 1)] })
    o = transition(o, 'confirmado', m, ings(ing('choc', 18)))
    expect(o.lines[0].unitCostCents).toBe(3600)
    expect(recipeCost(r, ings(ing('choc', 36))).unitCostCents).toBe(7200)
    expect(orderTotals(o).costCents).toBe(3600)
  })
  it('no confirma pedido vacío ni reabre uno cancelado', () => {
    expect(() => transition(order(), 'confirmado', new Map(), new Map())).toThrow(OrderError)
    expect(() => transition(order({ status: 'cancelado' }), 'confirmado', new Map(), new Map())).toThrow(OrderError)
  })
})

describe('números y respaldo', () => {
  it('parseNum', () => {
    expect(parseNum('$1,250.50')).toBe(1250.5)
    expect(parseNum('12,5')).toBe(12.5)
    expect(parseNum('1,250')).toBe(1250)
    expect(parseNum('abc')).toBeNaN()
    expect(round(2.5)).toBe(3)
  })
  const empty = { ingredients: [], purchases: [], recipes: [], customers: [], orders: [], expenses: [], settings: null }
  it('acepta respaldo válido y rechaza inválidos', () => {
    const b = buildBackup({ ...empty, ingredients: [ing('choc', 18)] })
    const ok = parseBackup(JSON.stringify(b))
    expect(ok.ok).toBe(true)
    expect(ok.counts.ingredients).toBe(1)
    expect(parseBackup('{no').ok).toBe(false)
    expect(parseBackup('{"format":"otro"}').ok).toBe(false)
    expect(parseBackup(JSON.stringify({ ...b, schemaVersion: 99 })).errors[0]).toMatch(/más nueva/)
  })
  it('detecta referencias inválidas e ids duplicados', () => {
    const b = buildBackup({ ...empty, recipes: [recipe()] })
    expect(parseBackup(JSON.stringify(b)).errors.join()).toMatch(/ingrediente inexistente/)
    const d = buildBackup({ ...empty, ingredients: [ing('a', 1), ing('a', 2)] })
    expect(parseBackup(JSON.stringify(d)).errors.join()).toMatch(/duplicado/)
  })
  it('el respaldo y CSV excluyen datos demo', () => {
    const demo = { ...ing('d', 1), demo: true }
    expect(buildBackup({ ...empty, ingredients: [demo, ing('x', 1)] }).ingredients).toHaveLength(1)
    expect(exportCsvs({ ...empty, ingredients: [demo] })['ingredientes.csv'].trim().split('\r\n')).toHaveLength(1)
  })
  it('CSV: BOM, comillas, acentos y protección de fórmulas', () => {
    const c = toCsv(['a', 'b'], [['Crème, "brûlée"', '=SUM(A1)']])
    expect(c.charCodeAt(0)).toBe(0xfeff)
    expect(c).toContain('"Crème, ""brûlée"""')
    expect(c).toContain("'=SUM(A1)")
  })
  it('CSV de pedidos conserva ids que vinculan líneas', () => {
    const o = order({ lines: [{ id: 'l', recipeId: 'r1', name: 'Pastel', qty: 1, unitPriceCents: 100, unitCostCents: 50, commissionPct: 0, customization: '' }] })
    const f = exportCsvs({ ...empty, orders: [o] })
    expect(f['pedidos.csv']).toContain('o1')
    expect(f['pedidos_lineas.csv']).toContain('o1,PED-0001,r1')
  })
})

import { summarize, topRecipes, periodRange } from '../domain/dashboard'
describe('resumen', () => {
  const sold = (id: string, at: string, paid: number) => order({
    id, status: 'confirmado', confirmedAt: at, createdAt: at,
    lines: [{ id: 'l', recipeId: 'r1', name: 'Pastel', qty: 2, unitPriceCents: 10000, unitCostCents: 4000, commissionPct: 0, customization: '' }],
    payments: paid ? [{ id: 'p', date: at.slice(0, 10), amountCents: paid, method: 'efectivo' as const }] : [],
  })
  const now = new Date('2026-05-20T12:00:00')
  it('distingue ventas, cobrado, costo, gastos y ganancia', () => {
    const os = [sold('a', '2026-05-20T10:00:00', 5000), sold('b', '2026-05-02T10:00:00', 0), order({ id: 'q', status: 'cotizacion', confirmedAt: undefined })]
    const ex = [{ id: 'e', date: '2026-05-10', concept: 'Gas', category: '', amountCents: 3000, fixed: true }]
    const hoy = summarize(os, ex, 'dia', now)
    expect(hoy).toMatchObject({ salesCents: 20000, collectedCents: 5000, costCents: 8000, grossProfitCents: 12000, orderCount: 1 })
    const mes = summarize(os, ex, 'mes', now)
    expect(mes.salesCents).toBe(40000)
    expect(mes.expensesCents).toBe(3000)
    expect(mes.netProfitCents).toBe(24000 - 3000)
    expect(summarize([], [], 'mes', now).hasData).toBe(false)
  })
  it('rango semanal empieza en lunes', () => {
    expect(periodRange('semana', now)[0].getDay()).toBe(1)
  })
  it('ranking usa costos congelados', () => {
    const t = topRecipes([sold('a', '2026-05-20T10:00:00', 0)])
    expect(t[0]).toMatchObject({ units: 2, revenueCents: 20000, profitCents: 12000 })
  })
})
