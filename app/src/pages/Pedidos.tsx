import { useEffect, useMemo, useState } from 'react'
import { saveOrder } from '../db/db'
import { formatMXN } from '../domain/money'
import { orderMarginError, orderTotals, PAYMENT_LABEL, paymentStatus, refreshQuote, STATUS_LABEL } from '../domain/orders'
import type { Order, OrderStatus, PaymentMethod, PaymentStatus } from '../domain/types'
import { useOpen } from '../ui/create'
import { fmtDateTime, type Data } from '../ui/data'
import { payTone, statusTone } from '../ui/forms/OrderSheet'
import { Badge, Empty, Seg, useUi } from '../ui/ui'

function OrderRow({ o, onClick }: { o: Order; onClick: () => void }) {
  const t = orderTotals(o), ps = paymentStatus(o)
  const marginError = orderMarginError(o)
  return (
    <button className="item" onClick={onClick}>
      <div className="grow">
        <div className="row wrap" style={{ gap: 6 }}><b>{o.customerName}</b><span className="small muted">{o.folio}</span>{o.demo && <Badge tone="pink">demo</Badge>}</div>
        <div className="small muted">Entrega {fmtDateTime(o.deliveryAt)} · {o.lines.reduce((s, l) => s + l.qty, 0)} pza</div>
        <div className="row wrap" style={{ gap: 6, marginTop: 4 }}><Badge tone={statusTone(o.status)}>{STATUS_LABEL[o.status]}</Badge><Badge tone={payTone(ps)}>{PAYMENT_LABEL[ps]}</Badge>{marginError && <Badge tone="warn">Revisar margen</Badge>}</div>
      </div>
      <div className="right num"><b>{formatMXN(t.totalCents)}</b>{t.balanceCents > 0 && o.status !== 'cancelado' && <div className="small" style={{ color: 'var(--warn)' }}>debe {formatMXN(t.balanceCents)}</div>}</div>
    </button>
  )
}

export function Pedidos({ data }: { data: Data }) {
  const open = useOpen()
  const ui = useUi()
  const currentOrders = useMemo(
    () => data.orders.map((o) => refreshQuote(o, data.recipeMap, data.ingMap, data.toolMap)),
    [data.orders, data.recipeMap, data.ingMap, data.toolMap],
  )
  const quotesToRefresh = useMemo(
    () => currentOrders.filter((o, i) => o.status === 'cotizacion' && !orderMarginError(o) && JSON.stringify(o.lines) !== JSON.stringify(data.orders[i].lines)),
    [currentOrders, data.orders],
  )
  useEffect(() => {
    if (!quotesToRefresh.length) return
    let active = true
    void Promise.all(quotesToRefresh.map((o) => saveOrder(o))).catch((e) => {
      if (active) ui.toast(`No se pudieron actualizar las cotizaciones: ${(e as Error).message}`, true)
    })
    return () => { active = false }
  }, [quotesToRefresh, ui])
  const [view, setView] = useState<'lista' | 'agenda' | 'clientes'>('lista')
  const [agendaView, setAgendaView] = useState<'lista' | 'calendario'>('lista')
  const [agendaMonth, setAgendaMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [q, setQ] = useState('')
  const [st, setSt] = useState<'' | OrderStatus>('')
  const [pay, setPay] = useState<'' | PaymentStatus>('')
  const [method, setMethod] = useState<'' | PaymentMethod>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const list = currentOrders.filter((o) => {
    const ql = q.toLowerCase()
    if (ql && !o.folio.toLowerCase().includes(ql) && !o.customerName.toLowerCase().includes(ql)) return false
    if (st && o.status !== st) return false
    if (pay && paymentStatus(o) !== pay) return false
    if (method && !o.payments.some((p) => p.method === method)) return false
    const d = o.deliveryAt.slice(0, 10)
    return (!from || d >= from) && (!to || d <= to)
  }).sort((a, b) => b.deliveryAt.localeCompare(a.deliveryAt))

  const agenda = currentOrders.filter((o) => ['confirmado', 'preparacion', 'listo'].includes(o.status)).sort((a, b) => a.deliveryAt.localeCompare(b.deliveryAt))
  const calendarOrders = [...currentOrders].sort((a, b) => a.deliveryAt.localeCompare(b.deliveryAt))
  const byDay = new Map<string, Order[]>()
  const calendarByDay = new Map<string, Order[]>()
  for (const o of agenda) { const k = o.deliveryAt.slice(0, 10); byDay.set(k, [...(byDay.get(k) ?? []), o]) }
  for (const o of calendarOrders) { const k = o.deliveryAt.slice(0, 10); calendarByDay.set(k, [...(calendarByDay.get(k) ?? []), o]) }
  const monthStart = new Date(agendaMonth.getFullYear(), agendaMonth.getMonth(), 1)
  const monthDays = new Date(agendaMonth.getFullYear(), agendaMonth.getMonth() + 1, 0).getDate()
  const firstDayOffset = (monthStart.getDay() + 6) % 7
  const monthPrefix = `${agendaMonth.getFullYear()}-${String(agendaMonth.getMonth() + 1).padStart(2, '0')}`
  const calendarMonthOrders = calendarOrders.filter((o) => o.deliveryAt.slice(0, 7) === monthPrefix)
  const calendarDays = Array.from({ length: Math.ceil((firstDayOffset + monthDays) / 7) * 7 }, (_, i) => {
    const day = i - firstDayOffset + 1
    return day > 0 && day <= monthDays ? `${agendaMonth.getFullYear()}-${String(agendaMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : ''
  })
  const [today] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  })

  return (
    <div className="stack">
      <div className="page-head"><h1>Pedidos</h1><button className="btn primary" onClick={() => open({ k: view === 'clientes' ? 'customer' : 'order' })}>+ {view === 'clientes' ? 'Cliente' : 'Nuevo'}</button></div>
      <Seg value={view} onChange={setView} options={[['lista', 'Lista'], ['agenda', 'Agenda'], ['clientes', 'Clientes']]} />

      {view === 'lista' && (
        <>
          <input aria-label="Buscar pedido" placeholder="Buscar por folio o cliente…" value={q} onChange={(e) => setQ(e.target.value)} />
          <details>
            <summary className="small muted">Filtros{st || pay || method || from || to ? ' (activos)' : ''}</summary>
            <div className="grid2" style={{ marginTop: 10 }}>
              <select aria-label="Estado" value={st} onChange={(e) => setSt(e.target.value as OrderStatus)}><option value="">Todos los estados</option>{(Object.keys(STATUS_LABEL) as OrderStatus[]).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}</select>
              <select aria-label="Pago" value={pay} onChange={(e) => setPay(e.target.value as PaymentStatus)}><option value="">Todos los pagos</option>{(Object.keys(PAYMENT_LABEL) as PaymentStatus[]).map((k) => <option key={k} value={k}>{PAYMENT_LABEL[k]}</option>)}</select>
              <select aria-label="Forma de pago" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}><option value="">Cualquier forma</option><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="tarjeta">Tarjeta</option><option value="otro">Otro</option></select>
              <span />
              <input type="date" aria-label="Entrega desde" value={from} onChange={(e) => setFrom(e.target.value)} />
              <input type="date" aria-label="Entrega hasta" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <button className="btn small ghost" onClick={() => { setSt(''); setPay(''); setMethod(''); setFrom(''); setTo('') }}>Limpiar filtros</button>
          </details>
          {currentOrders.length === 0 ? <Empty title="Todavía no hay pedidos" text="Crea una cotización o un pedido a partir de tus recetas." action={<button className="btn primary" onClick={() => open({ k: 'order' })}>Crear pedido</button>} />
            : list.length === 0 ? <Empty title="Sin resultados" text="Ningún pedido coincide con la búsqueda o los filtros." />
            : list.map((o) => <OrderRow key={o.id} o={o} onClick={() => open({ k: 'order', v: o })} />)}
        </>
      )}

      {view === 'agenda' && (
        <div className="stack">
          <Seg value={agendaView} onChange={setAgendaView} options={[['lista', 'Lista'], ['calendario', 'Calendario']]} />
          {agendaView === 'lista' ? (agenda.length === 0 ? <Empty title="Sin entregas pendientes" text="Los pedidos confirmados aparecerán aquí por fecha de entrega." /> :
            [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, os]) => (
              <section key={day} className="stack"><h3 style={{ textTransform: 'capitalize' }}>{new Date(`${day}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h3>{os.map((o) => <OrderRow key={o.id} o={o} onClick={() => open({ k: 'order', v: o })} />)}</section>
            ))) : (
            <section className="calendar card" aria-label="Calendario de entregas">
              <div className="row between calendar-head">
                <button className="btn small" aria-label="Mes anterior" onClick={() => setAgendaMonth(new Date(agendaMonth.getFullYear(), agendaMonth.getMonth() - 1, 1))}>‹</button>
                <h2 style={{ textTransform: 'capitalize' }}>{agendaMonth.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}</h2>
                <button className="btn small" aria-label="Mes siguiente" onClick={() => setAgendaMonth(new Date(agendaMonth.getFullYear(), agendaMonth.getMonth() + 1, 1))}>›</button>
              </div>
              <div className="calendar-grid" role="grid">
                {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((day) => <div key={day} className="calendar-weekday" role="columnheader">{day}</div>)}
                {calendarDays.map((day, i) => (
                  <div key={day || `empty-${i}`} className={`calendar-day${day === today ? ' today' : ''}`} role="gridcell" aria-label={day ? new Date(`${day}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' }) : undefined}>
                    {day && <><span className="calendar-date">{Number(day.slice(-2))}</span>{(calendarByDay.get(day) ?? []).map((o) => (
                      <button key={o.id} className={`calendar-order status-${o.status}`} title={`${o.customerName} · ${STATUS_LABEL[o.status]} · ${fmtDateTime(o.deliveryAt)}`}
                        aria-label={`${o.customerName} · ${STATUS_LABEL[o.status]} · ${fmtDateTime(o.deliveryAt)}`} onClick={() => open({ k: 'order', v: o })}>{o.customerName}</button>
                    ))}</>}
                  </div>
                ))}
              </div>
              {calendarMonthOrders.length === 0 && <p className="small muted">No hay pedidos este mes.</p>}
            </section>
          )}
        </div>
      )}

      {view === 'clientes' && (data.customers.length === 0 ? <Empty title="Aún no tienes clientes" text="Guárdalos para no escribir sus datos cada vez." action={<button className="btn primary" onClick={() => open({ k: 'customer' })}>Agregar cliente</button>} /> :
        [...data.customers].sort((a, b) => a.name.localeCompare(b.name, 'es')).map((c) => {
          const os = currentOrders.filter((o) => o.customerId === c.id && o.status !== 'cancelado' && o.status !== 'cotizacion')
          const total = os.reduce((s, o) => s + orderTotals(o).totalCents, 0)
          const pending = os.filter((o) => o.status !== 'entregado').length
          return (
            <button key={c.id} className="item" onClick={() => open({ k: 'customer', v: c })}>
              <div className="grow"><b>{c.name}</b>{c.demo && <> <Badge tone="pink">demo</Badge></>}<div className="small muted">{c.phone ?? 'Sin teléfono'} · {os.length} pedido(s){pending ? ` · ${pending} pendiente(s)` : ''}</div>{c.notes && <div className="small muted">{c.notes.slice(0, 70)}</div>}</div>
              <div className="right num"><b>{formatMXN(total)}</b><div className="small muted">comprado</div></div>
            </button>
          )
        }))}
    </div>
  )
}
