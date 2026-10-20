import type { Snapshot } from './backup'
import { orderTotals, paymentStatus, STATUS_LABEL, PAYMENT_LABEL } from './orders'

const BOM = '﻿'

export function cell(v: unknown, sep: string): string {
  let s = v === null || v === undefined ? '' : String(v)
  // Evita inyección de fórmulas en Excel
  if (/^[=+\-@]/.test(s) && typeof v === 'string') s = "'" + s
  return s.includes(sep) || /["\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** UTF-8 con BOM (Excel muestra bien los acentos). Separador "," (México) o ";" (configuración regional europea). */
export function toCsv(headers: string[], rows: unknown[][], sep: ',' | ';' = ','): string {
  return BOM + [headers, ...rows].map((r) => r.map((c) => cell(c, sep)).join(sep)).join('\r\n') + '\r\n'
}

/** CSV de varias secciones: una sola cabecera BOM, filas de ancho libre. */
export function rowsToCsv(rows: unknown[][], sep: ',' | ';' = ','): string {
  return BOM + rows.map((r) => r.map((c) => cell(c, sep)).join(sep)).join('\r\n') + '\r\n'
}

const pesos = (c: number) => (c / 100).toFixed(2)

export function exportCsvs(s: Snapshot, sep: ',' | ';' = ','): Record<string, string> {
  const real = <T extends { demo?: boolean }>(a: T[]) => a.filter((x) => !x.demo)
  const ings = real(s.ingredients), recs = real(s.recipes), ords = real(s.orders)
  return {
    'ingredientes.csv': toCsv(
      ['id', 'nombre', 'categoria', 'proveedor', 'marca', 'dimension', 'costo_por_unidad_base_mxn', 'actualizado'],
      ings.map((i) => [i.id, i.name, i.category, i.supplier, i.brand, i.dimension, (i.costPerBase / 100).toFixed(4), i.priceUpdatedAt]), sep),
    'compras.csv': toCsv(
      ['id', 'ingrediente_id', 'fecha', 'cantidad', 'unidad', 'precio_mxn', 'descuento_mxn', 'extras_mxn'],
      real(s.purchases).map((p) => [p.id, p.ingredientId, p.date, p.qty, p.unit, pesos(p.priceCents), pesos(p.discountCents), pesos(p.extraCents)]), sep),
    'recetas.csv': toCsv(
      ['id', 'nombre', 'categoria', 'tipo', 'rinde', 'porciones_por_unidad', 'min_activos', 'min_horneado', 'min_reposo', 'merma_ingredientes_pct', 'merma_terminado_pct', 'margen_objetivo_pct', 'precio_mxn'],
      recs.map((r) => [r.id, r.name, r.category, r.kind, r.yieldQty, r.portionsPerUnit, r.activeMin, r.bakeMin, r.restMin, r.ingredientWastePct, r.finishedWastePct, r.targetMarginPct, r.priceCents == null ? '' : pesos(r.priceCents)]), sep),
    'recetas_ingredientes.csv': toCsv(
      ['receta_id', 'ingrediente_id', 'cantidad', 'unidad'],
      recs.flatMap((r) => r.components.map((c) => [r.id, c.ingredientId, c.qty, c.unit])), sep),
    'clientes.csv': toCsv(['id', 'nombre', 'telefono', 'correo', 'notas'],
      real(s.customers).map((c) => [c.id, c.name, c.phone, c.email, c.notes]), sep),
    'pedidos.csv': toCsv(
      ['id', 'folio', 'cliente_id', 'cliente', 'creado', 'entrega', 'estado', 'estado_pago', 'total_mxn', 'pagado_mxn', 'saldo_mxn', 'costo_mxn', 'ganancia_estimada_mxn'],
      ords.map((o) => { const t = orderTotals(o); return [o.id, o.folio, o.customerId, o.customerName, o.createdAt, o.deliveryAt, STATUS_LABEL[o.status], PAYMENT_LABEL[paymentStatus(o)], pesos(t.totalCents), pesos(t.paidCents), pesos(t.balanceCents), pesos(t.costCents), pesos(t.profitCents)] }), sep),
    'pedidos_lineas.csv': toCsv(
      ['pedido_id', 'folio', 'receta_id', 'producto', 'cantidad', 'precio_unitario_mxn', 'costo_unitario_mxn', 'personalizacion'],
      ords.flatMap((o) => o.lines.map((l) => [o.id, o.folio, l.recipeId, l.name, l.qty, pesos(l.unitPriceCents), pesos(l.unitCostCents), l.customization])), sep),
    'pagos.csv': toCsv(['pedido_id', 'folio', 'fecha', 'monto_mxn', 'metodo', 'nota'],
      ords.flatMap((o) => o.payments.map((p) => [o.id, o.folio, p.date, pesos(p.amountCents), p.method, p.note])), sep),
    'gastos.csv': toCsv(['id', 'fecha', 'concepto', 'categoria', 'monto_mxn', 'fijo'],
      real(s.expenses).map((e) => [e.id, e.date, e.concept, e.category, pesos(e.amountCents), e.fixed ? 'sí' : 'no']), sep),
  }
}
