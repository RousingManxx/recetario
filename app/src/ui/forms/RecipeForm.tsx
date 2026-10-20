import { useMemo, useState } from 'react'
import { db, uid } from '../../db/db'
import { recipeCost, totalMinutes } from '../../domain/costing'
import { formatMXN, formatNum, pesosToCents } from '../../domain/money'
import { analyzePrice, priceForMargin, scenarios } from '../../domain/pricing'
import type { EnergyMode, Ingredient, LaborMode, Recipe, RecipeKind, Settings, ToolUse, Unit } from '../../domain/types'
import { UNITS, UnitError, qtyInBase } from '../../domain/units'
import { Field, NumInput, Sheet, useUi } from '../ui'
import type { Data } from '../data'

export const RECIPE_CATEGORIES = ['Pasteles', 'Galletas', 'Pan', 'Cupcakes', 'Postres', 'Cajas y paquetes', 'Otros']
const KINDS: [RecipeKind, string][] = [['producto', 'Producto individual'], ['pastel', 'Pastel completo'], ['porcion', 'Porción'], ['caja', 'Caja'], ['paquete', 'Paquete'], ['personalizado', 'Personalizado']]
const ALL_UNITS = Object.keys(UNITS) as Unit[]

export function newRecipe(s: Settings): Recipe {
  return {
    id: uid(), name: '', category: RECIPE_CATEGORIES[0], kind: 'producto', description: '', favorite: false, components: [],
    yieldQty: 1, portionsPerUnit: 1, activeMin: 0, bakeMin: 0, restMin: 0, ingredientWastePct: 0, finishedWastePct: 0,
    laborMode: s.defaultLaborMode, laborRateCents: s.defaultLaborRateCents, laborOps: 1, energyMode: 'fijo', energyValue: 0,
    otherCents: 0, packagingCentsPerUnit: 0, commissionPct: 0, targetMarginPct: s.defaultMarginPct, steps: '', notes: '', updatedAt: new Date().toISOString(),
  }
}

/** Unidades válidas para el ingrediente: su dimensión, y la cruzada solo si declaró densidad. */
function unitsFor(i: Ingredient): Unit[] {
  return ALL_UNITS.filter((u) => UNITS[u].dim === i.dimension || (i.density && UNITS[u].dim !== 'pieza' && i.dimension !== 'pieza'))
}

export function RecipeForm({ recipe, data, onClose }: { recipe?: Recipe; data: Data; onClose: () => void }) {
  const ui = useUi()
  const [r, setR] = useState<Recipe>(() => recipe ?? newRecipe(data.settings))
  const [tried, setTried] = useState(false)
  const [step, setStep] = useState<'datos' | 'costos' | 'precio'>('datos')
  const set = <K extends keyof Recipe>(k: K, v: Recipe[K]) => setR((p) => ({ ...p, [k]: v }))
  const money = (k: 'laborRateCents' | 'energyValue' | 'otherCents' | 'packagingCentsPerUnit' | 'priceCents') => ({
    value: r[k] === undefined ? undefined : (r[k] as number) / 100,
    onChange: (v: number | undefined) => set(k, v === undefined ? (k === 'priceCents' ? undefined : 0) : pesosToCents(v)),
  })

  const { cost, unitErr } = useMemo(() => {
    try { return { cost: recipeCost(r, data.ingMap, data.toolMap), unitErr: '' } }
    catch (e) { return { cost: recipeCost({ ...r, components: [] }, data.ingMap, data.toolMap), unitErr: e instanceof UnitError ? e.message : 'Error en un ingrediente' } }
  }, [r, data.ingMap, data.toolMap])
  const commission = r.commissionPct
  const recommended = priceForMargin(cost.unitCostCents, r.targetMarginPct, commission)
  const price = r.priceCents ?? recommended ?? 0
  const an = analyzePrice(price, cost.unitCostCents, commission)
  const nameBad = !r.name.trim()
  const compBad = r.components.some((c) => !c.ingredientId || !(c.qty > 0))
  const uses = r.toolUses ?? []
  const toolBad = uses.some((u) => !u.toolId || !(u.pct >= 0 && u.pct <= 100))
  const setUse = (i: number, patch: Partial<ToolUse>) => set('toolUses', uses.map((u, j) => (j === i ? { ...u, ...patch } : u)))

  const save = async () => {
    setTried(true)
    if (nameBad) { setStep('datos'); return }
    if (!(r.yieldQty > 0)) { setStep('datos'); return ui.toast('El rendimiento debe ser mayor que cero', true) }
    if (compBad) { setStep('datos'); return ui.toast('Completa o quita los ingredientes vacíos', true) }
    if (toolBad) { setStep('costos'); return ui.toast('Cada herramienta necesita un porcentaje de uso entre 0 y 100', true) }
    if (unitErr) return ui.toast(unitErr, true)
    await db.recipes.put({ ...r, name: r.name.trim(), updatedAt: new Date().toISOString() })
    ui.toast('Receta guardada'); onClose()
  }
  const remove = async () => {
    const used = await db.orders.filter((o) => o.lines.some((l) => l.recipeId === r.id)).count()
    const msg = used ? `Esta receta aparece en ${used} pedido(s). Los pedidos conservan su copia de precios y costos. ¿Eliminar la receta?` : `Se eliminará «${r.name}».`
    if (await ui.confirm(msg, 'Eliminar')) { await db.recipes.delete(r.id); onClose() }
  }

  const addComp = () => {
    const first = data.ingredients[0]
    if (!first) return ui.toast('Primero registra al menos un ingrediente', true)
    set('components', [...r.components, { ingredientId: '', qty: 0, unit: 'g' }])
  }
  const setComp = (i: number, patch: Partial<Recipe['components'][number]>) =>
    set('components', r.components.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  const lineCost = (c: Recipe['components'][number]) => {
    const ing = data.ingMap.get(c.ingredientId)
    if (!ing || !(c.qty > 0)) return null
    try { return qtyInBase(c.qty, c.unit, ing.dimension, ing.density) * ing.costPerBase } catch { return NaN }
  }

  return (
    <Sheet title={recipe ? 'Editar receta' : 'Nueva receta'} onClose={onClose}
      footer={<>
        {recipe && <button className="btn danger" onClick={remove}>Eliminar</button>}
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" onClick={save}>Guardar receta</button>
      </>}>
      <div className="stack">
        <div className="seg" role="tablist">
          {([['datos', '1 · Receta'], ['costos', '2 · Costos'], ['precio', '3 · Precio']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={step === k} aria-pressed={step === k} onClick={() => setStep(k)}>{l}</button>
          ))}
        </div>

        {step === 'datos' && (
          <div className="stack">
            <Field label="Nombre del producto" error={tried && nameBad ? 'Escribe un nombre' : undefined}>
              <input value={r.name} onChange={(e) => set('name', e.target.value)} placeholder="Pastel de chocolate" autoFocus aria-invalid={tried && nameBad} />
            </Field>
            <div className="grid2">
              <Field label="Categoría"><select value={r.category} onChange={(e) => set('category', e.target.value)}>{RECIPE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="Tipo"><select value={r.kind} onChange={(e) => set('kind', e.target.value as RecipeKind)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            </div>
            <Field label="Descripción"><textarea value={r.description} onChange={(e) => set('description', e.target.value)} style={{ minHeight: 56 }} /></Field>

            <h3>Ingredientes</h3>
            {r.components.length === 0 && <p className="muted small">Agrega los ingredientes y la cantidad que usa una tanda completa.</p>}
            {r.components.map((c, i) => {
              const ing = data.ingMap.get(c.ingredientId)
              const lc = lineCost(c)
              return (
                <div key={i} className="card stack" style={{ padding: 12 }}>
                  <select aria-label="Ingrediente" value={c.ingredientId} aria-invalid={tried && !c.ingredientId}
                    onChange={(e) => { const n = data.ingMap.get(e.target.value); setComp(i, { ingredientId: e.target.value, unit: n ? unitsFor(n)[0] : 'g' }) }}>
                    <option value="">Elige un ingrediente…</option>
                    {data.ingredients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                  <div className="row">
                    <NumInput value={c.qty || undefined} onChange={(v) => setComp(i, { qty: v ?? 0 })} placeholder="Cantidad" aria-label="Cantidad" invalid={tried && !(c.qty > 0)} />
                    <select aria-label="Unidad" value={c.unit} onChange={(e) => setComp(i, { unit: e.target.value as Unit })} style={{ width: 110 }}>
                      {(ing ? unitsFor(ing) : ALL_UNITS).map((u) => <option key={u}>{u}</option>)}
                    </select>
                    <span className="num nowrap small" style={{ minWidth: 70, textAlign: 'right' }}>{lc === null ? '' : Number.isNaN(lc) ? '—' : formatMXN(Math.round(lc))}</span>
                    <button className="btn small ghost danger" aria-label="Quitar ingrediente" onClick={() => set('components', r.components.filter((_, j) => j !== i))}>✕</button>
                  </div>
                </div>
              )
            })}
            <button className="btn" onClick={addComp}>+ Agregar ingrediente</button>

            <h3>Rendimiento</h3>
            <div className="grid2">
              <Field label="Unidades por tanda" hint="Ej. 1 pastel o 24 galletas" error={tried && !(r.yieldQty > 0) ? 'Mayor que 0' : undefined}><NumInput value={r.yieldQty} onChange={(v) => set('yieldQty', v ?? 0)} /></Field>
              <Field label="Porciones por unidad" hint="Ej. 8 rebanadas por pastel"><NumInput value={r.portionsPerUnit} onChange={(v) => set('portionsPerUnit', v && v >= 1 ? v : 1)} /></Field>
            </div>
            <Field label="Rendimiento real observado (opcional)" hint={r.realYield ? `Esperado ${formatNum(r.yieldQty)} vs real ${formatNum(r.realYield)} (${formatNum((r.realYield / r.yieldQty) * 100)} %)` : undefined}>
              <NumInput value={r.realYield} onChange={(v) => set('realYield', v)} />
            </Field>

            <h3>Tiempos (minutos)</h3>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <Field label="Activo"><NumInput value={r.activeMin} onChange={(v) => set('activeMin', v ?? 0)} /></Field>
              <Field label="Horneado"><NumInput value={r.bakeMin} onChange={(v) => set('bakeMin', v ?? 0)} /></Field>
              <Field label="Reposo / deco"><NumInput value={r.restMin} onChange={(v) => set('restMin', v ?? 0)} /></Field>
            </div>
            <p className="small muted">Tiempo total transcurrido: {formatNum(totalMinutes(r))} min</p>

            <Field label="Pasos de elaboración"><textarea value={r.steps} onChange={(e) => set('steps', e.target.value)} placeholder={'1. Precalentar el horno…'} /></Field>
            <Field label="Notas"><textarea value={r.notes} onChange={(e) => set('notes', e.target.value)} style={{ minHeight: 56 }} /></Field>
          </div>
        )}

        {step === 'costos' && (
          <div className="stack">
            <p className="small muted">Cada rubro usa un solo método, así que ningún costo se cuenta dos veces. Los valores son tuyos: no se asume ninguna tarifa.</p>
            <h3>Mano de obra</h3>
            <div className="grid2">
              <Field label="Método"><select value={r.laborMode} onChange={(e) => set('laborMode', e.target.value as LaborMode)}><option value="hora">Por hora</option><option value="minuto">Por minuto</option><option value="operacion">Por operación</option></select></Field>
              <Field label={r.laborMode === 'hora' ? 'Tarifa por hora (MXN)' : r.laborMode === 'minuto' ? 'Tarifa por minuto (MXN)' : 'Costo por operación (MXN)'}><NumInput {...money('laborRateCents')} /></Field>
            </div>
            {r.laborMode === 'operacion' ? <Field label="Número de operaciones"><NumInput value={r.laborOps} onChange={(v) => set('laborOps', v ?? 0)} /></Field> : <p className="small muted">Usa los {formatNum(r.activeMin)} min de tiempo activo.</p>}

            <h3>Energía (gas / electricidad)</h3>
            <div className="grid2">
              <Field label="Método"><select value={r.energyMode} onChange={(e) => set('energyMode', e.target.value as EnergyMode)}><option value="fijo">Cantidad fija por tanda</option><option value="porcentaje">% del costo de ingredientes</option><option value="tarifa">Tarifa por hora de horno</option></select></Field>
              <Field label={r.energyMode === 'porcentaje' ? 'Porcentaje' : r.energyMode === 'tarifa' ? 'MXN por hora de horno' : 'MXN por tanda'}>
                {r.energyMode === 'porcentaje' ? <NumInput value={r.energyValue} onChange={(v) => set('energyValue', v ?? 0)} /> : <NumInput {...money('energyValue')} />}
              </Field>
            </div>

            <h3>Desgaste de herramientas</h3>
            <p className="small muted">Elige las herramientas que usa esta receta y qué porcentaje de su precio consume cada tanda (por ejemplo 0.5 %). Así vas cubriendo su reposición.</p>
            {data.tools.length === 0 && <div className="banner">Aún no tienes herramientas. Créalas con el botón «+» o en Ingredientes → Herramientas.</div>}
            {uses.map((u, i) => {
              const t = data.toolMap.get(u.toolId)
              const cost = t && u.pct >= 0 ? Math.round((t.priceCents * Math.min(u.pct, 100)) / 100) : null
              return (
                <div key={i} className="card stack" style={{ padding: 12 }}>
                  <select aria-label="Herramienta" value={u.toolId} aria-invalid={tried && !u.toolId} onChange={(e) => setUse(i, { toolId: e.target.value })}>
                    <option value="">Elige una herramienta…</option>
                    {data.tools.filter((x) => x.id === u.toolId || !uses.some((o) => o.toolId === x.id)).map((x) => <option key={x.id} value={x.id}>{x.name} · {formatMXN(x.priceCents)}</option>)}
                  </select>
                  <div className="row">
                    <NumInput value={u.pct || undefined} onChange={(v) => setUse(i, { pct: v ?? 0 })} placeholder="0.5" aria-label="Porcentaje de uso por tanda" invalid={tried && !(u.pct >= 0 && u.pct <= 100)} />
                    <span className="muted">%</span>
                    <span className="num nowrap small" style={{ minWidth: 70, textAlign: 'right' }}>{cost === null ? '' : formatMXN(cost)}</span>
                    <button className="btn small ghost danger" aria-label="Quitar herramienta" onClick={() => set('toolUses', uses.filter((_, j) => j !== i))}>✕</button>
                  </div>
                  {t && t.priceCents === 0 && <div className="small" style={{ color: 'var(--warn)' }}>Esta herramienta tiene precio $0.00; no suma costo.</div>}
                </div>
              )
            })}
            {cost.missingTools.length > 0 && <div className="banner bad">Hay herramientas que ya no existen; quítalas de la receta.</div>}
            {data.tools.length > uses.length && <button className="btn" onClick={() => set('toolUses', [...uses, { toolId: '', pct: 0 }])}>+ Agregar herramienta</button>}

            <h3>Otros</h3>
            <div className="grid2">
              <Field label="Empaque por unidad (MXN)"><NumInput {...money('packagingCentsPerUnit')} /></Field>
              <Field label="Otros costos por tanda (MXN)" hint="Decoración, etiquetas"><NumInput {...money('otherCents')} /></Field>
              <Field label="Merma de ingredientes (%)"><NumInput value={r.ingredientWastePct} onChange={(v) => set('ingredientWastePct', v ?? 0)} /></Field>
              <Field label="Merma del terminado (%)" hint="Unidades que no se podrán vender"><NumInput value={r.finishedWastePct} onChange={(v) => set('finishedWastePct', v ?? 0)} /></Field>
            </div>
            <Field label="Comisión de plataforma / pago (% sobre la venta)"><NumInput value={r.commissionPct} onChange={(v) => set('commissionPct', v ?? 0)} /></Field>
          </div>
        )}

        {step === 'precio' && (
          <div className="stack">
            <div className="grid2">
              <Field label="Margen objetivo (%)"><NumInput value={r.targetMarginPct} onChange={(v) => set('targetMarginPct', v ?? 0)} /></Field>
              <Field label="Tu precio por unidad (MXN)" hint={recommended != null ? `Recomendado: ${formatMXN(recommended)}` : 'Margen + comisión debe ser menor a 100 %'}><NumInput {...money('priceCents')} placeholder={recommended != null ? String(recommended / 100) : ''} /></Field>
            </div>
            {recommended == null && <div className="banner bad">No se puede calcular un precio con ese margen y comisión. Reduce el margen objetivo.</div>}
            {recommended != null && r.priceCents !== recommended && <button className="btn small" onClick={() => set('priceCents', recommended)}>Usar precio recomendado ({formatMXN(recommended)})</button>}
            <div className="card stack">
              <div className="row between"><span>Precio de venta</span><b className="num">{formatMXN(price)}</b></div>
              <div className="row between"><span>Costo unitario</span><span className="num">{formatMXN(cost.unitCostCents)}</span></div>
              {commission > 0 && <div className="row between"><span>Comisión ({formatNum(commission)} %)</span><span className="num">{formatMXN(an.commissionCents)}</span></div>}
              <div className="row between"><span>Ganancia por unidad</span><b className="num" style={{ color: an.profitCents < 0 ? 'var(--bad)' : 'var(--ok)' }}>{formatMXN(an.profitCents)}</b></div>
              <div className="row between"><span>Margen sobre venta</span><span className="num">{an.marginPct == null ? '—' : formatNum(an.marginPct) + ' %'}</span></div>
              <div className="row between"><span>Recargo sobre costo</span><span className="num">{an.markupPct == null ? '—' : formatNum(an.markupPct) + ' %'}</span></div>
              <div className="row between"><span>Ganancia por tanda ({formatNum(cost.usableUnits)} u.)</span><span className="num">{formatMXN(Math.round(an.profitCents * cost.usableUnits))}</span></div>
              {r.portionsPerUnit > 1 && <div className="row between"><span>Precio por porción (1/{r.portionsPerUnit})</span><span className="num">{formatMXN(Math.round(price / r.portionsPerUnit))}</span></div>}
            </div>
            <h3>Escenarios</h3>
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }} className="num small">
                <thead><tr className="muted"><th className="right" style={{ padding: 8 }}>Margen</th><th className="right">Precio</th><th className="right">Ganancia</th><th className="right" style={{ paddingRight: 8 }}>Recargo</th></tr></thead>
                <tbody>
                  {scenarios(cost.unitCostCents, commission).map((s) => (
                    <tr key={s.marginPct} style={{ borderTop: '1px solid var(--line)', cursor: s.priceCents ? 'pointer' : undefined }} onClick={() => s.priceCents != null && set('priceCents', s.priceCents)}>
                      <td className="right" style={{ padding: 8 }}>{s.marginPct} %</td>
                      <td className="right">{s.priceCents == null ? '—' : formatMXN(s.priceCents)}</td>
                      <td className="right">{s.analysis ? formatMXN(s.analysis.profitCents) : '—'}</td>
                      <td className="right" style={{ paddingRight: 8 }}>{s.analysis?.markupPct == null ? '—' : formatNum(s.analysis.markupPct) + ' %'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted">Toca una fila para usar ese precio.</p>
          </div>
        )}

        <div className="card stack" style={{ position: 'sticky', bottom: -8, background: 'var(--surface-2)' }}>
          {unitErr && <div className="banner bad">{unitErr}</div>}
          {cost.missing.length > 0 && <div className="banner bad">Hay ingredientes que ya no existen.</div>}
          <div className="row between small"><span>Ingredientes{cost.wasteCents ? ' + merma' : ''}</span><span className="num">{formatMXN(cost.ingredientsCents + cost.wasteCents)}</span></div>
          <div className="row between small"><span>Mano de obra · energía · herramientas · otros · empaque</span><span className="num">{formatMXN(cost.laborCents + cost.energyCents + cost.toolsCents + cost.otherCents + cost.packagingCents)}</span></div>
          <div className="row between"><b>Costo total de la tanda</b><b className="num">{formatMXN(cost.totalCents)}</b></div>
          <div className="row between"><b>Costo por unidad</b><b className="num">{formatMXN(cost.unitCostCents)}</b></div>
          {r.portionsPerUnit > 1 && <div className="row between small"><span>Costo por porción</span><span className="num">{formatMXN(cost.portionCostCents)}</span></div>}
        </div>
      </div>
    </Sheet>
  )
}

export async function duplicateRecipe(r: Recipe) {
  await db.recipes.add({ ...r, id: uid(), name: `${r.name} (copia)`, favorite: false, demo: undefined, updatedAt: new Date().toISOString() })
}
