// Estrategia: los importes se guardan en centavos enteros. Los costos unitarios de ingredientes son
// floats (centavos por g/ml/pza) y solo se redondean al calcular totales (costo de tanda, líneas
// de pedido, etc.) con redondeo half-up. Los totales ya redondeados se suman como enteros.
export const round = (n: number): number => Math.sign(n) * Math.round(Math.abs(n) + 1e-9)

export const pesosToCents = (p: number): number => round(p * 100)
export const centsToPesos = (c: number): number => c / 100

const fmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
export const formatMXN = (cents: number, suffix = false): string =>
  fmt.format(cents / 100) + (suffix ? ' MXN' : '')

const numFmt = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 })
export const formatNum = (n: number): string => numFmt.format(n)
export const formatPct = (n: number): string => numFmt.format(n) + ' %'

/** Parsea entradas del usuario: acepta "1,250.50", "1250,5" y "$180". Devuelve NaN si no es válido. */
export function parseNum(s: string): number {
  let t = s.replace(/[$\s%]/g, '')
  if (!t) return NaN
  if (t.includes(',') && t.includes('.')) t = t.replace(/,/g, '')
  else if (t.includes(',')) t = /^\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.')
  return /^-?\d*\.?\d+$/.test(t) ? Number(t) : NaN
}
