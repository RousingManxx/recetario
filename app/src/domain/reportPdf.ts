/**
 * PDF del reporte generado sin dependencias: texto Helvetica (WinAnsi) y gráficas vectoriales simples.
 * Se genera en el dispositivo y se descarga como archivo (no usa «Imprimir», poco fiable en PWAs de iOS).
 */
import { formatMXN, formatNum } from './money'
import { METHOD_NOTES, type Report } from './report'

type RGB = [number, number, number]
const C = {
  text: [0.243, 0.165, 0.133] as RGB, muted: [0.478, 0.384, 0.337] as RGB, line: [0.87, 0.82, 0.76] as RGB,
  sales: [0.725, 0.376, 0.42] as RGB, cost: [0.545, 0.42, 0.353] as RGB, profit: [0.247, 0.478, 0.278] as RGB, bad: [0.7, 0.27, 0.23] as RGB,
  warn: [0.66, 0.45, 0.12] as RGB, warnBg: [0.96, 0.9, 0.76] as RGB, head: [0.937, 0.894, 0.827] as RGB, white: [1, 1, 1] as RGB,
}
const PAL: RGB[] = [[0.725, 0.376, 0.42], [0.545, 0.42, 0.353], [0.82, 0.6, 0.27], [0.37, 0.56, 0.41], [0.43, 0.5, 0.69], [0.79, 0.56, 0.63], [0.61, 0.54, 0.47], [0.34, 0.4, 0.41]]

// Anchos Helvetica (AFM) para ASCII 32..126; negrita ≈ +6 %.
const W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]
const BASE: Record<string, string> = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n', Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U', Ü: 'U', Ñ: 'N' }

/** Mapea a WinAnsi (un byte por carácter). Lo no representable se sustituye por un equivalente simple. */
const SUBS: Record<string, string> = { '−': '-', '–': '–', '▲': '+', '▼': '-', '＝': '=', '⚠': '!', '’': '’', '“': '“', '”': '”' }
function winAnsi(s: string): number[] {
  const out: number[] = []
  for (const ch of s) {
    const c = SUBS[ch] ?? ch, code = c.codePointAt(0)!
    if (c === '–') out.push(0x96); else if (c === '—') out.push(0x97); else if (c === '•') out.push(0x95)
    else if (c === '’') out.push(0x92); else if (c === '“') out.push(0x93); else if (c === '”') out.push(0x94)
    else if (code >= 32 && code < 256) out.push(code)
    else out.push(63)
  }
  return out
}
function widthOf(s: string, size: number, bold: boolean): number {
  let w = 0
  for (const ch of s) { const b = BASE[ch] ?? ch; const i = b.charCodeAt(0) - 32; w += i >= 0 && i < W.length ? W[i] : 556 }
  return ((w * (bold ? 1.06 : 1)) / 1000) * size
}
const num = (n: number) => (Math.round(n * 100) / 100).toString()
const col = (c: RGB) => c.map((x) => num(x * 1000) === '0' ? '0' : (Math.round(x * 1000) / 1000).toString()).join(' ')

const PW = 595.28, PH = 841.89, M = 40

class Pdf {
  pages: string[][] = []
  y = 0
  private cur!: string[]
  constructor() { this.newPage() }
  newPage() { this.cur = []; this.pages.push(this.cur); this.y = M }
  ensure(h: number) { if (this.y + h > PH - M - 14) this.newPage() }
  /** y en coordenadas de arriba hacia abajo. */
  text(x: number, y: number, s: string, o: { size?: number; bold?: boolean; color?: RGB; align?: 'l' | 'r' | 'c' } = {}) {
    const size = o.size ?? 10, bold = !!o.bold
    const w = widthOf(s, size, bold)
    const px = o.align === 'r' ? x - w : o.align === 'c' ? x - w / 2 : x
    const hex = winAnsi(s).map((b) => b.toString(16).padStart(2, '0')).join('')
    this.cur.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${col(o.color ?? C.text)} rg ${num(px)} ${num(PH - y - size * 0.8)} Td <${hex}> Tj ET`)
  }
  rect(x: number, y: number, w: number, h: number, fill: RGB) {
    if (w <= 0 || h <= 0) return
    this.cur.push(`${col(fill)} rg ${num(x)} ${num(PH - y - h)} ${num(w)} ${num(h)} re f`)
  }
  line(x1: number, y1: number, x2: number, y2: number, c: RGB = C.line, w = 0.6) {
    this.cur.push(`${col(c)} RG ${w} w ${num(x1)} ${num(PH - y1)} m ${num(x2)} ${num(PH - y2)} l S`)
  }
  poly(pts: [number, number][], c: RGB, w = 1.6) {
    if (pts.length < 2) return
    this.cur.push(`${col(c)} RG ${w} w ` + pts.map(([x, y], i) => `${num(x)} ${num(PH - y)} ${i ? 'l' : 'm'}`).join(' ') + ' S')
  }
  hatch(x: number, y: number, w: number, h: number, c: RGB) {
    if (w <= 0 || h <= 0) return
    this.cur.push(`q ${num(x)} ${num(PH - y - h)} ${num(w)} ${num(h)} re W n ${col(c)} RG 0.8 w`)
    for (let d = -h; d < w; d += 3.5) this.cur.push(`${num(x + d)} ${num(PH - y - h)} m ${num(x + d + h)} ${num(PH - y)} l S`)
    this.cur.push('Q')
  }
  wrap(s: string, width: number, size: number, bold = false): string[] {
    const out: string[] = []; let line = ''
    for (const word of s.split(/\s+/)) {
      const t = line ? line + ' ' + word : word
      if (widthOf(t, size, bold) <= width || !line) line = t; else { out.push(line); line = word }
    }
    if (line) out.push(line)
    return out
  }
  paragraph(s: string, o: { size?: number; color?: RGB; bold?: boolean; x?: number; width?: number; gap?: number } = {}) {
    const size = o.size ?? 9, lh = size * 1.35, x = o.x ?? M, width = o.width ?? PW - 2 * M
    for (const l of this.wrap(s, width, size, o.bold)) { this.ensure(lh); this.text(x, this.y, l, { size, color: o.color, bold: o.bold }); this.y += lh }
    this.y += o.gap ?? 0
  }
  heading(s: string) { this.ensure(40); this.y += 8; this.text(M, this.y, s, { size: 13, bold: true }); this.y += 17; this.line(M, this.y, PW - M, this.y); this.y += 8 }

  build(footer: string): Uint8Array {
    const objs: string[] = []
    const add = (s: string) => { objs.push(s); return objs.length }
    add('<< /Type /Catalog /Pages 2 0 R >>')
    add('') // 2: Pages (se completa después)
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>') // 3
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>') // 4
    const kids: number[] = []
    this.pages.forEach((ops, i) => {
      const all = [...ops, `BT /F1 8 Tf ${col(C.muted)} rg ${num(M)} 24 Td <${winAnsi(footer).map((b) => b.toString(16).padStart(2, '0')).join('')}> Tj ET`,
        `BT /F1 8 Tf ${col(C.muted)} rg ${num(PW - M - 40)} 24 Td <${winAnsi(`Página ${i + 1} de ${this.pages.length}`).map((b) => b.toString(16).padStart(2, '0')).join('')}> Tj ET`]
      const content = all.join('\n')
      const cid = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
      kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PW)} ${num(PH)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${cid} 0 R >>`))
    })
    objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
    let out = '%PDF-1.4\n'
    const offs: number[] = []
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
    const xref = out.length
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    // El contenido ya es ASCII (cadenas en hexadecimal), así que 1 carácter = 1 byte.
    const bytes = new Uint8Array(out.length)
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff
    return bytes
  }
}

const money = (c: number) => formatMXN(c)
const signedMoney = (c: number) => (c > 0 ? '+' : c < 0 ? '-' : '') + formatMXN(Math.abs(c))
const compact = (cents: number) => { const p = cents / 100, a = Math.abs(p), s = p < 0 ? '-' : ''; return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(1)} M` : a >= 1e4 ? `${s}$${Math.round(a / 1e3)} k` : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(1)} k` : `${s}$${Math.round(a)}` }
const fmtD = (s: string) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}` }

export function reportPdf(r: Report): Uint8Array {
  const p = new Pdf(), m = r.meta, W2 = PW - 2 * M

  // Encabezado
  p.rect(0, 0, PW, 6, C.sales)
  p.y = 26
  p.text(M, p.y, m.business, { size: 20, bold: true }); p.y += 26
  p.text(M, p.y, 'Reporte financiero', { size: 13, color: C.muted }); p.y += 20
  p.text(M, p.y, `Periodo: ${fmtD(m.from)} al ${fmtD(m.to)} (${m.days} día${m.days === 1 ? '' : 's'})   ·   Comparado con ${fmtD(m.prevFrom)} al ${fmtD(m.prevTo)}`, { size: 9 }); p.y += 13
  p.text(M, p.y, `Pedidos: ${m.statusLabel}   ·   Categoría: ${m.category}   ·   Producto: ${m.product}   ·   Moneda: MXN`, { size: 9 }); p.y += 13
  p.text(M, p.y, `Generado: ${new Date(m.generatedAt).toLocaleString('es-MX')}`, { size: 9, color: C.muted }); p.y += 16
  if (m.demo) { p.rect(M, p.y, W2, 18, C.warnBg); p.text(M + 8, p.y + 4, 'Incluye datos de demostración.', { size: 9, color: C.warn, bold: true }); p.y += 26 }
  for (const w of r.warnings) {
    const lines = p.wrap('Aviso: ' + w, W2 - 16, 9)
    p.ensure(lines.length * 12 + 10); p.rect(M, p.y, W2, lines.length * 12 + 8, C.warnBg)
    lines.forEach((l, i) => p.text(M + 8, p.y + 4 + i * 12, l, { size: 9, color: C.warn })); p.y += lines.length * 12 + 14
  }

  // Resumen
  p.heading('Resumen')
  const cx = [M, M + 215, M + 330, M + 440]
  p.rect(M, p.y - 2, W2, 18, C.head)
  ;['Indicador', 'Periodo', 'Anterior', 'Variación'].forEach((h, i) => p.text(i === 3 ? PW - M - 4 : i ? cx[i] + 80 : cx[i] + 6, p.y + 2, h, { size: 9, bold: true, align: i ? 'r' : 'l' }))
  p.y += 20
  for (const k of r.kpis) {
    p.ensure(18)
    const fmt = (v: number | null) => (v === null ? '—' : k.kind === 'pct' ? formatNum(v) + ' %' : money(v))
    const dv = k.abs === null ? '' : k.kind === 'pct' ? `${k.abs > 0 ? '+' : ''}${formatNum(k.abs)} pts` : `${signedMoney(k.abs)}${k.pct != null ? ` (${k.pct > 0 ? '+' : ''}${formatNum(k.pct)} %)` : ''}`
    p.text(cx[0] + 6, p.y, k.label, { size: 9.5 })
    p.text(cx[1] + 80, p.y, fmt(k.value), { size: 9.5, bold: true, align: 'r' })
    p.text(cx[2] + 80, p.y, fmt(k.prev), { size: 9.5, color: C.muted, align: 'r' })
    p.text(PW - M - 4, p.y, dv, { size: 8.5, color: k.abs === null ? C.muted : C.text, align: 'r' })
    p.line(M, p.y + 14, PW - M, p.y + 14); p.y += 17
  }
  p.paragraph('Variación = periodo − periodo anterior. Ganancia neta estimada = ganancia bruta − gastos registrados.', { size: 8, color: C.muted, gap: 4 })

  // Serie
  p.heading(`Ventas, costos y ganancia por ${m.granularity === 'dia' ? 'día' : m.granularity}`)
  if (r.series.every((s) => s.sales === 0 && s.cost === 0)) p.paragraph('Sin ventas confirmadas en este periodo.', { color: C.muted })
  else {
    const H = 150, L = 44, T = 8, n = r.series.length, pw = W2 - L - 4
    p.ensure(H + 50)
    const all = r.series.flatMap((s) => [s.sales, s.cost, s.gross, 0])
    let lo = Math.min(...all), hi = Math.max(...all); if (hi <= lo) hi = lo + 1
    const raw = (hi - lo) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 2.5, 5, 10].map((x) => x * mag).find((x) => x >= raw) ?? raw
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step
    const Y = (v: number) => p.y + T + H - ((v - lo) / (hi - lo)) * H
    for (let t = lo; t <= hi + step / 1000; t += step) { p.line(M + L, Y(t), PW - M, Y(t), C.line, t === 0 ? 1 : 0.4); p.text(M + L - 4, Y(t) - 4, compact(t), { size: 7.5, color: C.muted, align: 'r' }) }
    const band = pw / n, bw = Math.min(band * 0.34, 14), X = (i: number) => M + L + band * (i + 0.5)
    r.series.forEach((s, i) => {
      const y0 = Y(0)
      p.rect(X(i) - bw - 0.5, Math.min(Y(s.sales), y0), bw, Math.abs(Y(s.sales) - y0), C.sales)
      p.hatch(X(i) + 0.5, Math.min(Y(s.cost), y0), bw, Math.abs(Y(s.cost) - y0), C.cost)
    })
    p.poly(r.series.map((s, i) => [X(i), Y(s.gross)]), C.profit)
    const every = Math.max(1, Math.ceil(n / Math.floor(pw / 46)))
    r.series.forEach((s, i) => { if (i % every === 0) p.text(X(i), p.y + T + H + 5, `${String(s.start.getDate()).padStart(2, '0')}/${String(s.start.getMonth() + 1).padStart(2, '0')}`, { size: 7.5, color: C.muted, align: 'c' }) })
    p.y += T + H + 20
    p.rect(M + L, p.y + 1, 9, 7, C.sales); p.text(M + L + 13, p.y, 'Ventas', { size: 8 })
    p.hatch(M + L + 60, p.y + 1, 9, 7, C.cost); p.text(M + L + 73, p.y, 'Costos', { size: 8 })
    p.line(M + L + 120, p.y + 4.5, M + L + 134, p.y + 4.5, C.profit, 1.6); p.text(M + L + 138, p.y, 'Ganancia bruta', { size: 8 }); p.y += 16
    if (n <= 31) {
      const tx = [M + 6, M + 150, M + 240, M + 330, M + 420]
      p.ensure(30); p.rect(M, p.y - 2, W2, 16, C.head)
      ;['Fecha', 'Ventas', 'Costos', 'Ganancia', 'Cobrado'].forEach((h, i) => p.text(i ? tx[i] + 60 : tx[i], p.y + 1, h, { size: 8.5, bold: true, align: i ? 'r' : 'l' })); p.y += 17
      for (const s of r.series) {
        p.ensure(14)
        p.text(tx[0], p.y, s.label, { size: 8.5 }); p.text(tx[1] + 60, p.y, money(s.sales), { size: 8.5, align: 'r' }); p.text(tx[2] + 60, p.y, money(s.cost), { size: 8.5, align: 'r' })
        p.text(tx[3] + 60, p.y, money(s.gross), { size: 8.5, align: 'r' }); p.text(tx[4] + 60, p.y, r.productFiltered ? '—' : money(s.collected), { size: 8.5, align: 'r' }); p.y += 12.5
      }
    }
  }

  // Distribución de costos
  p.heading('Distribución de costos')
  if (r.dist.length === 0) p.paragraph('Sin costos en este periodo.', { color: C.muted })
  r.dist.forEach((d, i) => {
    p.ensure(24)
    p.rect(M, p.y + 1, 9, 9, PAL[i % 8]); p.text(M + 14, p.y, d.label, { size: 9.5 })
    p.text(PW - M, p.y, `${formatNum(d.pct)} %  ·  ${money(d.cents)}`, { size: 9.5, bold: true, align: 'r' })
    p.rect(M, p.y + 14, W2, 5, C.head); p.rect(M, p.y + 14, (W2 * d.pct) / 100, 5, PAL[i % 8]); p.y += 25
  })

  // Rentabilidad por receta
  p.heading('Rentabilidad por receta')
  if (r.products.length === 0) p.paragraph('Sin ventas por producto en este periodo.', { color: C.muted })
  else {
    const rx = [M + 6, M + 215, M + 280, M + 350, M + 420, PW - M - 2]
    p.rect(M, p.y - 2, W2, 16, C.head)
    ;['Producto', 'Unid.', 'Ventas', 'Costos', 'Ganancia', 'Margen'].forEach((h, i) => p.text(i ? (i === 5 ? rx[5] : rx[i] + 55) : rx[0], p.y + 1, h, { size: 8.5, bold: true, align: i ? 'r' : 'l' })); p.y += 17
    for (const x of r.products) {
      p.ensure(15)
      p.text(rx[0], p.y, p.wrap(x.name, 195, 9)[0], { size: 9 }); p.text(rx[1] + 55 - 20, p.y, formatNum(x.units), { size: 9, align: 'r' })
      p.text(rx[2] + 55, p.y, money(x.revenue), { size: 9, align: 'r' }); p.text(rx[3] + 55, p.y, money(x.cost), { size: 9, align: 'r' })
      p.text(rx[4] + 55, p.y, money(x.profit), { size: 9, bold: true, color: x.profit < 0 ? C.bad : C.profit, align: 'r' }); p.text(rx[5], p.y, x.marginPct == null ? '—' : formatNum(x.marginPct) + ' %', { size: 9, align: 'r' })
      p.line(M, p.y + 12, PW - M, p.y + 12); p.y += 14.5
    }
    p.y += 2; p.paragraph(`Más rentable: ${r.products[0].name}  ·  Menos rentable: ${r.products[r.products.length - 1].name}. Con los costos congelados en cada pedido.`, { size: 8, color: C.muted })
  }

  // Pedidos y cobros / flujo de caja
  p.heading('Pedidos y cobros')
  ;([['Entregados', r.oc.delivered], ['Por entregar', r.oc.future]] as const).forEach(([t, g]) => {
    p.ensure(36)
    p.text(M, p.y, `${t} (${g.count})`, { size: 9.5, bold: true }); p.text(PW - M, p.y, money(g.confirmed), { size: 9.5, bold: true, align: 'r' })
    p.rect(M, p.y + 14, W2, 7, C.head); p.rect(M, p.y + 14, g.confirmed > 0 ? Math.min(g.collected / g.confirmed, 1) * W2 : 0, 7, C.profit)
    p.text(M, p.y + 24, `Cobrado ${money(g.collected)}`, { size: 8.5 }); p.text(PW - M, p.y + 24, `Pendiente ${money(g.pending)}`, { size: 8.5, align: 'r' }); p.y += 42
  })
  p.text(M, p.y, `Por cobrar a hoy: ${money(r.receivable.total)}  (entregado ${money(r.receivable.delivered)} · por entregar ${money(r.receivable.future)})`, { size: 9 }); p.y += 14
  if (!r.productFiltered) {
    p.heading('Flujo de caja')
    const mt = r.metrics
    for (const [l, v, b] of [['Cobros recibidos', mt.collected, false], ['Reembolsos', -mt.refunds, false], ['Gastos operativos', -mt.expenses, false], ['Compras de ingredientes', -mt.purchasesOut, false], ['Flujo neto del periodo', mt.cashNet, true]] as const) {
      p.ensure(16); p.text(M + 6, p.y, l, { size: 9.5, bold: b }); p.text(PW - M, p.y, signedMoney(v), { size: 9.5, bold: b, align: 'r', color: b && v < 0 ? C.bad : C.text }); p.y += 15
    }
  }

  // Detalle
  if (r.detail) {
    const table = (title: string, heads: string[], xs: number[], rows: string[][], right: number[]) => {
      p.heading(title)
      if (!rows.length) { p.paragraph('Sin registros.', { color: C.muted }); return }
      p.ensure(30); p.rect(M, p.y - 2, W2, 15, C.head)
      heads.forEach((h, i) => p.text(right.includes(i) ? xs[i + 1] - 4 : xs[i] + 4, p.y + 1, h, { size: 8, bold: true, align: right.includes(i) ? 'r' : 'l' })); p.y += 16
      for (const row of rows) {
        if (p.y + 14 > PH - M - 14) { p.newPage(); p.rect(M, p.y - 2, W2, 15, C.head); heads.forEach((h, i) => p.text(right.includes(i) ? xs[i + 1] - 4 : xs[i] + 4, p.y + 1, h, { size: 8, bold: true, align: right.includes(i) ? 'r' : 'l' })); p.y += 16 }
        row.forEach((c, i) => p.text(right.includes(i) ? xs[i + 1] - 4 : xs[i] + 4, p.y, p.wrap(c, xs[i + 1] - xs[i] - 8, 8)[0] ?? '', { size: 8, align: right.includes(i) ? 'r' : 'l' }))
        p.line(M, p.y + 11, PW - M, p.y + 11, C.line, 0.3); p.y += 13
      }
    }
    const d = r.detail, R = PW - M
    table('Detalle: pedidos del periodo', ['Folio', 'Cliente', 'Confirmado', 'Pago', 'Total', 'Ganancia', 'Saldo'], [M, M + 55, M + 160, M + 225, M + 330, M + 405, M + 470, R], d.orders.map((o) => [o.folio, o.customer, fmtD(o.confirmedAt), o.payStatus, money(o.total), money(o.profit), money(o.balance)]), [4, 5, 6])
    if (!r.productFiltered) {
      table('Detalle: cobros y reembolsos', ['Fecha', 'Folio', 'Cliente', 'Método', 'Importe'], [M, M + 70, M + 135, M + 330, M + 420, R], d.payments.map((x) => [fmtD(x.date), x.folio, x.customer, x.method, signedMoney(x.amount)]), [4])
      table('Detalle: gastos', ['Fecha', 'Concepto', 'Categoría', 'Importe'], [M, M + 70, M + 300, M + 420, R], d.expenses.map((x) => [fmtD(x.date), x.concept, x.category, money(x.amount)]), [3])
      table('Detalle: compras de ingredientes', ['Fecha', 'Cantidad', 'Importe'], [M, M + 70, M + 300, R], d.purchases.map((x) => [fmtD(x.date), `${formatNum(x.qty)} ${x.unit}`, money(x.amount)]), [2])
    }
  }

  p.heading('Criterios de cálculo')
  for (const n of METHOD_NOTES) p.paragraph('• ' + n, { size: 8.5, color: C.muted, gap: 3 })
  return p.build(`${m.business} · Reporte financiero ${fmtD(m.from)} al ${fmtD(m.to)}`)
}
