import { useState } from 'react'
import { Link } from 'react-router-dom'
import { db, saveSettings } from '../db/db'
import { loadDemo } from '../db/demo'
import { recipeCost } from '../domain/costing'
import { formatMXN, formatNum } from '../domain/money'
import { analyzePrice, priceForMargin } from '../domain/pricing'
import { orderTotals } from '../domain/orders'
import { useOpen } from '../ui/create'
import type { Data } from '../ui/data'
import { CostPreview, previewCost } from '../ui/forms/IngredientForm'
import { Field, NumInput, useUi } from '../ui/ui'

const STEPS = ['Tu negocio', 'Ingredientes', 'Primera receta', 'Precio de venta', 'Primer pedido', 'Resumen']

export function Inicio({ data }: { data: Data }) {
  const open = useOpen()
  const ui = useUi()
  const s = data.settings
  const real = {
    ing: data.ingredients.filter((i) => !i.demo), rec: data.recipes.filter((r) => !r.demo), ord: data.orders.filter((o) => !o.demo),
  }
  const done = [
    !!s.businessName.trim(), real.ing.length > 0, real.rec.length > 0, real.rec.some((r) => (r.priceCents ?? 0) > 0), real.ord.length > 0, !!s.onboarding.resumen,
  ]
  const firstOpen = done.findIndex((d) => !d)
  const [step, setStep] = useState(Math.max(firstOpen, 0))
  const [name, setName] = useState(s.businessName)
  const [ex, setEx] = useState<{ q?: number; p?: number }>({ q: 1000, p: 180 })
  const [margin, setMargin] = useState<number | undefined>(s.defaultMarginPct)
  const [pickId, setPickId] = useState('')
  const pct = Math.round((done.filter(Boolean).length / STEPS.length) * 100)

  const recipe = data.recipeMap.get(pickId) ?? real.rec[0]
  const rc = recipe ? recipeCost(recipe, data.ingMap, data.toolMap) : null
  const rec = rc && margin != null ? priceForMargin(rc.unitCostCents, margin, recipe!.commissionPct) : null
  const lastOrder = [...real.ord].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const t = lastOrder ? orderTotals(lastOrder) : null

  const next = async () => {
    if (step === 0 && name.trim() !== s.businessName) await saveSettings({ businessName: name.trim(), defaultMarginPct: margin ?? s.defaultMarginPct })
    if (step === STEPS.length - 1) { await saveSettings({ onboarding: { ...s.onboarding, resumen: true }, onboardingDone: true }); ui.toast('¡Listo! Ya puedes usar tu app'); return }
    setStep(step + 1)
  }

  return (
    <div className="stack-lg">
      <div className="page-head"><div><h1>Guía de inicio</h1><div className="muted small">Registra tu primer pedido en unos 5 minutos</div></div><Link to="/" className="btn small">Salir</Link></div>
      <div className="stack">
        <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progreso de configuración"><span style={{ width: `${pct}%`, background: 'var(--ok)' }} /></div>
        <div className="small muted">{pct} % completado · tus datos se guardan automáticamente, puedes continuar después.</div>
      </div>

      <div className="card" style={{ padding: '4px 16px' }}>
        {STEPS.map((l, i) => (
          <button key={l} className="check" onClick={() => setStep(i)} style={{ width: '100%', background: 'none', border: 0, borderBottom: i < STEPS.length - 1 ? '1px solid var(--line)' : 0, textAlign: 'left', cursor: 'pointer', fontWeight: i === step ? 700 : 400 }}>
            <span className={`dot ${done[i] ? 'done' : ''}`}>{done[i] ? '✓' : ''}</span>{i + 1}. {l}
          </button>
        ))}
      </div>

      <div className="card stack" aria-live="polite">
        <h2>{step + 1}. {STEPS[step]}</h2>
        {step === 0 && (
          <>
            <p>Empecemos con lo básico. La moneda es el peso mexicano (MXN) y la app está en español.</p>
            <Field label="Nombre de tu pastelería"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dulce Rosa" /></Field>
            <Field label="Margen de ganancia que buscas (%)" hint="Es el porcentaje del precio de venta que quedará como ganancia. Podrás cambiarlo en cada receta."><NumInput value={margin} onChange={setMargin} /></Field>
          </>
        )}
        {step === 1 && (
          <>
            <p>Anota cuánto pagas por cada ingrediente. La app calcula el costo por gramo, mililitro o pieza. Prueba con este ejemplo:</p>
            <div className="grid2">
              <Field label="Compré (g)"><NumInput value={ex.q} onChange={(q) => setEx({ ...ex, q })} /></Field>
              <Field label="Pagué (MXN)"><NumInput value={ex.p} onChange={(p) => setEx({ ...ex, p })} /></Field>
            </div>
            <CostPreview p={previewCost(ex.q, 'g', ex.p)} />
            <button className="btn primary" onClick={() => open({ k: 'ingredient' })}>Registrar un ingrediente real</button>
            <p className="small muted">{real.ing.length} ingrediente(s) registrado(s). Con 3 o 4 basta para tu primera receta.</p>
          </>
        )}
        {step === 2 && (
          <>
            <p>Elige los ingredientes y las cantidades que usa una tanda, cuántas unidades rinde y cuánto tardas. Incluye mano de obra y merma en la pestaña «Costos».</p>
            {real.ing.length === 0 && <div className="banner">Primero registra al menos un ingrediente (paso 2).</div>}
            <button className="btn primary" onClick={() => open({ k: 'recipe' })} disabled={data.ingredients.length === 0}>Crear mi primera receta</button>
            <p className="small muted">{real.rec.length} receta(s) creada(s).</p>
          </>
        )}
        {step === 3 && (
          <>
            {!recipe || !rc ? <div className="banner">Crea una receta para calcular su precio (paso 3).</div> : (
              <>
                <p>Costo real estimado de <b>{recipe.name}</b>: <b>{formatMXN(rc.unitCostCents)}</b> por unidad. Elige tu margen y verás el precio que debes cobrar.</p>
                {real.rec.length > 1 && <select aria-label="Receta" value={recipe.id} onChange={(e) => setPickId(e.target.value)}>{real.rec.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>}
                <Field label="Margen objetivo (%)"><NumInput value={margin} onChange={setMargin} /></Field>
                {rec == null ? <div className="banner bad">Con ese margen no se puede calcular un precio. Usa un valor menor a 100.</div> : (
                  <div className="card stack">
                    <div className="row between"><span>Precio recomendado</span><b className="num">{formatMXN(rec)}</b></div>
                    <div className="row between small"><span>Ganancia por unidad</span><span className="num">{formatMXN(analyzePrice(rec, rc.unitCostCents, recipe.commissionPct).profitCents)}</span></div>
                    <div className="small muted">Fórmula: precio = costo ÷ (1 − margen). Margen sobre ventas, no recargo sobre costo.</div>
                    <button className="btn primary" onClick={async () => { await db.recipes.update(recipe.id, { priceCents: rec, targetMarginPct: margin }); ui.toast('Precio guardado') }}>Usar este precio</button>
                  </div>
                )}
                {(recipe.priceCents ?? 0) > 0 && <p className="small" style={{ color: 'var(--ok)' }}>Precio actual: {formatMXN(recipe.priceCents!)} (puedes ajustarlo manualmente en la receta).</p>}
              </>
            )}
          </>
        )}
        {step === 4 && (
          <>
            <p>Agrega un cliente, elige el producto, la cantidad y la fecha de entrega. Si recibes un anticipo, regístralo dentro del pedido.</p>
            {real.rec.length === 0 && <div className="banner">Necesitas una receta con precio (pasos 3 y 4).</div>}
            <button className="btn primary" disabled={data.recipes.length === 0} onClick={() => open({ k: 'order', recipeId: real.rec[0]?.id })}>Registrar mi primer pedido</button>
            <p className="small muted">Consejo: «Confirmar» congela precios y costos; el pago se registra aparte.</p>
          </>
        )}
        {step === 5 && (
          <>
            {!t || !lastOrder ? <div className="banner">Aún no hay pedidos reales para revisar (paso 5).</div> : (
              <>
                <p>Así se reparte el pedido <b>{lastOrder.folio}</b> de {lastOrder.customerName}:</p>
                <div className="bar" aria-hidden><span style={{ width: `${(t.costCents + t.commissionCents + t.adjustmentsCents) / Math.max(t.totalCents, 1) * 100}%`, background: 'var(--accent)' }} /><span style={{ width: `${Math.max(t.profitCents, 0) / Math.max(t.totalCents, 1) * 100}%`, background: 'var(--ok)' }} /></div>
                <div className="card stack">
                  <div className="row between"><span>Precio de venta</span><b className="num">{formatMXN(t.totalCents)}</b></div>
                  <div className="row between"><span>Costos estimados</span><span className="num">{formatMXN(t.costCents + t.commissionCents + t.adjustmentsCents)}</span></div>
                  <div className="row between"><b>Ganancia estimada</b><b className="num" style={{ color: 'var(--ok)' }}>{formatMXN(t.profitCents)}{t.marginPct != null && ` · ${formatNum(t.marginPct)} %`}</b></div>
                  <div className="row between small"><span>Cobrado / pendiente</span><span className="num">{formatMXN(t.paidCents)} / {formatMXN(t.balanceCents)}</span></div>
                </div>
              </>
            )}
          </>
        )}
        <div className="row between">
          <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>Atrás</button>
          <div className="row">
            {step < STEPS.length - 1 && <button className="btn ghost" onClick={() => setStep(step + 1)}>Omitir</button>}
            <button className="btn primary" onClick={next}>{step === STEPS.length - 1 ? 'Terminar' : 'Siguiente'}</button>
          </div>
        </div>
      </div>

      {!s.demoLoaded && real.ing.length === 0 && (
        <div className="card stack"><b>¿Prefieres explorar primero?</b><p className="small muted">Carga datos de ejemplo marcados como «demo». Podrás borrarlos con un toque y nunca se mezclan con tus exportaciones.</p><button className="btn" onClick={async () => { await loadDemo(); ui.toast('Ejemplos cargados') }}>Cargar ejemplos</button></div>
      )}
    </div>
  )
}
