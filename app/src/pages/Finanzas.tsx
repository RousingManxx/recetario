import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  buildSeries, computeMetrics, costDistribution, dataWarnings, defaultGranularity, delta, movementsIn, NO_FILTERS, ordersAndCollections,
  PERIOD_LABEL, productRows, receivables, resolveRange, saleOrdersIn, type Filters, type Granularity, type PeriodKey, type StatusGroup,
} from '../domain/finance'
import { formatMXN, formatNum } from '../domain/money'
import { PAYMENT_LABEL, paymentStatus, STATUS_LABEL, orderTotals } from '../domain/orders'
import type { Order } from '../domain/types'
import { Donut, HBars, Legend, MarginChart, TrendChart } from '../ui/charts'
import { useOpen } from '../ui/create'
import { fmtDate, todayISO, type Data } from '../ui/data'
import { Empty, Seg, Sheet, useUi } from '../ui/ui'

const PERIODS: PeriodKey[] = ['hoy', '7d', 'mes', 'mes_ant', '3m', 'anio', 'custom']
type Drill = 'ventas' | 'cobrado' | 'gastos' | 'porcobrar' | 'anticipos' | 'caja' | null

function Kpi({ label, value, hint, d, good, onClick, invert }: { label: string; value: string; hint?: string; d?: { abs: number; pct: number | null } | null; good?: boolean; onClick?: () => void; invert?: boolean }) {
  const dir = d && d.abs !== 0 ? (d.abs > 0 ? 'más' : 'menos') : null
  const tone = d && d.abs !== 0 && good ? ((d.abs > 0) !== !!invert ? 'up' : 'down') : ''
  return (
    <button className="stat kpi" onClick={onClick} aria-label={`${label}: ${value}. Ver detalle`}>
      <div className="l">{label}</div><div className="v num">{value}</div>
      {hint && <div className="h">{hint}</div>}
      {d && <div className={`delta ${tone}`}>{d.abs === 0 ? '＝ igual que el periodo anterior' : <>{d.abs > 0 ? '▲' : '▼'} {formatMXN(Math.abs(d.abs))} {dir}{d.pct != null && ` (${d.pct > 0 ? '+' : ''}${formatNum(d.pct)} %)`}</>}</div>}
    </button>
  )
}

export function Finanzas({ data }: { data: Data }) {
  const open = useOpen()
  const ui = useUi()
  const [period, setPeriod] = useState<PeriodKey>('mes')
  const [custom, setCustom] = useState({ from: todayISO().slice(0, 8) + '01', to: todayISO() })
  const [compare, setCompare] = useState(true)
  const [gran, setGran] = useState<'auto' | Granularity>('auto')
  const [f, setF] = useState<Filters>(NO_FILTERS)
  const [recMetric, setRecMetric] = useState<'margen' | 'ganancia'>('ganancia')
  const [prodMetric, setProdMetric] = useState<'cantidad' | 'ingresos'>('ingresos')
  const [drill, setDrill] = useState<Drill>(null)

  const ctx = useMemo(() => ({ orders: data.orders, expenses: data.expenses, purchases: data.purchases, recipes: data.recipes }), [data.orders, data.expenses, data.purchases, data.recipes])
  const { range, prev, days } = useMemo(() => resolveRange(period, new Date(), custom), [period, custom])
  const g: Granularity = gran === 'auto' ? defaultGranularity(days) : gran
  const m = useMemo(() => computeMetrics(ctx, range, f), [ctx, range, f])
  const pm = useMemo(() => computeMetrics(ctx, prev, f), [ctx, prev, f])
  const series = useMemo(() => buildSeries(ctx, range, g, f), [ctx, range, g, f])
  const dist = useMemo(() => costDistribution(ctx, range, f), [ctx, range, f])
  const rows = useMemo(() => productRows(ctx, range, f), [ctx, range, f])
  const rec = useMemo(() => receivables(ctx, f), [ctx, f])
  const oc = useMemo(() => ordersAndCollections(ctx, range, f), [ctx, range, f])
  const warnings = useMemo(() => dataWarnings(ctx, range, f, m), [ctx, range, f, m])
  const mv = useMemo(() => movementsIn(ctx, range, f), [ctx, range, f])

  const cats = [...new Set(data.recipes.map((r) => r.category))].sort()
  const anyData = data.orders.some((o) => o.status !== 'cotizacion') || data.expenses.length > 0
  const dl = (cur: number, p: number) => (compare ? delta(cur, p) : null)
  const marginDelta = compare && m.marginPct != null && pm.marginPct != null ? m.marginPct - pm.marginPct : null
  const showCash = !m.productFiltered
  const periodText = `${fmtDate(range.from.toISOString())} – ${fmtDate(new Date(range.to.getTime() - 1).toISOString())}`

  const openRecipe = (id: string) => { const r = data.recipeMap.get(id); r ? open({ k: 'recipe', v: r }) : ui.toast('Esa receta ya no existe; el pedido conserva sus datos originales.', true) }
  const byMargin = [...rows].filter((r) => r.marginPct != null).sort((a, b) => b.marginPct! - a.marginPct!)
  const byProfit = [...rows].sort((a, b) => b.profit - a.profit)
  const recRows = (recMetric === 'margen' ? byMargin : byProfit)
  const top = [...rows].sort((a, b) => (prodMetric === 'cantidad' ? b.units - a.units : b.revenue - a.revenue))
  const empty = <div className="empty small">Sin ventas confirmadas en este periodo.</div>
  const delivered = oc.delivered, future = oc.future
  const marginDrop = marginDelta != null && marginDelta <= -5

  if (!anyData && data.recipes.length === 0)
    return (
      <div className="stack-lg">
        <div className="page-head"><h1>Finanzas</h1></div>
        <Empty title="Aún no hay datos financieros" text="Cuando confirmes pedidos, registres cobros y gastos, aquí verás tus ventas, costos y ganancias con gráficas." action={<div className="row wrap" style={{ justifyContent: 'center' }}><button className="btn primary" onClick={() => open({ k: 'order' })}>Crear pedido</button><button className="btn" onClick={() => open({ k: 'expense' })}>Registrar gasto</button><button className="btn" onClick={() => open({ k: 'ingredient' })}>Registrar ingrediente</button></div>} />
      </div>
    )

  return (
    <div className="stack-lg">
      <div className="page-head"><div><h1>Finanzas</h1><div className="muted small">{PERIOD_LABEL[period]} · {periodText}</div></div></div>
      {data.settings.demoLoaded && <div className="banner">Las cifras incluyen <b>datos de demostración</b>. Bórralos en Ajustes para ver solo tu negocio.</div>}

      <div className="stack">
        <div className="seg scroll" role="group" aria-label="Periodo">
          {PERIODS.map((k) => <button key={k} aria-pressed={period === k} onClick={() => setPeriod(k)}>{PERIOD_LABEL[k]}</button>)}
        </div>
        {period === 'custom' && (
          <div className="grid2">
            <label className="f">Desde<input type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} /></label>
            <label className="f">Hasta<input type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} /></label>
          </div>
        )}
        <details>
          <summary className="small muted">Filtros y comparación{f.status !== 'todos' || f.category || f.recipeId ? ' (activos)' : ''}</summary>
          <div className="stack" style={{ marginTop: 10 }}>
            <div className="grid2">
              <label className="f">Pedidos<select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as StatusGroup })}><option value="todos">Todos los confirmados</option><option value="por_entregar">Por entregar</option><option value="entregados">Entregados</option></select></label>
              <label className="f">Categoría<select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value, recipeId: '' })}><option value="">Todas</option>{cats.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label className="f">Producto<select value={f.recipeId} onChange={(e) => setF({ ...f, recipeId: e.target.value })}><option value="">Todos</option>{data.recipes.filter((r) => !f.category || r.category === f.category).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
              <label className="f">Agrupar gráficas por<select value={gran} onChange={(e) => setGran(e.target.value as 'auto' | Granularity)}><option value="auto">Automático</option><option value="dia">Día</option><option value="semana">Semana</option><option value="mes">Mes</option></select></label>
            </div>
            <label className="row"><input type="checkbox" style={{ width: 22, minHeight: 22 }} checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Comparar con el periodo anterior</label>
            <button className="btn small ghost" onClick={() => setF(NO_FILTERS)}>Limpiar filtros</button>
          </div>
        </details>
      </div>

      {warnings.map((w, i) => <div key={i} className="banner" role="note">⚠ {w}</div>)}

      <section className="stack" aria-label="Indicadores">
        <div className="grid">
          <Kpi label="Ingresos por ventas" value={formatMXN(m.sales)} hint={`${m.orderCount} pedido(s) confirmados`} d={dl(m.sales, pm.sales)} good onClick={() => setDrill('ventas')} />
          <Kpi label="Costos de producción" value={formatMXN(m.cost)} hint="Costos congelados al confirmar" d={dl(m.cost, pm.cost)} good invert onClick={() => setDrill('ventas')} />
          <Kpi label="Ganancia bruta" value={formatMXN(m.gross)} d={dl(m.gross, pm.gross)} good onClick={() => setDrill('ventas')} />
          <Kpi label="Margen de beneficio" value={m.marginPct == null ? '—' : formatNum(m.marginPct) + ' %'} hint={marginDelta != null ? `${marginDelta > 0 ? '▲ +' : marginDelta < 0 ? '▼ ' : ''}${formatNum(marginDelta)} pts vs. periodo anterior` : 'Ganancia bruta ÷ ventas'} />
          {showCash && <>
            <Kpi label="Gastos operativos" value={formatMXN(m.expenses)} hint="Registrados en el periodo" d={dl(m.expenses, pm.expenses)} good invert onClick={() => setDrill('gastos')} />
            <Kpi label="Ganancia neta estimada" value={formatMXN(m.net)} hint="Bruta − gastos. Estimación, no contabilidad." d={dl(m.net, pm.net)} good onClick={() => setDrill('gastos')} />
            <Kpi label="Cobrado" value={formatMXN(m.collected - m.refunds)} hint={m.refunds ? `Incluye reembolsos de ${formatMXN(m.refunds)}` : 'Dinero recibido en el periodo'} d={dl(m.collected - m.refunds, pm.collected - pm.refunds)} good onClick={() => setDrill('cobrado')} />
            <Kpi label="Por cobrar (hoy)" value={formatMXN(rec.total)} hint={`${formatMXN(rec.delivered)} ya entregado · ${formatMXN(rec.future)} por entregar`} onClick={() => setDrill('porcobrar')} />
            <Kpi label="Anticipos recibidos" value={formatMXN(m.advances)} hint="Cobros de pedidos aún sin entregar" onClick={() => setDrill('anticipos')} />
          </>}
        </div>
      </section>

      {marginDrop && <div className="banner bad" role="note">Tu margen bajó {formatNum(Math.abs(marginDelta!))} puntos frente al periodo anterior. Si tus costos suben más rápido que tus precios, revisa los <Link to="/ingredientes">ingredientes con precio al alza</Link> y actualiza tus precios de venta.</div>}

      <section className="fcard" aria-labelledby="t1">
        <div className="row between wrap"><h2 id="t1">Ventas, costos y ganancia</h2><span className="small muted">por {g === 'dia' ? 'día' : g}</span></div>
        <Legend items={[{ label: 'Ventas', color: 'var(--ch-sales)' }, { label: 'Costos', color: 'var(--ch-cost)', kind: 'hatch' }, { label: 'Ganancia bruta', color: 'var(--ch-profit)', kind: 'line' }]} />
        <TrendChart points={series} empty={empty} />
        <p className="small muted">Toca o desliza sobre la gráfica (o usa las flechas del teclado) para ver el detalle de cada punto.</p>
        <details><summary className="small muted">Ver como tabla</summary>
          <div style={{ overflowX: 'auto' }}><table className="table num"><thead><tr><th>{g === 'dia' ? 'Día' : g === 'semana' ? 'Semana de' : 'Mes'}</th><th>Ventas</th><th>Costos</th><th>Ganancia</th><th>Cobrado</th></tr></thead>
            <tbody>{series.map((p) => <tr key={p.start.getTime()}><td>{p.label}</td><td>{formatMXN(p.sales)}</td><td>{formatMXN(p.cost)}</td><td>{formatMXN(p.gross)}</td><td>{formatMXN(p.collected)}</td></tr>)}</tbody></table></div>
        </details>
      </section>

      <section className="fcard" aria-labelledby="t2">
        <h2 id="t2">Evolución del margen</h2>
        <MarginChart points={series} empty={empty} />
        <p className="small muted">Margen = ganancia bruta ÷ ventas. Los periodos sin ventas no se grafican.</p>
      </section>

      <section className="fcard" aria-labelledby="t3">
        <h2 id="t3">¿En qué se van tus costos?</h2>
        {dist.length === 0 ? empty : <Donut slices={dist} />}
        {dist.some((x) => x.key === 'unknown') && <p className="small muted">«Sin desglose» son pedidos confirmados antes de que la app guardara el detalle de costos. Los nuevos sí lo incluyen.</p>}
      </section>

      <section className="fcard" aria-labelledby="t4">
        <div className="row between wrap"><h2 id="t4">Rentabilidad por receta</h2><Seg value={recMetric} onChange={setRecMetric} options={[['ganancia', 'Ganancia $'], ['margen', 'Margen %']]} /></div>
        {recRows.length === 0 ? empty : (
          <>
            <p className="small"><b>Más rentable:</b> {recRows[0].name} · <b>Menos rentable:</b> {recRows[recRows.length - 1].name}</p>
            <HBars rows={recRows.slice(0, 8).map((r) => ({ id: r.recipeId, label: r.name, sub: recMetric === 'ganancia' ? (r.marginPct == null ? undefined : `margen ${formatNum(r.marginPct)} %`) : `ganancia ${formatMXN(r.profit)}`, value: recMetric === 'ganancia' ? r.profit : r.marginPct ?? 0, display: recMetric === 'ganancia' ? formatMXN(r.profit) : r.marginPct == null ? '—' : formatNum(r.marginPct) + ' %' }))} onSelect={openRecipe} color="var(--ch-profit)" />
            {recRows.length > 8 && <p className="small muted">Mostrando 8 de {recRows.length}. Filtra por categoría para ver el resto.</p>}
            <p className="small muted">Toca una receta para ver su desglose de costos. Rentabilidad con los costos congelados en cada pedido.</p>
          </>
        )}
      </section>

      <section className="fcard" aria-labelledby="t5">
        <div className="row between wrap"><h2 id="t5">Ventas por producto</h2><Seg value={prodMetric} onChange={setProdMetric} options={[['ingresos', 'Ingresos'], ['cantidad', 'Cantidad']]} /></div>
        {top.length === 0 ? empty : <HBars rows={top.slice(0, 8).map((r) => ({ id: r.recipeId, label: r.name, sub: prodMetric === 'cantidad' ? formatMXN(r.revenue) : `${formatNum(r.units)} u.`, value: prodMetric === 'cantidad' ? r.units : r.revenue, display: prodMetric === 'cantidad' ? `${formatNum(r.units)} u.` : formatMXN(r.revenue) }))} onSelect={openRecipe} />}
      </section>

      <section className="fcard" aria-labelledby="t6">
        <h2 id="t6">Pedidos y cobros</h2>
        <p className="small muted">Pedidos confirmados en el periodo. Los <b>entregados</b> ya son ventas cumplidas; los <b>por entregar</b> son compromisos futuros.</p>
        <Legend items={[{ label: 'Cobrado', color: 'var(--ok)' }, { label: 'Pendiente', color: 'var(--warn)', kind: 'hatch' }]} />
        {[['Entregados', delivered], ['Por entregar', future]].map(([title, x]) => {
          const g2 = x as typeof delivered
          return (
            <div key={title as string} className="stack" style={{ gap: 6 }}>
              <div className="row between"><b>{title as string} <span className="muted small">({g2.count})</span></b><span className="num"><b>{formatMXN(g2.confirmed)}</b></span></div>
              <div className="stack-bar" role="img" aria-label={`${title}: cobrado ${formatMXN(g2.collected)} de ${formatMXN(g2.confirmed)}, pendiente ${formatMXN(g2.pending)}`}>
                <span style={{ width: `${g2.confirmed > 0 ? Math.min(g2.collected / g2.confirmed, 1) * 100 : 0}%`, background: 'var(--ok)' }} />
                <span className="hatch" style={{ width: `${g2.confirmed > 0 ? (g2.pending / g2.confirmed) * 100 : 0}%` }} />
              </div>
              <div className="row between small"><span>Cobrado {formatMXN(g2.collected)}</span><span>Pendiente {formatMXN(g2.pending)}</span></div>
            </div>
          )
        })}
      </section>

      {showCash && (
        <section className="fcard" aria-labelledby="t7">
          <h2 id="t7">Flujo de caja</h2>
          <div className="stack" style={{ gap: 6 }}>
            <div className="row between"><span>＋ Cobros recibidos</span><span className="num">{formatMXN(m.collected)}</span></div>
            <div className="row between"><span>− Reembolsos</span><span className="num">{formatMXN(m.refunds)}</span></div>
            <div className="row between"><span>− Gastos operativos</span><span className="num">{formatMXN(m.expenses)}</span></div>
            <div className="row between"><span>− Compras de ingredientes</span><span className="num">{formatMXN(m.purchasesOut)}</span></div>
            <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%' }} />
            <div className="row between"><b>Flujo neto del periodo</b><b className="num" style={{ color: m.cashNet < 0 ? 'var(--bad)' : 'var(--ok)' }}>{m.cashNet < 0 ? '▼ ' : m.cashNet > 0 ? '▲ ' : ''}{formatMXN(m.cashNet)}</b></div>
          </div>
          <button className="btn small" onClick={() => setDrill('caja')}>Ver movimientos</button>
          <p className="small muted">Las compras de ingredientes salen de la caja cuando las pagas, pero su costo entra a la ganancia cuando vendes el producto: por eso no se restan dos veces en la ganancia.</p>
        </section>
      )}

      <details className="fcard">
        <summary><b>¿Cómo se calcula?</b></summary>
        <ul className="small" style={{ paddingLeft: 18, lineHeight: 1.6 }}>
          <li><b>Ventas:</b> pedidos confirmados (no cotizaciones ni cancelados) en la fecha en que se confirmaron: subtotal − descuento + envío. Un anticipo no es una venta: es un cobro parcial del mismo pedido.</li>
          <li><b>Costos de producción:</b> los costos congelados al confirmar + comisiones + ajustes de costo, en el mismo periodo que su venta. Cambiar una receta o el precio de un ingrediente no altera periodos pasados.</li>
          <li><b>Ganancia bruta</b> = ventas − costos. <b>Ganancia neta estimada</b> = bruta − gastos registrados con fecha en el periodo.</li>
          <li><b>Cobrado:</b> dinero recibido por fecha de pago, sin importar cuándo se vendió. Los reembolsos se restan.</li>
          <li><b>Por cobrar:</b> saldo actual de pedidos confirmados (no depende del periodo). <b>Anticipos:</b> cobros del periodo en pedidos aún no entregados.</li>
          <li><b>Pedidos cancelados</b> no cuentan como venta; si ya cobraste algo, sigue siendo caja hasta que registres el reembolso.</li>
          <li><b>Comparación:</b> con el periodo anterior de igual duración (mes actual vs. los mismos días del mes pasado).</li>
          <li><b>Límites:</b> no incluye impuestos ni gastos que no hayas registrado; por eso la ganancia neta es una estimación.</li>
        </ul>
      </details>

      {drill && <DrillSheet kind={drill} onClose={() => setDrill(null)} sold={saleOrdersIn(ctx, range, f)} mv={mv} rec={rec.orders} advances={mv.payments.filter((x) => x.p.amountCents > 0 && x.o.status !== 'entregado' && x.o.status !== 'cancelado')} onOrder={(o) => open({ k: 'order', v: o })} onExpense={(e) => open({ k: 'expense', v: e })} />}
    </div>
  )
}

function OrderLineItem({ o, right, sub, onClick }: { o: Order; right: string; sub?: string; onClick: () => void }) {
  return (
    <button className="item" onClick={onClick}>
      <div className="grow"><b>{o.customerName}</b> <span className="muted small">· {o.folio}</span><div className="small muted">{sub ?? `${STATUS_LABEL[o.status]} · ${PAYMENT_LABEL[paymentStatus(o)]}`}</div></div>
      <b className="num">{right}</b>
    </button>
  )
}

function DrillSheet({ kind, onClose, sold, mv, rec, advances, onOrder, onExpense }: {
  kind: Exclude<Drill, null>; onClose: () => void; sold: Order[]; mv: ReturnType<typeof movementsIn>; rec: Order[]
  advances: ReturnType<typeof movementsIn>['payments']; onOrder: (o: Order) => void; onExpense: (e: Data['expenses'][number]) => void
}) {
  const titles = { ventas: 'Pedidos que forman las ventas', cobrado: 'Cobros del periodo', gastos: 'Gastos del periodo', porcobrar: 'Saldos por cobrar', anticipos: 'Anticipos recibidos', caja: 'Movimientos de caja' }
  const none = <p className="muted small">No hay registros para mostrar.</p>
  return (
    <Sheet title={titles[kind]} onClose={onClose}>
      <div className="stack">
        {kind === 'ventas' && (sold.length ? sold.sort((a, b) => b.deliveryAt.localeCompare(a.deliveryAt)).map((o) => { const t = orderTotals(o); return <OrderLineItem key={o.id} o={o} right={formatMXN(t.totalCents)} sub={`Costo ${formatMXN(t.costCents + t.commissionCents + t.adjustmentsCents)} · ganancia ${formatMXN(t.profitCents)}`} onClick={() => onOrder(o)} /> }) : none)}
        {kind === 'porcobrar' && (rec.length ? rec.map((o) => <OrderLineItem key={o.id} o={o} right={formatMXN(orderTotals(o).balanceCents)} onClick={() => onOrder(o)} />) : none)}
        {kind === 'anticipos' && (advances.length ? advances.map(({ p, o }) => <OrderLineItem key={p.id} o={o} right={formatMXN(p.amountCents)} sub={`${p.date} · ${p.method}`} onClick={() => onOrder(o)} />) : none)}
        {(kind === 'cobrado' || kind === 'caja') && (mv.payments.length ? mv.payments.map(({ p, o }) => <OrderLineItem key={p.id} o={o} right={formatMXN(p.amountCents)} sub={`${p.date} · ${p.method}${p.amountCents < 0 ? ' · reembolso' : ''}`} onClick={() => onOrder(o)} />) : kind === 'cobrado' ? none : null)}
        {(kind === 'gastos' || kind === 'caja') && (mv.expenses.length ? mv.expenses.map((e) => <button key={e.id} className="item" onClick={() => onExpense(e)}><div className="grow">{e.concept}<div className="small muted">{e.date} · {e.category}</div></div><b className="num">−{formatMXN(e.amountCents)}</b></button>) : kind === 'gastos' ? none : null)}
        {kind === 'caja' && mv.purchases.map((p) => <div key={p.id} className="item" style={{ cursor: 'default' }}><div className="grow">Compra de ingrediente<div className="small muted">{p.date} · {p.qty} {p.unit}</div></div><b className="num">−{formatMXN(p.priceCents - p.discountCents + p.extraCents)}</b></div>)}
        {kind === 'caja' && !mv.payments.length && !mv.expenses.length && !mv.purchases.length && none}
      </div>
    </Sheet>
  )
}
