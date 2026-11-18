import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDB, addPurchase, createBackup, createIngredient, deleteRecipe, RecipeReferenceError, restoreBackup, saveOrder, saveRecipe, snapshot, getSettings, deleteDemoData } from '../db/db'
import { parseBackup } from '../domain/backup'
import { summarize } from '../domain/dashboard'
import type { Order, Recipe } from '../domain/types'

let d: AppDB
beforeEach(async () => { d = new AppDB('t' + Math.random()); await d.open() })

const newIng = (demo = false) => createIngredient(
  { name: 'Chocolate', category: 'Chocolates', demo },
  { date: '2026-01-01', qty: 1, unit: 'kg', priceCents: 18000, discountCents: 0, extraCents: 0, demo }, d)
const ord = (id: string): Order => ({ id, folio: '', customerName: 'Ana', createdAt: '', deliveryAt: '', status: 'cotizacion', lines: [], discountCents: 0, deliveryFeeCents: 0, payments: [], adjustments: [], message: '', notes: '' })
const rec = (id: string, recipeComponents: Recipe['recipeComponents'] = []): Recipe => ({
  id, name: id, category: 'Otros', kind: 'producto', description: '', favorite: false, components: [], recipeComponents,
  yieldQty: 1, portionsPerUnit: 1, activeMin: 0, bakeMin: 0, restMin: 0, ingredientWastePct: 0, finishedWastePct: 0,
  laborMode: 'hora', laborRateCents: 0, laborOps: 1, energyMode: 'fijo', energyValue: 0, otherCents: 0,
  packagingCentsPerUnit: 0, commissionPct: 0, targetMarginPct: 60, steps: '', notes: '', updatedAt: '',
})

describe('persistencia', () => {
  it('nueva compra actualiza el costo vigente y conserva el historial', async () => {
    const i = await newIng()
    expect(i.costPerBase).toBeCloseTo(18)
    await addPurchase({ ingredientId: i.id, date: '2026-03-01', qty: 500, unit: 'g', priceCents: 12000, discountCents: 0, extraCents: 0 }, d)
    expect((await d.ingredients.get(i.id))!.costPerBase).toBeCloseTo(24)
    expect(await d.purchases.count()).toBe(2)
  })
  it('folios únicos y consecutivos', async () => {
    const a = await saveOrder(ord('a'), d), b = await saveOrder(ord('b'), d)
    expect([a.folio, b.folio]).toEqual(['PED-0001', 'PED-0002'])
    await saveOrder({ ...a, notes: 'x' }, d)
    expect((await getSettings(d)).nextFolio).toBe(3)
  })
  it('guarda referencias a recetas, impide ciclos y protege componentes usados', async () => {
    const base = rec('base'), relleno = rec('relleno'), composta = rec('compuesta', [{ recipeId: 'base', qty: 2 }, { recipeId: 'relleno', qty: 1 }])
    await saveRecipe(base, d); await saveRecipe(relleno, d); await saveRecipe(composta, d)
    await expect(deleteRecipe('base', d)).rejects.toBeInstanceOf(RecipeReferenceError)
    await expect(saveRecipe({ ...base, recipeComponents: [{ recipeId: 'compuesta', qty: 1 }] }, d)).rejects.toThrow(/circular/)
    expect(await d.recipes.count()).toBe(3)
  })
  it('conserva la foto de una receta al guardar y respaldar', async () => {
    const recipe = { ...rec('foto'), imageDataUrl: 'data:image/jpeg;base64,dGVzdA==' }
    await saveRecipe(recipe, d)
    expect((await d.recipes.get(recipe.id))?.imageDataUrl).toBe(recipe.imageDataUrl)
    expect((await createBackup(d)).recipes[0].imageDataUrl).toBe(recipe.imageDataUrl)
  })
  it('no usa recetas de demostración como componentes guardados', async () => {
    await d.recipes.add({ ...rec('demo'), demo: true })
    await expect(saveRecipe(rec('real', [{ recipeId: 'demo', qty: 1 }]), d)).rejects.toThrow(/demostración/)
  })
  it('eliminar un pedido lo quita de los agregados sin borrar la receta', async () => {
    const recipe = rec('producto')
    const sale = {
      ...ord('venta'), folio: 'PED-0001', createdAt: '2026-05-10T10:00:00', confirmedAt: '2026-05-10T10:00:00', status: 'confirmado' as const,
      lines: [{ id: 'l', recipeId: recipe.id, name: recipe.name, qty: 1, unitPriceCents: 10000, unitCostCents: 4000, commissionPct: 0, customization: '' }],
      payments: [{ id: 'p', date: '2026-05-10', amountCents: 5000, method: 'efectivo' as const }],
    }
    await d.recipes.add(recipe); await d.orders.add(sale)
    expect(summarize([sale], [], 'mes', new Date('2026-05-20T12:00:00')).salesCents).toBe(10000)
    await d.orders.delete(sale.id)
    const remaining = await d.orders.toArray()
    expect(summarize(remaining, [], 'mes', new Date('2026-05-20T12:00:00'))).toMatchObject({ salesCents: 0, collectedCents: 0, orderCount: 0 })
    expect(await d.recipes.get(recipe.id)).toBeDefined()
  })
  it('respaldo → reemplazar restaura todo', async () => {
    await newIng(); await saveOrder(ord('a'), d)
    const file = await createBackup(d)
    const rep = parseBackup(JSON.stringify(file))
    expect(rep.ok).toBe(true)
    await d.ingredients.clear(); await d.orders.clear()
    await restoreBackup(rep.data!, 'reemplazar', d)
    expect(await d.ingredients.count()).toBe(1)
    expect(await d.orders.count()).toBe(1)
    expect((await getSettings(d)).lastBackupAt).toBeTruthy()
  })
  it('combinar no duplica ni pisa datos locales', async () => {
    const i = await newIng()
    const file = await createBackup(d)
    await d.ingredients.update(i.id, { name: 'Local editado' })
    const r = await restoreBackup(parseBackup(JSON.stringify(file)).data!, 'combinar', d)
    expect(r.skipped).toBeGreaterThan(0)
    expect((await d.ingredients.get(i.id))!.name).toBe('Local editado')
    expect(await d.ingredients.count()).toBe(1)
  })
  it('restauración fallida revierte (transacción)', async () => {
    const i = await newIng()
    const file = await createBackup(d)
    const broken = { ...file, ingredients: [{ id: 'z', fn: () => 1 }] } as never
    await expect(restoreBackup(broken, 'reemplazar', d)).rejects.toBeTruthy()
    expect((await snapshot(d)).ingredients.map((x) => x.id)).toEqual([i.id])
  })
  it('borrar demo no toca datos reales', async () => {
    await newIng(false); await newIng(true)
    await deleteDemoData(d)
    expect(await d.ingredients.count()).toBe(1)
    expect(await d.purchases.count()).toBe(1)
  })
})
