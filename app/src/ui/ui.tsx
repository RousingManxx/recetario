import { createContext, useContext, useEffect, useId, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { parseNum } from '../domain/money'

const P: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  home: 'M4 11l8-7 8 7v8a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z',
  cake: 'M4 20h16M5 20v-6a2 2 0 012-2h10a2 2 0 012 2v6M12 12V8M12 8c-1-1-1-2 0-3 1 1 1 2 0 3zM5 16c2 1.5 4-1.5 7 0s5-1.5 7 0',
  jar: 'M8 3h8M7 6h10v13a2 2 0 01-2 2H9a2 2 0 01-2-2zM7 11h10',
  bag: 'M6 8h12l1 12H5zM9 8V6a3 3 0 016 0v2',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-3-2 .6a7 7 0 00-1.6-.9L15 6h-4l-.4 1.7a7 7 0 00-1.6.9L7 8l-2 3 2 1a7 7 0 000 1.8L5 15l2 3 2-.6a7 7 0 001.6.9L11 20h4l.4-1.7a7 7 0 001.6-.9l2 .6 2-3-2-1a7 7 0 000-1.8z',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  coin: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v10M9.5 9.5c0-1 1-1.5 2.5-1.5s2.5.6 2.5 1.7-1 1.4-2.5 1.8-2.5.8-2.5 1.8 1 1.7 2.5 1.7 2.5-.5 2.5-1.5',
  star: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  check: 'M5 12l5 5 9-10',
  down: 'M12 4v12M7 11l5 5 5-5M5 20h14',
  up: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  chart: 'M4 20V4M4 20h16M8 16l4-5 3 3 5-7',
  tool: 'M14.7 6.3a4 4 0 00-5 5L4 17l3 3 5.7-5.7a4 4 0 005-5l-2.4 2.4-2.3-.7-.7-2.3z',
}
export const Icon = ({ n, size = 22 }: { n: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={P[n] ?? ''} />
  </svg>
)

export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [onClose])
  // En `body` y no dentro de la página: así ningún contenedor con transform, filter o animación puede convertirse en el «marco» del
  // `position: fixed` y desplazar el panel al fondo del contenido (era el caso de `.page`, ver index.css).
  return createPortal(
    <div className="sheet-wrap">
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="btn small ghost" onClick={onClose} aria-label="Cerrar">Cerrar</button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function Field({ label, error, children, hint }: { label: string; error?: string; children: ReactNode; hint?: string }) {
  return (
    <label className="f">
      {label}
      {children}
      {hint && !error && <span className="small muted">{hint}</span>}
      {error && <span className="err" role="alert">{error}</span>}
    </label>
  )
}

/** Entrada numérica. `value` en la unidad que se muestre (pesos, g, %); vacío = undefined. */
export function NumInput({ value, onChange, invalid, ...rest }: {
  value: number | undefined; onChange: (v: number | undefined) => void; invalid?: boolean
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(value === undefined ? '' : String(value))
  useEffect(() => {
    const cur = parseNum(text)
    if (value === undefined ? !isNaN(cur) : cur !== value) setText(value === undefined ? '' : String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <input {...rest} inputMode="decimal" value={text} aria-invalid={invalid || undefined}
      onChange={(e) => { setText(e.target.value); const n = parseNum(e.target.value); onChange(isNaN(n) ? undefined : n) }} />
  )
}

export const Empty = ({ title, text, action }: { title: string; text: string; action?: ReactNode }) => (
  <div className="empty"><h3>{title}</h3><p>{text}</p>{action}</div>
)

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="group">
      {options.map(([v, l]) => <button key={v} aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  )
}

export const Badge = ({ tone = '', children }: { tone?: '' | 'ok' | 'warn' | 'bad' | 'pink'; children: ReactNode }) =>
  <span className={`badge ${tone}`}>{children}</span>

export const Stat = ({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) => (
  <div className="stat"><div className="l">{label}</div><div className="v num">{value}</div>{hint && <div className="h">{hint}</div>}</div>
)

/* Toasts y confirmaciones */
interface Ui { toast: (m: string, bad?: boolean) => void; confirm: (m: string, okLabel?: string) => Promise<boolean> }
const Ctx = createContext<Ui>(null as never)
export const useUi = () => useContext(Ctx)

export function UiProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ m: string; bad?: boolean } | null>(null)
  const [c, setC] = useState<{ m: string; ok: string; res: (v: boolean) => void } | null>(null)
  const id = useId()
  const ui: Ui = {
    toast: (m, bad) => { setT({ m, bad }); setTimeout(() => setT(null), bad ? 5000 : 2600) },
    confirm: (m, ok = 'Confirmar') => new Promise((res) => setC({ m, ok, res })),
  }
  const done = (v: boolean) => { c?.res(v); setC(null) }
  return (
    <Ctx.Provider value={ui}>
      {children}
      {t && <div className={`toast glass ${t.bad ? 'bad' : ''}`} role="status" aria-live="polite">{t.m}</div>}
      {c && (
        <Sheet title="¿Seguro?" onClose={() => done(false)}
          footer={<><button className="btn" onClick={() => done(false)}>Cancelar</button><button className="btn primary" onClick={() => done(true)} aria-describedby={id}>{c.ok}</button></>}>
          <p id={id}>{c.m}</p>
        </Sheet>
      )}
    </Ctx.Provider>
  )
}
