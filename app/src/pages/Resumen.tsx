import { useState } from 'react'
import { Link } from 'react-router-dom'
import { staleIngredients } from '../domain/costing'
import { periodRange, statusCounts, summarize, topRecipes, upcoming, type Period } from '../domain/dashboard'
import { formatMXN, formatNum } from '../domain/money'
import { orderTotals, PAYMENT_LABEL, paymentStatus, STATUS_LABEL } from '../domain/orders'
import type { Data } from '../ui/data'
import { fmtDateTime } from '../ui/data'
import { useOpen } from '../ui/create'
import { Badge, Seg, Stat } from '../ui/ui'
import { payTone } from '../ui/forms/OrderSheet'

export function Resumen({ data }: { data: Data }) {
  const [p, setP] = useState<Period>('mes')
  const open = useOpen()
  const s = summarize(data.orders, data.expenses, p)
  const counts = statusCounts(data.orders)
  const next = upcoming(data.orders)
  const top = topRecipes(data.orders).slice(0, 4)
  const stale = staleIngredients(data.ingredients, data.settings.staleDays)
  const receivable = data.orders.filter((o) => ['confirmado', 'preparacion', 'listo', 'entregado'].includes(o.status)).reduce((a, o) => a + Math.max(orderTotals(o).balanceCents, 0), 0)
  const empty = data.orders.length === 0 && data.recipes.length === 0
  const total = s.costCents + Math.max(s.grossProfitCents, 0)
  const [from] = periodRange(p)
  const hasReal = data.orders.some((o) => !o.demo) || data.recipes.some((r) => !r.demo) || data.ingredients.some((i) => !i.demo)
  const backupDays = data.settings.lastBackupAt ? Math.floor((Date.now() - new Date(data.settings.lastBackupAt).getTime()) / 86400000) : null
  const backupDue = hasReal && (backupDays === null || backupDays >= 7)

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div><h1>{data.settings.businessName || 'Resumen'}</h1><div className="muted small">Resumen del negocio</div></div>
      </div>
      {data.settings.demoLoaded && <div className="banner">Estás viendo <b>datos de demostración</b> mezclados con los tuyos. Bórralos en Ajustes cuando quieras.</div>}
      {backupDue && <Link to="/ajustes" className="banner" style={{ textDecoration: 'none', display: 'block' }}>{data.settings.lastBackupAt ? `Tu última copia de seguridad fue hace ${backupDays} días.` : 'Aún no has hecho una copia de seguridad.'} Descárgala en Ajustes → toca aquí.</Link>}
      {!data.settings.onboardingDone && <Link to="/inicio" className="banner ok" style={{ textDecoration: 'none' }}>Continúa tu guía de inicio → registra tu primer pedido en 5 minutos</Link>}

      <div className="stack">
        <Seg value={p} onChange={setP} options={[['dia', 'Hoy'], ['semana', 'Semana'], ['mes', 'Mes']]} />
        <div className="grid">
          <Stat label="Ventas (pedidos confirmados)" value={formatMXN(s.salesCents)} hint={`${s.orderCount} pedido(s)`} />
          <Stat label="Cobrado en el periodo" value={formatMXN(s.collectedCents)} hint="Pagos recibidos" />
          <Stat label="Costos estimados" value={formatMXN(s.costCents)} hint="Según recetas al confirmar" />
          <Stat label="Gastos registrados" value={formatMXN(s.expensesCents)} />
          <Stat label="Ganancia bruta estimada" value={s.orderCount ? formatMXN(s.grossProfitCents) : '—'} hint={s.marginPct != null ? `Margen ${formatNum(s.marginPct)} %` : 'Sin ventas aún'} />
          <Stat label="Ganancia neta estimada" value={s.hasData ? formatMXN(s.netProfitCents) : '—'} hint="Bruta − gastos. Es una estimación, no contabilidad." />
        </div>
        {s.salesCents > 0 && (
          <div className="card stack">
            <div className="small muted">¿A dónde va el dinero de las ventas desde el {from.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}?</div>
            <div className="bar" role="img" aria-label={`Costos ${formatMXN(s.costCents)}, ganancia ${formatMXN(s.grossProfitCents)}`}>
              <span style={{ width: `${(s.costCents / total) * 100}%`, background: 'var(--accent)' }} />
              <span style={{ width: `${(Math.max(s.grossProfitCents, 0) / total) * 100}%`, background: 'var(--ok)' }} />
            </div>
            <div className="row between small"><span><span style={{ color: 'var(--accent-strong)' }}>●</span> Costos {formatMXN(s.costCents)}</span><span><span style={{ color: 'var(--ok)' }}>●</span> Ganancia {formatMXN(s.grossProfitCents)}</span></div>
          </div>
        )}
      </div>

      {empty && (
        <div className="card empty">
          <h3>Todo listo para empezar</h3>
          <p>Registra tus ingredientes, crea tu primera receta y toma tu primer pedido.</p>
          <Link to="/inicio" className="btn primary" style={{ textDecoration: 'none' }}>Empezar guía paso a paso</Link>
        </div>
      )}

      <section className="stack">
        <h2>Pedidos</h2>
        <div className="grid">
          {(['confirmado', 'preparacion', 'listo', 'entregado'] as const).map((k) => <Link key={k} to="/pedidos" style={{ textDecoration: 'none', color: 'inherit' }}><Stat label={STATUS_LABEL[k]} value={counts[k]} /></Link>)}
          <Stat label="Por cobrar" value={formatMXN(receivable)} hint="Saldos pendientes" />
        </div>
        {next.length === 0 ? <p className="muted small">No hay entregas próximas.</p> : next.map((o) => (
          <button key={o.id} className="item" onClick={() => open({ k: 'order', v: o })}>
            <div className="grow"><b>{o.customerName}</b> <span className="muted small">· {o.folio}</span><div className="small muted">{fmtDateTime(o.deliveryAt)}</div></div>
            <Badge tone={payTone(paymentStatus(o))}>{PAYMENT_LABEL[paymentStatus(o)]}</Badge>
          </button>
        ))}
      </section>

      {top.length > 0 && (
        <section className="stack">
          <h2>Lo más vendido</h2>
          {top.map((t) => (
            <div key={t.recipeId} className="item" style={{ cursor: 'default' }}>
              <div className="grow"><b>{t.name}</b><div className="small muted">{formatNum(t.units)} vendidas</div></div>
              <div className="right"><div className="num">{formatMXN(t.revenueCents)}</div><div className="small num" style={{ color: 'var(--ok)' }}>+{formatMXN(t.profitCents)}</div></div>
            </div>
          ))}
        </section>
      )}

      {stale.length > 0 && (
        <section className="stack">
          <h2>Precios por revisar</h2>
          <p className="small muted">No has actualizado estos ingredientes en más de {data.settings.staleDays} días; el costo de tus recetas podría estar desactualizado.</p>
          {stale.slice(0, 5).map((i) => <button key={i.id} className="item" onClick={() => open({ k: 'ingredient', v: i })}><span className="grow">{i.name}</span><Badge tone="warn">Revisar</Badge></button>)}
        </section>
      )}

      <section className="stack">
        <h2>Accesos rápidos</h2>
        <div className="grid">
          <button className="btn" onClick={() => open({ k: 'order' })}>Nuevo pedido</button>
          <button className="btn" onClick={() => open({ k: 'recipe' })}>Nueva receta</button>
          <button className="btn" onClick={() => open({ k: 'ingredient' })}>Nuevo ingrediente</button>
          <button className="btn" onClick={() => open({ k: 'expense' })}>Nuevo gasto</button>
        </div>
      </section>
    </div>
  )
}
