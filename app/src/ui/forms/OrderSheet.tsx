import { useState } from 'react'
import { db, saveOrder, uid } from '../../db/db'
import { formatMXN, formatNum, pesosToCents } from '../../domain/money'
import { lineFromRecipe, nextStatus, orderTotals, OrderError, paymentStatus, PAYMENT_LABEL, STATUS_LABEL, transition } from '../../domain/orders'
import type { Order, OrderStatus, PaymentMethod } from '../../domain/types'
import { toLocalInput, todayISO, type Data } from '../data'
import { Badge, Field, NumInput, Sheet, useUi } from '../ui'
import { CustomerForm } from './SimpleForms'

export const statusTone = (s: OrderStatus) => s === 'entregado' ? 'ok' : s === 'cancelado' ? 'bad' : s === 'cotizacion' ? '' : s === 'listo' ? 'pink' : 'warn'
export const payTone = (p: ReturnType<typeof paymentStatus>) => p === 'pagado' ? 'ok' : p === 'sin_pago' ? 'bad' : 'warn'

function blank(): Order {
  const d = new Date(); d.setDate(d.getDate() + 3); d.setHours(12, 0, 0, 0)
  return {
    id: uid(), folio: '', customerName: '', createdAt: new Date().toISOString(), deliveryAt: d.toISOString(), status: 'cotizacion',
    lines: [], discountCents: 0, deliveryFeeCents: 0, payments: [], adjustments: [], message: '', notes: '',
  }
}

export function OrderSheet({ order, data, presetRecipeId, onClose }: { order?: Order; data: Data; presetRecipeId?: string; onClose: () => void }) {
  const ui = useUi()
  const [o, setO] = useState<Order>(() => {
    if (order) return order
    const b = blank()
    const r = presetRecipeId ? data.recipeMap.get(presetRecipeId) : undefined
    return r ? { ...b, lines: [lineFromRecipe(r, data.ingMap, 1, data.toolMap)] } : b
  })
  const [tried, setTried] = useState(false)
  const [newCustomer, setNewCustomer] = useState(false)
  const [pay, setPay] = useState<{ amount?: number; method: PaymentMethod; refund: boolean } | null>(null)
  const [adj, setAdj] = useState<{ amount?: number; note: string } | null>(null)
  const locked = o.status !== 'cotizacion'
  const closed = o.status === 'cancelado' || o.status === 'entregado'
  const t = orderTotals(o)
  const ps = paymentStatus(o)
  const set = <K extends keyof Order>(k: K, v: Order[K]) => setO((p) => ({ ...p, [k]: v }))
  const setLine = (i: number, patch: Partial<Order['lines'][number]>) => set('lines', o.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const nameBad = !o.customerName.trim()
  const linesBad = o.lines.length === 0

  const persist = async (next: Order, msg = 'Pedido guardado') => {
    const saved = await saveOrder(next)
    setO(saved); ui.toast(msg); return saved
  }
  const save = async () => {
    setTried(true)
    if (nameBad || linesBad) return
    await persist(o); onClose()
  }
  const go = async (to: OrderStatus) => {
    try {
      if (to === 'cancelado' && !(await ui.confirm('El pedido quedará cancelado y no podrá reabrirse.', 'Cancelar pedido'))) return
      if (to === 'confirmado' && (nameBad || linesBad)) { setTried(true); return }
      if (to === 'confirmado' && o.lines.some((l) => l.unitPriceCents <= 0) && !(await ui.confirm('Hay productos con precio $0.00. ¿Confirmar de todos modos?', 'Confirmar'))) return
      await persist(transition(o, to, data.recipeMap, data.ingMap, new Date(), data.toolMap), `Estado: ${STATUS_LABEL[to]}`)
    } catch (e) { ui.toast(e instanceof OrderError ? e.message : (e as Error).message, true) }
  }
  const addPayment = async () => {
    if (!pay?.amount || pay.amount <= 0) return ui.toast('Escribe un monto mayor que 0', true)
    const cents = pesosToCents(pay.amount)
    if (pay.refund && cents > t.paidCents) return ui.toast('El reembolso supera lo cobrado', true)
    if (!pay.refund && cents > t.balanceCents && !(await ui.confirm('El monto supera el saldo pendiente.', 'Registrar'))) return
    const next = { ...o, payments: [...o.payments, { id: uid(), date: todayISO(), amountCents: pay.refund ? -cents : cents, method: pay.method }] }
    setPay(null)
    if (order || o.folio) await persist(next, 'Pago registrado'); else setO(next)
  }
  const addAdjust = async () => {
    if (!adj?.amount || !adj.note.trim()) return ui.toast('Indica monto y motivo', true)
    const next = { ...o, adjustments: [...o.adjustments, { id: uid(), date: todayISO(), amountCents: pesosToCents(adj.amount), note: adj.note.trim() }] }
    setAdj(null)
    if (order || o.folio) await persist(next, 'Ajuste registrado'); else setO(next)
  }
  const customerSel = (id: string) => {
    const c = data.customers.find((x) => x.id === id)
    setO((p) => ({ ...p, customerId: c?.id, customerName: c?.name ?? p.customerName, deliveryAddress: p.deliveryAddress || c?.address }))
  }
  const next = nextStatus(o.status)

  return (
    <Sheet title={o.folio ? `Pedido ${o.folio}` : 'Nuevo pedido'} onClose={onClose}
      footer={<>
        {!closed && o.status !== 'cotizacion' && <button className="btn danger" onClick={() => go('cancelado')}>Cancelar pedido</button>}
        {!closed && <button className="btn" onClick={save}>Guardar</button>}
        {next && <button className="btn primary" onClick={() => go(next)}>{o.status === 'cotizacion' ? 'Confirmar pedido' : `Pasar a «${STATUS_LABEL[next]}»`}</button>}
      </>}>
      <div className="stack">
        <div className="row wrap">
          <Badge tone={statusTone(o.status)}>{STATUS_LABEL[o.status]}</Badge>
          <Badge tone={payTone(ps)}>{PAYMENT_LABEL[ps]}</Badge>
          {o.status === 'cotizacion' && <span className="small muted">Aún no es un compromiso: los costos se actualizan hasta que confirmes.</span>}
          {o.confirmedAt && <span className="small muted">Costos y precios congelados al confirmar.</span>}
        </div>

        <Field label="Cliente" error={tried && nameBad ? 'Elige o escribe un cliente' : undefined}>
          <div className="row">
            <select value={o.customerId ?? ''} onChange={(e) => customerSel(e.target.value)} disabled={closed} aria-invalid={tried && nameBad}>
              <option value="">{o.customerName && !o.customerId ? o.customerName : 'Elige un cliente…'}</option>
              {data.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {!closed && <button className="btn small" onClick={() => setNewCustomer(true)}>+ Nuevo</button>}
          </div>
        </Field>
        <Field label="Entrega"><input type="datetime-local" value={toLocalInput(o.deliveryAt)} disabled={closed} onChange={(e) => e.target.value && set('deliveryAt', new Date(e.target.value).toISOString())} /></Field>

        <h3>Productos</h3>
        {tried && linesBad && <div className="err" role="alert">Agrega al menos un producto</div>}
        {o.lines.map((l, i) => (
          <div key={l.id} className="card stack" style={{ padding: 12 }}>
            <div className="row between"><b>{l.name}</b>{!locked && <button className="btn small ghost danger" aria-label="Quitar" onClick={() => set('lines', o.lines.filter((_, j) => j !== i))}>✕</button>}</div>
            <div className="grid2">
              <Field label="Cantidad"><NumInput value={l.qty} disabled={locked} onChange={(v) => setLine(i, { qty: v && v > 0 ? v : 0 })} /></Field>
              <Field label="Precio unitario (MXN)"><NumInput value={l.unitPriceCents / 100} disabled={locked} onChange={(v) => setLine(i, { unitPriceCents: pesosToCents(v ?? 0) })} /></Field>
            </div>
            <Field label="Personalización / dedicatoria"><input value={l.customization} disabled={closed} onChange={(e) => setLine(i, { customization: e.target.value })} placeholder="Sabor, decoración, mensaje…" /></Field>
            <div className="small muted row between"><span>Costo unitario {locked ? '(congelado)' : 'actual'}: {formatMXN(l.unitCostCents)}</span><span className="num">{formatMXN(Math.round(l.qty * l.unitPriceCents))}</span></div>
          </div>
        ))}
        {!locked && (
          <select aria-label="Agregar producto" value="" onChange={(e) => { const r = data.recipeMap.get(e.target.value); if (r) set('lines', [...o.lines, lineFromRecipe(r, data.ingMap, 1, data.toolMap)]) }}>
            <option value="">+ Agregar producto…</option>
            {data.recipes.map((r) => <option key={r.id} value={r.id}>{r.name}{r.priceCents ? ` · ${formatMXN(r.priceCents)}` : ''}</option>)}
          </select>
        )}
        {!locked && data.recipes.length === 0 && <div className="banner">Aún no tienes recetas. Crea una desde el botón «+».</div>}

        <div className="grid2">
          <Field label="Descuento (MXN)"><NumInput value={o.discountCents / 100} disabled={closed} onChange={(v) => set('discountCents', pesosToCents(Math.max(v ?? 0, 0)))} /></Field>
          <Field label="Envío / cargo extra (MXN)"><NumInput value={o.deliveryFeeCents / 100} disabled={closed} onChange={(v) => set('deliveryFeeCents', pesosToCents(Math.max(v ?? 0, 0)))} /></Field>
        </div>
        <Field label="Dedicatoria o instrucciones especiales"><textarea value={o.message} disabled={closed} onChange={(e) => set('message', e.target.value)} style={{ minHeight: 56 }} /></Field>
        <Field label="Dirección de entrega (opcional)"><input value={o.deliveryAddress ?? ''} disabled={closed} onChange={(e) => set('deliveryAddress', e.target.value)} /></Field>
        <Field label="Notas internas"><textarea value={o.notes} onChange={(e) => set('notes', e.target.value)} style={{ minHeight: 56 }} /></Field>

        <div className="card stack">
          <div className="row between"><span>Subtotal</span><span className="num">{formatMXN(t.subtotalCents)}</span></div>
          {o.discountCents > 0 && <div className="row between"><span>Descuento</span><span className="num">−{formatMXN(o.discountCents)}</span></div>}
          {o.deliveryFeeCents > 0 && <div className="row between"><span>Envío</span><span className="num">{formatMXN(o.deliveryFeeCents)}</span></div>}
          <div className="row between"><b>Total</b><b className="num">{formatMXN(t.totalCents)}</b></div>
          <div className="row between"><span>Cobrado</span><span className="num">{formatMXN(t.paidCents)}</span></div>
          <div className="row between"><b>Saldo pendiente</b><b className="num" style={{ color: t.balanceCents > 0 ? 'var(--warn)' : 'var(--ok)' }}>{formatMXN(t.balanceCents)}</b></div>
          <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%' }} />
          <div className="row between small"><span>Costo de producción</span><span className="num">{formatMXN(t.costCents)}</span></div>
          {t.commissionCents > 0 && <div className="row between small"><span>Comisiones</span><span className="num">{formatMXN(t.commissionCents)}</span></div>}
          {t.adjustmentsCents !== 0 && <div className="row between small"><span>Ajustes de costo</span><span className="num">{formatMXN(t.adjustmentsCents)}</span></div>}
          <div className="row between"><b>Ganancia estimada</b><b className="num" style={{ color: t.profitCents < 0 ? 'var(--bad)' : 'var(--ok)' }}>{formatMXN(t.profitCents)}{t.marginPct != null && ` · ${formatNum(t.marginPct)} %`}</b></div>
        </div>

        <div className="row between"><h3>Pagos</h3>{!closed || o.status === 'entregado' ? <div className="row"><button className="btn small" onClick={() => setPay({ method: 'efectivo', refund: false })}>+ Pago</button>{t.paidCents > 0 && <button className="btn small ghost" onClick={() => setPay({ method: 'efectivo', refund: true })}>Reembolso</button>}</div> : null}</div>
        {o.payments.length === 0 && <p className="small muted">Sin pagos registrados. Confirmar un pedido no implica que esté pagado.</p>}
        {o.payments.map((p) => <div key={p.id} className="row between small"><span>{p.date} · {p.method}{p.amountCents < 0 ? ' · reembolso' : ''}</span><span className="num">{formatMXN(p.amountCents)}</span></div>)}
        {pay && (
          <div className="card stack">
            <div className="grid2">
              <Field label={pay.refund ? 'Monto a reembolsar' : 'Monto (MXN)'}><NumInput value={pay.amount} onChange={(v) => setPay({ ...pay, amount: v })} autoFocus /></Field>
              <Field label="Método"><select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value as PaymentMethod })}><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="tarjeta">Tarjeta</option><option value="otro">Otro</option></select></Field>
            </div>
            <div className="row"><button className="btn primary small" onClick={addPayment}>Registrar</button><button className="btn small" onClick={() => setPay(null)}>Cancelar</button>
              {!pay.refund && t.balanceCents > 0 && <button className="btn small ghost" onClick={() => setPay({ ...pay, amount: t.balanceCents / 100 })}>Saldo completo</button>}</div>
          </div>
        )}

        {locked && (
          <>
            <div className="row between"><h3>Ajustes de costo</h3>{o.status !== 'cancelado' && <button className="btn small" onClick={() => setAdj({ note: '' })}>+ Ajuste</button>}</div>
            {o.adjustments.length === 0 && <p className="small muted">Ingredientes extra, gasolina, reparaciones… se suman al costo sin tocar el costo original.</p>}
            {o.adjustments.map((a) => <div key={a.id} className="row between small"><span>{a.date} · {a.note}</span><span className="num">{formatMXN(a.amountCents)}</span></div>)}
            {adj && (
              <div className="card stack">
                <Field label="Monto (MXN)"><NumInput value={adj.amount} onChange={(v) => setAdj({ ...adj, amount: v })} /></Field>
                <Field label="Motivo"><input value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} /></Field>
                <div className="row"><button className="btn primary small" onClick={addAdjust}>Registrar</button><button className="btn small" onClick={() => setAdj(null)}>Cancelar</button></div>
              </div>
            )}
          </>
        )}
        {o.folio && o.status === 'cotizacion' && <button className="btn danger ghost" onClick={async () => { if (await ui.confirm(`Se eliminará la cotización ${o.folio}.`, 'Eliminar')) { await db.orders.delete(o.id); onClose() } }}>Eliminar cotización</button>}
      </div>
      {newCustomer && <CustomerForm onClose={() => setNewCustomer(false)} onSaved={(c) => setO((p) => ({ ...p, customerId: c.id, customerName: c.name }))} />}
    </Sheet>
  )
}
