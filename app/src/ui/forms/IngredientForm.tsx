import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { addPurchase, createIngredient, db, ingredientInUse } from '../../db/db'
import { costPerBaseFromPurchase } from '../../domain/costing'
import { formatMXN, pesosToCents } from '../../domain/money'
import type { Ingredient, Unit } from '../../domain/types'
import { dimensionOf, UNITS } from '../../domain/units'
import { fmtDate, todayISO } from '../data'
import { Badge, Field, NumInput, Sheet, useUi } from '../ui'

export const ING_CATEGORIES = ['Harinas y secos', 'Lácteos y huevo', 'Chocolates', 'Azúcares', 'Frutas', 'Grasas', 'Saborizantes', 'Decoración', 'Empaque', 'Otros']
const ALL_UNITS = Object.keys(UNITS) as Unit[]
const baseLabel = { masa: '100 g', volumen: '100 ml', pieza: '1 pza' } as const
const baseMul = { masa: 100, volumen: 100, pieza: 1 } as const

/** Costo de la compra por unidad de referencia (100 g, 100 ml o 1 pza), en centavos; null si los datos no son válidos. */
export function previewCost(qty?: number, unit: Unit = 'g', price?: number, disc = 0, extra = 0): { cents: number; label: string } | null {
  if (!qty || qty <= 0 || price === undefined || price < 0) return null
  try {
    const per = costPerBaseFromPurchase({ qty, unit, priceCents: pesosToCents(price), discountCents: pesosToCents(disc), extraCents: pesosToCents(extra) })
    const d = dimensionOf(unit)
    return { cents: per * baseMul[d], label: baseLabel[d] }
  } catch { return null }
}

export function CostPreview({ p }: { p: ReturnType<typeof previewCost> }) {
  if (!p) return <div className="banner">Escribe cantidad y precio para ver el costo unitario.</div>
  return <div className="banner ok">Cuesta <b>{formatMXN(Math.round(p.cents))}</b> por {p.label}. Este valor se usará en todas tus recetas.</div>
}

export function PurchaseForm({ ingredient, onClose }: { ingredient: Ingredient; onClose: () => void }) {
  const ui = useUi()
  const units = ALL_UNITS.filter((u) => dimensionOf(u) === ingredient.dimension)
  const [qty, setQty] = useState<number>()
  const [unit, setUnit] = useState<Unit>(units[0])
  const [price, setPrice] = useState<number>()
  const [disc, setDisc] = useState<number>()
  const [extra, setExtra] = useState<number>()
  const [date, setDate] = useState(todayISO())
  const pv = previewCost(qty, unit, price, disc ?? 0, extra ?? 0)
  const save = async () => {
    if (!pv) return ui.toast('Revisa la cantidad y el precio', true)
    try {
      await addPurchase({ ingredientId: ingredient.id, date, qty: qty!, unit, priceCents: pesosToCents(price!), discountCents: pesosToCents(disc ?? 0), extraCents: pesosToCents(extra ?? 0) })
      ui.toast('Compra registrada y costo actualizado'); onClose()
    } catch (e) { ui.toast((e as Error).message, true) }
  }
  return (
    <Sheet title={`Nueva compra · ${ingredient.name}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={save}>Guardar compra</button></>}>
      <div className="stack">
        <div className="grid2">
          <Field label="Cantidad comprada"><NumInput value={qty} onChange={setQty} placeholder="1" /></Field>
          <Field label="Unidad"><select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>{units.map((u) => <option key={u}>{u}</option>)}</select></Field>
        </div>
        <Field label="Precio pagado (MXN)"><NumInput value={price} onChange={setPrice} placeholder="180" /></Field>
        <div className="grid2">
          <Field label="Descuento (MXN)"><NumInput value={disc} onChange={setDisc} placeholder="0" /></Field>
          <Field label="Costos extra (MXN)" hint="Envío, impuestos"><NumInput value={extra} onChange={setExtra} placeholder="0" /></Field>
        </div>
        <Field label="Fecha de compra"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <CostPreview p={pv} />
        <p className="small muted">El costo vigente se actualiza; las compras anteriores quedan en el historial.</p>
      </div>
    </Sheet>
  )
}

export function IngredientForm({ ingredient: initial, onClose }: { ingredient?: Ingredient; onClose: () => void }) {
  const ui = useUi()
  const live = useLiveQuery(() => (initial ? db.ingredients.get(initial.id) : undefined), [initial?.id])
  const ingredient = live ?? initial
  const edit = !!ingredient
  const [name, setName] = useState(ingredient?.name ?? '')
  const [category, setCategory] = useState(ingredient?.category ?? ING_CATEGORIES[0])
  const [brand, setBrand] = useState(ingredient?.brand ?? '')
  const [supplier, setSupplier] = useState(ingredient?.supplier ?? '')
  const [density, setDensity] = useState<number | undefined>(ingredient?.density)
  const [stock, setStock] = useState<number | undefined>(ingredient?.stock)
  const [minStock, setMinStock] = useState<number | undefined>(ingredient?.minStock)
  const [expiresAt, setExpiresAt] = useState(ingredient?.expiresAt ?? '')
  const [qty, setQty] = useState<number>()
  const [unit, setUnit] = useState<Unit>('g')
  const [price, setPrice] = useState<number>()
  const [disc, setDisc] = useState<number>()
  const [extra, setExtra] = useState<number>()
  const [date, setDate] = useState(todayISO())
  const [tried, setTried] = useState(false)
  const [buy, setBuy] = useState(false)
  const history = useLiveQuery(() => ingredient ? db.purchases.where('ingredientId').equals(ingredient.id).toArray() : [], [ingredient?.id]) ?? []
  const pv = previewCost(qty, unit, price, disc ?? 0, extra ?? 0)

  const save = async () => {
    setTried(true)
    if (!name.trim()) return
    const common = { name: name.trim(), category, brand: brand.trim() || undefined, supplier: supplier.trim() || undefined, density: density && density > 0 ? density : undefined, stock, minStock, expiresAt: expiresAt || undefined }
    try {
      if (edit) {
        await db.ingredients.update(ingredient!.id, common)
      } else {
        if (!pv) return
        await createIngredient(common, { date, qty: qty!, unit, priceCents: pesosToCents(price!), discountCents: pesosToCents(disc ?? 0), extraCents: pesosToCents(extra ?? 0) })
      }
      ui.toast('Ingrediente guardado'); onClose()
    } catch (e) { ui.toast((e as Error).message, true) }
  }
  const remove = async () => {
    const used = await ingredientInUse(ingredient!.id)
    if (used.length) return ui.toast(`No se puede eliminar: lo usan ${used.join(', ')}`, true)
    if (!(await ui.confirm(`Se eliminará «${ingredient!.name}» y su historial de precios.`, 'Eliminar'))) return
    await db.transaction('rw', db.ingredients, db.purchases, async () => {
      await db.purchases.where('ingredientId').equals(ingredient!.id).delete()
      await db.ingredients.delete(ingredient!.id)
    })
    onClose()
  }
  const sorted = [...history].sort((a, b) => (b.date + (b.at ?? '')).localeCompare(a.date + (a.at ?? '')))
  return (
    <>
      <Sheet title={edit ? 'Editar ingrediente' : 'Nuevo ingrediente'} onClose={onClose}
        footer={<>
          {edit && <button className="btn danger" onClick={remove}>Eliminar</button>}
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" onClick={save}>Guardar</button>
        </>}>
        <div className="stack">
          <Field label="Nombre" error={tried && !name.trim() ? 'Escribe un nombre' : undefined}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Chocolate semiamargo" autoFocus aria-invalid={tried && !name.trim()} />
          </Field>
          <div className="grid2">
            <Field label="Categoría"><select value={category} onChange={(e) => setCategory(e.target.value)}>{ING_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Marca (opcional)"><input value={brand} onChange={(e) => setBrand(e.target.value)} /></Field>
          </div>
          <Field label="Proveedor (opcional)"><input value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>
          {!edit && (
            <>
              <h3>¿Cómo lo compraste?</h3>
              <div className="grid2">
                <Field label="Cantidad" error={tried && !pv ? 'Requerido' : undefined}><NumInput value={qty} onChange={setQty} placeholder="1" invalid={tried && !pv} /></Field>
                <Field label="Unidad"><select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>{ALL_UNITS.map((u) => <option key={u}>{u}</option>)}</select></Field>
              </div>
              <Field label="Precio pagado (MXN)"><NumInput value={price} onChange={setPrice} placeholder="180" invalid={tried && !pv} /></Field>
              <div className="grid2">
                <Field label="Descuento (MXN)"><NumInput value={disc} onChange={setDisc} placeholder="0" /></Field>
                <Field label="Costos extra (MXN)"><NumInput value={extra} onChange={setExtra} placeholder="0" /></Field>
              </div>
              <Field label="Fecha de compra"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <CostPreview p={pv} />
            </>
          )}
          <details>
            <summary>Opciones avanzadas</summary>
            <div className="stack" style={{ marginTop: 12 }}>
              <Field label="Densidad (g/ml, opcional)" hint="Solo si quieres usar este ingrediente en gramos y mililitros a la vez. Nunca se asume."><NumInput value={density} onChange={setDensity} placeholder="1.03" /></Field>
              <div className="grid2">
                <Field label="Existencia (unidad base)"><NumInput value={stock} onChange={setStock} /></Field>
                <Field label="Stock mínimo"><NumInput value={minStock} onChange={setMinStock} /></Field>
              </div>
              <Field label="Caducidad"><input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></Field>
            </div>
          </details>
          {edit && (
            <>
              <div className="row between"><h3>Historial de precios</h3><button className="btn small" onClick={() => setBuy(true)}>+ Nueva compra</button></div>
              <div className="banner ok">Costo vigente: {formatMXN(Math.round(ingredient!.costPerBase * (ingredient!.dimension === 'pieza' ? 1 : 100)))} por {baseLabel[ingredient!.dimension]}</div>
              {sorted.length === 0 && <p className="muted small">Aún no hay compras.</p>}
              {sorted.map((p, i) => {
                const per = costPerBaseFromPurchase(p) * baseMul[ingredient!.dimension]
                const prev = sorted[i + 1] ? costPerBaseFromPurchase(sorted[i + 1]) * baseMul[ingredient!.dimension] : null
                return (
                  <div key={p.id} className="row between small">
                    <span>{fmtDate(p.date)} · {p.qty} {p.unit} · {formatMXN(p.priceCents - p.discountCents + p.extraCents)}</span>
                    <span>{formatMXN(Math.round(per))}/{baseLabel[ingredient!.dimension]} {prev != null && per !== prev && <Badge tone={per > prev ? 'bad' : 'ok'}>{per > prev ? '▲' : '▼'} {Math.abs(((per - prev) / prev) * 100).toFixed(1)} %</Badge>}</span>
                  </div>
                )
              })}
            </>
          )}
        </div>
      </Sheet>
      {buy && ingredient && <PurchaseForm ingredient={ingredient} onClose={() => setBuy(false)} />}
    </>
  )
}
