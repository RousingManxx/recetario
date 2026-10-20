import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { formatMXN, formatNum } from '../domain/money'
import type { Point } from '../domain/finance'

export const compactMXN = (cents: number): string => {
  const p = cents / 100, a = Math.abs(p), s = p < 0 ? '−' : ''
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)} M`
  if (a >= 1e4) return `${s}$${Math.round(a / 1e3)} k`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)} k`
  return `${s}$${Math.round(a)}`
}
const signed = (cents: number) => (cents > 0 ? '▲ +' : cents < 0 ? '▼ ' : '') + formatMXN(cents).replace('-', '−')

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(320)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth || 320)
    const ro = new ResizeObserver(() => setW(el.clientWidth || 320))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

function niceScale(min: number, max: number, ticks = 4) {
  if (max <= min) max = min + 1
  const raw = (max - min) / ticks, mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step
  const out: number[] = []
  for (let v = lo; v <= hi + step / 1000; v += step) out.push(v)
  return { lo, hi, ticks: out }
}

export function Legend({ items }: { items: { label: string; color: string; kind?: 'box' | 'hatch' | 'line' }[] }) {
  return (
    <div className="legend" aria-hidden="false">
      {items.map((i) => (
        <span key={i.label} className="legend-i">
          <svg width="22" height="12" aria-hidden="true">
            {i.kind === 'line' ? <><line x1="1" x2="21" y1="6" y2="6" stroke={i.color} strokeWidth="2.5" /><circle cx="11" cy="6" r="3.5" fill="var(--surface)" stroke={i.color} strokeWidth="2" /></>
              : i.kind === 'hatch' ? <><rect x="1" y="1" width="20" height="10" rx="2" fill="var(--surface)" stroke={i.color} strokeWidth="1.5" /><path d="M4 11l6-10M10 11l6-10M16 11l5-9" stroke={i.color} strokeWidth="1.5" /></>
              : <rect x="1" y="1" width="20" height="10" rx="2" fill={i.color} />}
          </svg>
          {i.label}
        </span>
      ))}
    </div>
  )
}

/** Navegación por puntero y teclado compartida por las gráficas de series. */
function useScrub(n: number, left: number, plotW: number) {
  const [sel, setSel] = useState<number | null>(null)
  const at = (clientX: number, el: Element) => {
    const x = clientX - el.getBoundingClientRect().left - left
    return Math.min(n - 1, Math.max(0, Math.floor((x / plotW) * n)))
  }
  const key = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); setSel((s) => Math.min(n - 1, (s ?? -1) + 1)) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); setSel((s) => Math.max(0, (s ?? n) - 1)) }
    else if (e.key === 'Escape') setSel(null)
  }
  const idx = sel !== null && sel < n ? sel : null
  return { sel: idx, setSel, at, key }
}

function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const w = 190
  const left = Math.min(Math.max(x - w / 2, 4), Math.max(width - w - 4, 4))
  return <div className="tip glass" style={{ left, width: w }} role="status">{children}</div>
}

/** Ventas y costos (barras; costos con trama) + ganancia bruta (línea con marcadores). */
export function TrendChart({ points, empty }: { points: Point[]; empty?: ReactNode }) {
  const [ref, W] = useWidth<HTMLDivElement>()
  const H = 250, L = 46, B = 26, T = 12, R = 8
  const n = points.length, pw = Math.max(W - L - R, 10), ph = H - T - B
  const { sel, setSel, at, key } = useScrub(n, L, pw)
  const all = points.flatMap((p) => [p.sales, p.cost, p.gross, 0])
  const sc = niceScale(Math.min(...all), Math.max(...all))
  const y = (v: number) => T + ph - ((v - sc.lo) / (sc.hi - sc.lo)) * ph
  const band = pw / Math.max(n, 1), bw = Math.min(band * 0.32, 20)
  const cx = (i: number) => L + band * (i + 0.5)
  const every = Math.max(1, Math.ceil(n / Math.max(Math.floor(pw / 64), 1)))
  const empt = points.every((p) => p.sales === 0 && p.cost === 0)
  if (empt) return <>{empty}</>
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${cx(i)},${y(p.gross)}`).join(' ')
  const p = sel !== null ? points[sel] : null
  return (
    <div ref={ref} className="chart" tabIndex={0} onKeyDown={key} role="group" aria-label="Gráfica de ventas, costos y ganancia bruta. Usa las flechas izquierda y derecha para explorar los valores.">
      <svg width={W} height={H} onPointerDown={(e) => setSel(at(e.clientX, e.currentTarget))} onPointerMove={(e) => e.pointerType === 'mouse' && setSel(at(e.clientX, e.currentTarget))} style={{ touchAction: 'pan-y' }}>
        <defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--surface)" /><line x1="0" y1="0" x2="0" y2="6" stroke="var(--ch-cost)" strokeWidth="3" /></pattern></defs>
        {sc.ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={t === 0 ? 1.5 : 1} /><text x={L - 6} y={y(t) + 4} textAnchor="end" className="ax">{compactMXN(t)}</text></g>)}
        {sel !== null && <rect x={L + band * sel} y={T} width={band} height={ph} fill="var(--accent-soft)" opacity=".55" />}
        {points.map((q, i) => (
          <g key={i}>
            <rect x={cx(i) - bw - 1} y={Math.min(y(q.sales), y(0))} width={bw} height={Math.abs(y(q.sales) - y(0))} rx="2" fill="var(--ch-sales)" />
            <rect x={cx(i) + 1} y={Math.min(y(q.cost), y(0))} width={bw} height={Math.abs(y(q.cost) - y(0))} rx="2" fill="url(#hatch)" stroke="var(--ch-cost)" strokeWidth="1.2" />
            {i % every === 0 && <text x={cx(i)} y={H - 7} textAnchor="middle" className="ax">{q.label}</text>}
          </g>
        ))}
        <path d={line} fill="none" stroke="var(--ch-profit)" strokeWidth="2.5" strokeLinejoin="round" />
        {points.map((q, i) => <circle key={i} cx={cx(i)} cy={y(q.gross)} r={sel === i ? 5.5 : 3.5} fill="var(--surface)" stroke="var(--ch-profit)" strokeWidth="2" />)}
      </svg>
      {p && sel !== null && (
        <Tooltip x={cx(sel)} width={W}>
          <b>{p.label}</b>
          <div className="tip-r"><span>Ventas</span><span className="num">{formatMXN(p.sales)}</span></div>
          <div className="tip-r"><span>Costos</span><span className="num">{formatMXN(p.cost)}</span></div>
          <div className="tip-r"><span>Ganancia bruta</span><span className="num">{signed(p.gross)}</span></div>
          <div className="tip-r"><span>Cobrado</span><span className="num">{formatMXN(p.collected)}</span></div>
        </Tooltip>
      )}
    </div>
  )
}

/** Margen % por punto; los periodos sin ventas se interrumpen (no se inventa un valor). */
export function MarginChart({ points, empty }: { points: Point[]; empty?: ReactNode }) {
  const [ref, W] = useWidth<HTMLDivElement>()
  const H = 200, L = 42, B = 26, T = 12, R = 10
  const n = points.length, pw = Math.max(W - L - R, 10), ph = H - T - B
  const { sel, setSel, at, key } = useScrub(n, L, pw)
  const vals = points.map((p) => p.marginPct).filter((v): v is number => v !== null)
  if (vals.length === 0) return <>{empty}</>
  const sc = niceScale(Math.min(0, ...vals), Math.max(...vals, 10), 4)
  const y = (v: number) => T + ph - ((v - sc.lo) / (sc.hi - sc.lo)) * ph
  const band = pw / Math.max(n, 1), cx = (i: number) => L + band * (i + 0.5)
  const every = Math.max(1, Math.ceil(n / Math.max(Math.floor(pw / 64), 1)))
  let d = '', pen = false
  points.forEach((p, i) => { if (p.marginPct === null) { pen = false; return } d += `${pen ? 'L' : 'M'}${cx(i)},${y(p.marginPct)} `; pen = true })
  const p = sel !== null ? points[sel] : null
  return (
    <div ref={ref} className="chart" tabIndex={0} onKeyDown={key} role="group" aria-label="Evolución del margen de beneficio. Usa las flechas para explorar.">
      <svg width={W} height={H} onPointerDown={(e) => setSel(at(e.clientX, e.currentTarget))} onPointerMove={(e) => e.pointerType === 'mouse' && setSel(at(e.clientX, e.currentTarget))} style={{ touchAction: 'pan-y' }}>
        {sc.ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={t === 0 ? 1.5 : 1} /><text x={L - 6} y={y(t) + 4} textAnchor="end" className="ax">{Math.round(t)} %</text></g>)}
        {sel !== null && <line x1={cx(sel)} x2={cx(sel)} y1={T} y2={T + ph} stroke="var(--text-2)" strokeDasharray="3 3" />}
        <path d={d} fill="none" stroke="var(--ch-sales)" strokeWidth="2.5" strokeLinejoin="round" />
        {points.map((q, i) => q.marginPct !== null && <circle key={i} cx={cx(i)} cy={y(q.marginPct)} r={sel === i ? 5.5 : 3.5} fill="var(--surface)" stroke="var(--ch-sales)" strokeWidth="2" />)}
        {points.map((q, i) => i % every === 0 && <text key={i} x={cx(i)} y={H - 7} textAnchor="middle" className="ax">{q.label}</text>)}
      </svg>
      {p && sel !== null && (
        <Tooltip x={cx(sel)} width={W}>
          <b>{p.label}</b>
          <div className="tip-r"><span>Margen</span><span className="num">{p.marginPct === null ? 'Sin ventas' : formatNum(p.marginPct) + ' %'}</span></div>
          <div className="tip-r"><span>Ventas</span><span className="num">{formatMXN(p.sales)}</span></div>
          <div className="tip-r"><span>Ganancia bruta</span><span className="num">{signed(p.gross)}</span></div>
        </Tooltip>
      )}
    </div>
  )
}

export const CAT_COLORS = ['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'var(--cat-4)', 'var(--cat-5)', 'var(--cat-6)', 'var(--cat-7)', 'var(--cat-8)']

export function Donut({ slices }: { slices: { key: string; label: string; cents: number; pct: number }[] }) {
  const [sel, setSel] = useState<number | null>(null)
  const R = 64, C = 2 * Math.PI * R
  let acc = 0
  const s = sel !== null ? slices[sel] : null
  const total = slices.reduce((a, x) => a + x.cents, 0)
  return (
    <div className="donut">
      <svg viewBox="0 0 180 180" width="180" height="180" role="img" aria-label={`Distribución de costos: ${slices.map((x) => `${x.label} ${formatNum(x.pct)} %`).join(', ')}`}>
        <g transform="rotate(-90 90 90)">
          {slices.map((x, i) => {
            const len = (x.pct / 100) * C, off = acc; acc += len
            return <circle key={x.key} cx="90" cy="90" r={R} fill="none" stroke={CAT_COLORS[i % 8]} strokeWidth={sel === i ? 30 : 24} strokeDasharray={`${Math.max(len - 1.5, 0)} ${C}`} strokeDashoffset={-off} opacity={sel === null || sel === i ? 1 : 0.35} style={{ cursor: 'pointer', transition: 'stroke-width .2s, opacity .2s' }} onClick={() => setSel(sel === i ? null : i)} />
          })}
        </g>
        <text x="90" y="86" textAnchor="middle" className="donut-v">{s ? formatNum(s.pct) + ' %' : compactMXN(total)}</text>
        <text x="90" y="104" textAnchor="middle" className="ax">{s ? compactMXN(s.cents) : 'costo total'}</text>
      </svg>
      <ul className="donut-l">
        {slices.map((x, i) => (
          <li key={x.key}>
            <button onClick={() => setSel(sel === i ? null : i)} aria-pressed={sel === i} className="row between" style={{ width: '100%', background: 'none', border: 0, padding: '6px 4px', cursor: 'pointer', textAlign: 'left', opacity: sel === null || sel === i ? 1 : 0.5 }}>
              <span className="row" style={{ gap: 8 }}><i className="sw" style={{ background: CAT_COLORS[i % 8] }} />{x.label}</span>
              <span className="num small"><b>{formatNum(x.pct)} %</b> · {formatMXN(x.cents)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export interface BarRow { id: string; label: string; sub?: string; value: number; display: string; badge?: string }
/** Barras horizontales; admite valores negativos (barra hacia la izquierda desde el eje). */
export function HBars({ rows, onSelect, color = 'var(--ch-sales)' }: { rows: BarRow[]; onSelect?: (id: string) => void; color?: string }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1)
  const neg = rows.some((r) => r.value < 0), pos = rows.some((r) => r.value > 0)
  const negW = neg ? (pos ? 40 : 100) : 0, posW = 100 - negW
  return (
    <div className="hbars">
      {rows.map((r) => {
        const w = (Math.abs(r.value) / max) * (r.value < 0 ? negW : posW)
        const body = (
          <>
            <div className="row between" style={{ gap: 8 }}><span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><b>{r.label}</b>{r.sub && <span className="small muted"> · {r.sub}</span>}</span><span className="num nowrap"><b>{r.display}</b></span></div>
            <div className="track" aria-hidden="true">
              <span className="fill" style={{ background: r.value < 0 ? 'var(--bad)' : color, width: `${Math.max(w, r.value === 0 ? 0 : 1.5)}%`, left: r.value < 0 ? `${negW - w}%` : `${negW}%` }} />
              {neg && <span className="axis" style={{ left: `${negW}%` }} />}
            </div>
          </>
        )
        return onSelect ? <button key={r.id} className="hb" onClick={() => onSelect(r.id)} aria-label={`${r.label}: ${r.display}. Ver detalle`}>{body}</button> : <div key={r.id} className="hb">{body}</div>
      })}
    </div>
  )
}
