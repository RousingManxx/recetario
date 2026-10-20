/** Reporte financiero exportable: una sola estructura de datos para CSV y PDF (mismas cifras que la pantalla). */
import {
  buildSeries, computeMetrics, costDistribution, dataWarnings, delta, hasLineFilter, movementsIn, orderMatches, ordersAndCollections,
  productRows, receivables, resolveRange, saleOrdersIn, type Ctx, type Filters, type Granularity, type Metrics, type Point,
} from './finance'
import { orderTotals, PAYMENT_LABEL, paymentStatus, STATUS_LABEL } from './orders'
import { rowsToCsv } from './csv'

export interface ReportInput {
  ctx: Ctx
  from: string // YYYY-MM-DD (inclusive)
  to: string   // YYYY-MM-DD (inclusive)
  filters: Filters
  granularity: Granularity | 'auto'
  businessName: string
  includeDetail: boolean
  now?: Date
}

export interface Kpi { label: string; kind: 'money' | 'pct'; value: number | null; prev: number | null; abs: number | null; pct: number | null; note?: string }

export interface Report {
  meta: { business: string; generatedAt: string; from: string; to: string; prevFrom: string; prevTo: string; days: number; granularity: Granularity; statusLabel: string; category: string; product: string; demo: boolean }
  productFiltered: boolean
  kpis: Kpi[]
  metrics: Metrics
  series: Point[]
  dist: ReturnType<typeof costDistribution>
  products: ReturnType<typeof productRows>
  oc: ReturnType<typeof ordersAndCollections>
  receivable: { total: number; delivered: number; future: number }
  warnings: string[]
  detail?: {
    orders: { folio: string; customer: string; confirmedAt: string; status: string; payStatus: string; total: number; cost: number; profit: number; paid: number; balance: number }[]
    payments: { date: string; folio: string; customer: string; amount: number; method: string }[]
    expenses: { date: string; concept: string; category: string; amount: number }[]
    purchases: { date: string; qty: number; unit: string; amount: number }[]
  }
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const STATUS_GROUP_LABEL = { todos: 'Todos los confirmados', por_entregar: 'Por entregar', entregados: 'Entregados' } as const
const GRAN_LABEL = { dia: 'Día', semana: 'Semana', mes: 'Mes' } as const

export function defaultGran(days: number): Granularity { return days <= 31 ? 'dia' : days <= 120 ? 'semana' : 'mes' }

export function buildReport(inp: ReportInput): Report {
  const now = inp.now ?? new Date()
  const { range, prev, days } = resolveRange('custom', now, { from: inp.from, to: inp.to })
  const f = inp.filters, c = inp.ctx
  const g: Granularity = inp.granularity === 'auto' ? defaultGran(days) : inp.granularity
  const m = computeMetrics(c, range, f), pm = computeMetrics(c, prev, f)
  const filtered = hasLineFilter(f)
  const rec = receivables(c, f)
  const k = (label: string, cur: number | null, p: number | null, kind: Kpi['kind'] = 'money', note?: string): Kpi => {
    if (cur === null) return { label, kind, value: null, prev: p, abs: null, pct: null, note }
    const d = p === null ? null : delta(cur, p)
    return { label, kind, value: cur, prev: p, abs: d?.abs ?? null, pct: kind === 'money' ? d?.pct ?? null : null, note }
  }
  const kpis: Kpi[] = [
    k('Ingresos por ventas', m.sales, pm.sales),
    k('Costos de producción', m.cost, pm.cost),
    k('Ganancia bruta', m.gross, pm.gross),
    k('Margen de beneficio (%)', m.marginPct, pm.marginPct, 'pct'),
  ]
  if (!filtered) kpis.push(
    k('Gastos operativos', m.expenses, pm.expenses),
    k('Ganancia neta estimada', m.net, pm.net, 'money', 'Bruta − gastos registrados; estimación, no contabilidad'),
    k('Cobrado (neto de reembolsos)', m.collected - m.refunds, pm.collected - pm.refunds),
    k('Anticipos recibidos', m.advances, pm.advances, 'money', 'Cobros del periodo en pedidos sin entregar'),
    k('Por cobrar (saldo a hoy)', rec.total, null, 'money', 'No depende del periodo'),
  )
  const mv = movementsIn(c, range, f)
  const sold = saleOrdersIn(c, range, f).filter((o) => orderMatches(o, c, f))
  const detail: Report['detail'] = inp.includeDetail ? {
    orders: sold.sort((a, b) => (a.confirmedAt ?? a.createdAt).localeCompare(b.confirmedAt ?? b.createdAt)).map((o) => {
      const t = orderTotals(o)
      return { folio: o.folio, customer: o.customerName, confirmedAt: (o.confirmedAt ?? o.createdAt).slice(0, 10), status: STATUS_LABEL[o.status], payStatus: PAYMENT_LABEL[paymentStatus(o)], total: t.totalCents, cost: t.costCents + t.commissionCents + t.adjustmentsCents, profit: t.profitCents, paid: t.paidCents, balance: t.balanceCents }
    }),
    payments: filtered ? [] : mv.payments.map(({ p, o }) => ({ date: p.date, folio: o.folio, customer: o.customerName, amount: p.amountCents, method: p.method })),
    expenses: filtered ? [] : mv.expenses.map((e) => ({ date: e.date, concept: e.concept, category: e.category, amount: e.amountCents })),
    purchases: filtered ? [] : mv.purchases.map((p) => ({ date: p.date, qty: p.qty, unit: p.unit, amount: p.priceCents - p.discountCents + p.extraCents })),
  } : undefined
  return {
    meta: {
      business: inp.businessName || 'Mi pastelería', generatedAt: now.toISOString(), from: ymd(range.from), to: ymd(new Date(range.to.getTime() - 1)),
      prevFrom: ymd(prev.from), prevTo: ymd(new Date(prev.to.getTime() - 1)), days, granularity: g,
      statusLabel: STATUS_GROUP_LABEL[f.status], category: f.category || 'Todas', product: f.recipeId ? c.recipes.find((r) => r.id === f.recipeId)?.name ?? '(receta eliminada)' : 'Todos',
      demo: c.orders.some((o) => o.demo) || c.expenses.some((e) => e.demo),
    },
    productFiltered: filtered, kpis, metrics: m, series: buildSeries(c, range, g, f), dist: costDistribution(c, range, f),
    products: productRows(c, range, f).sort((a, b) => b.profit - a.profit), oc: ordersAndCollections(c, range, f),
    receivable: { total: rec.total, delivered: rec.delivered, future: rec.future }, warnings: dataWarnings(c, range, f, m), detail,
  }
}

export const METHOD_NOTES = [
  'Venta: pedido confirmado (no cotización ni cancelado), en la fecha de confirmación; subtotal − descuento + envío. Un anticipo no es una venta: es un cobro parcial del mismo pedido.',
  'Costo: costos congelados al confirmar + comisiones + ajustes, en el mismo periodo que su venta. Cambios posteriores en recetas o ingredientes no alteran periodos pasados.',
  'Ganancia bruta = ventas − costos. Ganancia neta estimada = bruta − gastos registrados con fecha en el periodo. Margen = bruta ÷ ventas.',
  'Cobrado: pagos por fecha de pago, menos reembolsos. Por cobrar: saldo vigente a la fecha de generación del reporte.',
  'Flujo de caja = cobros − reembolsos − gastos − compras de ingredientes (las compras no entran a la ganancia: su costo se reconoce al vender).',
  'No incluye impuestos ni gastos no registrados: la ganancia neta es una estimación, no un resultado contable.',
]

export const pesos = (c: number) => (c / 100).toFixed(2)
const pct = (n: number | null) => (n === null ? '' : n.toFixed(2))

/** CSV de una sola hoja con secciones separadas por una fila en blanco. Importes en MXN con 2 decimales. */
export function reportCsv(r: Report, sep: ',' | ';' = ','): string {
  const rows: unknown[][] = []
  const section = (title: string, headers: string[], body: unknown[][]) => { rows.push([title], headers, ...body, []) }
  const m = r.meta, mt = r.metrics
  rows.push(['REPORTE FINANCIERO'], ['Negocio', m.business], ['Periodo', `${m.from} a ${m.to}`, `${m.days} día(s)`], ['Periodo de comparación', `${m.prevFrom} a ${m.prevTo}`],
    ['Pedidos', m.statusLabel], ['Categoría', m.category], ['Producto', m.product], ['Agrupación', GRAN_LABEL[m.granularity]], ['Generado', m.generatedAt], ['Moneda', 'MXN'],
    ...(m.demo ? [['Aviso', 'Incluye datos de demostración']] : []), [])
  if (r.warnings.length) section('ADVERTENCIAS', ['Detalle'], r.warnings.map((w) => [w]))
  section('RESUMEN', ['Indicador', 'Periodo', 'Periodo anterior', 'Variación', 'Variación %', 'Nota'],
    r.kpis.map((x) => [x.label, x.kind === 'pct' ? pct(x.value) : x.value === null ? '' : pesos(x.value), x.kind === 'pct' ? pct(x.prev) : x.prev === null ? '' : pesos(x.prev), x.abs === null ? '' : x.kind === 'pct' ? pct(x.abs) + ' pts' : pesos(x.abs), pct(x.pct), x.note ?? '']))
  section(`SERIE POR ${GRAN_LABEL[m.granularity].toUpperCase()}`, ['Inicio', 'Ventas', 'Costos', 'Ganancia bruta', 'Margen %', 'Cobrado'],
    r.series.map((p) => [ymd(p.start), pesos(p.sales), pesos(p.cost), pesos(p.gross), pct(p.marginPct), r.productFiltered ? '' : pesos(p.collected)]))
  section('DISTRIBUCIÓN DE COSTOS', ['Concepto', 'Importe', '% del costo'], r.dist.map((d) => [d.label, pesos(d.cents), pct(d.pct)]))
  section('RENTABILIDAD POR RECETA', ['Producto', 'Categoría', 'Unidades', 'Ventas', 'Costos', 'Ganancia', 'Margen %'],
    r.products.map((p) => [p.name, p.category, p.units, pesos(p.revenue), pesos(p.cost), pesos(p.profit), pct(p.marginPct)]))
  section('PEDIDOS Y COBROS', ['Grupo', 'Pedidos', 'Confirmado', 'Cobrado', 'Pendiente'], [
    ['Entregados', r.oc.delivered.count, pesos(r.oc.delivered.confirmed), pesos(r.oc.delivered.collected), pesos(r.oc.delivered.pending)],
    ['Por entregar', r.oc.future.count, pesos(r.oc.future.confirmed), pesos(r.oc.future.collected), pesos(r.oc.future.pending)]])
  if (!r.productFiltered) section('FLUJO DE CAJA', ['Concepto', 'Importe'], [
    ['Cobros recibidos', pesos(mt.collected)], ['Reembolsos', pesos(-mt.refunds)], ['Gastos operativos', pesos(-mt.expenses)], ['Gastos ya cobrados en recetas', pesos(-mt.expensesCovered)], ['Compras de ingredientes', pesos(-mt.purchasesOut)], ['Flujo neto', pesos(mt.cashNet)]])
  if (r.detail) {
    section('DETALLE: PEDIDOS DEL PERIODO', ['Folio', 'Cliente', 'Confirmado', 'Estado', 'Estado de pago', 'Total', 'Costo', 'Ganancia', 'Cobrado', 'Saldo'],
      r.detail.orders.map((o) => [o.folio, o.customer, o.confirmedAt, o.status, o.payStatus, pesos(o.total), pesos(o.cost), pesos(o.profit), pesos(o.paid), pesos(o.balance)]))
    if (!r.productFiltered) {
      section('DETALLE: COBROS Y REEMBOLSOS', ['Fecha', 'Folio', 'Cliente', 'Importe', 'Método'], r.detail.payments.map((p) => [p.date, p.folio, p.customer, pesos(p.amount), p.method]))
      section('DETALLE: GASTOS', ['Fecha', 'Concepto', 'Categoría', 'Importe'], r.detail.expenses.map((e) => [e.date, e.concept, e.category, pesos(e.amount)]))
      section('DETALLE: COMPRAS DE INGREDIENTES', ['Fecha', 'Cantidad', 'Unidad', 'Importe'], r.detail.purchases.map((p) => [p.date, p.qty, p.unit, pesos(p.amount)]))
    }
  }
  section('CRITERIOS DE CÁLCULO', ['Nota'], METHOD_NOTES.map((n) => [n]))
  rows.pop() // fila en blanco final
  return rowsToCsv(rows, sep)
}

export const reportFileName = (r: Report, ext: 'csv' | 'pdf') => `reporte-finanzas_${r.meta.from}_a_${r.meta.to}.${ext}`
