import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDB, addPurchase, createBackup, createIngredient, restoreBackup, saveOrder, snapshot, getSettings, deleteDemoData } from '../db/db'
import { parseBackup } from '../domain/backup'
import type { Order } from '../domain/types'

let d: AppDB
beforeEach(async () => { d = new AppDB('t' + Math.random()); await d.open() })

const newIng = (demo = false) => createIngredient(
  { name: 'Chocolate', category: 'Chocolates', demo },
  { date: '2026-01-01', qty: 1, unit: 'kg', priceCents: 18000, discountCents: 0, extraCents: 0, demo }, d)
const ord = (id: string): Order => ({ id, folio: '', customerName: 'Ana', createdAt: '', deliveryAt: '', status: 'cotizacion', lines: [], discountCents: 0, deliveryFeeCents: 0, payments: [], adjustments: [], message: '', notes: '' })

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
