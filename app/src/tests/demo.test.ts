import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDB, deleteDemoData, snapshot, useDb } from '../db/db'
import { loadDemo } from '../db/demo'
import { recipeCost } from '../domain/costing'
import { orderTotals } from '../domain/orders'
import { analyzePrice } from '../domain/pricing'

let d: AppDB
beforeEach(async () => { d = new AppDB('demo' + Math.random()); await d.open(); useDb(d) })

describe('datos de demostración: macarrones con recetas separadas', () => {
  it('crea tapas, un relleno por sabor y la caja, con ingredientes y herramientas demo', async () => {
    await loadDemo()
    const s = await snapshot(d)
    const names = s.recipes.map((r) => r.name)
    for (const n of ['Tapas de macarrón (demo)', 'Relleno de ganache de chocolate (demo)', 'Relleno de fresa (demo)', 'Relleno de pistache (demo)', 'Caja para 6 macarrones (demo)']) expect(names).toContain(n)
    for (const n of ['Harina de almendra (demo)', 'Pasta de pistache (demo)', 'Caja para 6 macarrones (demo)']) expect(s.ingredients.map((i) => i.name)).toContain(n)
    expect(s.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['Tapete para macarrón (demo)', 'Manga pastelera y duya (demo)', 'Tamiz fino (demo)', 'Báscula digital (demo)']))
    expect([...s.recipes, ...s.ingredients, ...s.tools, ...s.orders, ...s.customers].every((x) => x.demo)).toBe(true)
  })
  it('costos y precios coherentes: rinde 60 tapas, 10 % de merma, 60 % de margen por pieza', async () => {
    await loadDemo()
    const s = await snapshot(d), ings = new Map(s.ingredients.map((i) => [i.id, i])), tools = new Map(s.tools.map((t) => [t.id, t]))
    const get = (n: string) => s.recipes.find((r) => r.name.startsWith(n))!
    const tapas = get('Tapas de macarrón'), c = recipeCost(tapas, ings, tools)
    expect(c.usableUnits).toBe(54)
    expect(c.toolsCents).toBeGreaterThan(0)
    expect(c.unitCostCents).toBeGreaterThan(100); expect(c.unitCostCents).toBeLessThan(500) // ~ $1–5 por tapa
    for (const n of ['Tapas de macarrón', 'Relleno de fresa', 'Relleno de ganache', 'Relleno de pistache']) {
      const r = get(n), cost = recipeCost(r, ings, tools).unitCostCents
      expect(analyzePrice(r.priceCents!, cost).marginPct!).toBeGreaterThan(59)
    }
    expect(analyzePrice(get('Caja').priceCents!, recipeCost(get('Caja'), ings, tools).unitCostCents).marginPct!).toBeGreaterThan(49)
  })
  it('el pedido de ejemplo arma 18 macarrones: 36 tapas + 12 + 6 rellenos + 3 cajas, confirmado con anticipo', async () => {
    await loadDemo()
    const o = (await snapshot(d)).orders.find((x) => x.customerName.startsWith('Sofía'))!
    expect(o.status).toBe('confirmado')
    expect(o.lines.map((l) => [l.name.replace(' (demo)', ''), l.qty])).toEqual([['Tapas de macarrón', 36], ['Relleno de fresa', 12], ['Relleno de ganache de chocolate', 6], ['Caja para 6 macarrones', 3]])
    const t = orderTotals(o)
    expect(t.paidCents).toBe(15000); expect(t.balanceCents).toBe(t.totalCents - 15000)
    expect(t.profitCents).toBeGreaterThan(0); expect(t.marginPct!).toBeGreaterThan(40)
    expect(o.lines[0].costShares?.tools).toBeGreaterThan(0)
  })
  it('borrar demo elimina todo lo de macarrones y no deja huérfanos', async () => {
    await loadDemo(); await deleteDemoData()
    const s = await snapshot(d)
    expect([s.recipes, s.ingredients, s.tools, s.orders, s.customers].map((a) => a.length)).toEqual([0, 0, 0, 0, 0])
  })
})
