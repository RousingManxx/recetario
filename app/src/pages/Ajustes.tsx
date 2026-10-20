import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { createBackup, db, deleteDemoData, restoreBackup, saveSettings, snapshot } from '../db/db'
import { loadDemo } from '../db/demo'
import { FORMAT, parseBackup, SCHEMA_VERSION, type ValidationReport } from '../domain/backup'
import { exportCsvs } from '../domain/csv'
import { formatMXN } from '../domain/money'
import type { LaborMode } from '../domain/types'
import { useOpen } from '../ui/create'
import { download, fmtDateTime, type Data } from '../ui/data'
import { Badge, Field, NumInput, Sheet, useUi } from '../ui/ui'

export function Ajustes({ data }: { data: Data }) {
  const ui = useUi()
  const open = useOpen()
  const s = data.settings
  const file = useRef<HTMLInputElement>(null)
  const [report, setReport] = useState<{ rep: ValidationReport; name: string } | null>(null)
  const [mode, setMode] = useState<'reemplazar' | 'combinar'>('combinar')
  const [sep, setSep] = useState<',' | ';'>(',')
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showJson, setShowJson] = useState(false)

  const stamp = () => new Date().toISOString().slice(0, 10)
  const exportJson = async () => { const b = await createBackup(); download(`recetario-respaldo-${stamp()}.json`, JSON.stringify(b, null, 2), 'application/json'); ui.toast('Copia de seguridad descargada') }
  const copyJson = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(await createBackup(), null, 2)); ui.toast('JSON copiado al portapapeles') }
    catch { ui.toast('No se pudo copiar; usa «Descargar».', true) }
  }
  const exportCsv = async (name: string) => {
    const files = exportCsvs(await snapshot(), sep)
    const names = name === 'todo' ? Object.keys(files) : [name]
    for (const n of names) download(n, files[n], 'text/csv;charset=utf-8')
    ui.toast(`${names.length} archivo(s) CSV exportado(s)`)
  }
  const pick = async (f?: File) => {
    if (!f) return
    setResult(null)
    setReport({ rep: parseBackup(await f.text()), name: f.name })
  }
  const doRestore = async () => {
    if (!report?.rep.ok || !report.rep.data) return
    if (mode === 'reemplazar' && !(await ui.confirm('Se reemplazarán TODOS tus datos actuales por los de la copia. Esta acción no se puede deshacer. Te recomendamos descargar una copia antes.', 'Reemplazar todo'))) return
    setBusy(true)
    try {
      const r = await restoreBackup(report.rep.data, mode)
      setResult(`Restauración completada: ${r.added} registro(s) ${mode === 'reemplazar' ? 'restaurados' : 'agregados'}${mode === 'combinar' ? `, ${r.skipped} ya existían y se conservaron` : ''}.`)
      setReport(null)
    } catch (e) { setResult(`Error: ${(e as Error).message}. Tus datos anteriores no se modificaron.`) }
    setBusy(false)
  }

  return (
    <div className="stack-lg">
      <div className="page-head"><h1>Ajustes</h1></div>

      <section className="stack">
        <h2>Mi negocio</h2>
        <Field label="Nombre de la pastelería"><input key={s.businessName} defaultValue={s.businessName} onBlur={(e) => saveSettings({ businessName: e.target.value.trim() })} placeholder="Mi pastelería" /></Field>
        <div className="grid2">
          <Field label="Moneda"><input value="Peso mexicano (MXN)" disabled /></Field>
          <Field label="Idioma y región"><input value="Español (México)" disabled /></Field>
        </div>
        <div className="grid2">
          <Field label="Mano de obra por defecto"><select value={s.defaultLaborMode} onChange={(e) => saveSettings({ defaultLaborMode: e.target.value as LaborMode })}><option value="hora">Por hora</option><option value="minuto">Por minuto</option><option value="operacion">Por operación</option></select></Field>
          <Field label="Tarifa por defecto (MXN)"><NumInput value={s.defaultLaborRateCents / 100} onChange={(v) => saveSettings({ defaultLaborRateCents: Math.round((v ?? 0) * 100) })} /></Field>
          <Field label="Margen objetivo por defecto (%)"><NumInput value={s.defaultMarginPct} onChange={(v) => saveSettings({ defaultMarginPct: v ?? 0 })} /></Field>
          <Field label="Avisar precios con más de (días)"><NumInput value={s.staleDays} onChange={(v) => saveSettings({ staleDays: v && v > 0 ? v : 60 })} /></Field>
        </div>
        <p className="small muted">Estos valores se usan solo como punto de partida en recetas nuevas; en cada receta puedes cambiarlos.</p>
        <div className="row wrap"><Link className="btn" to="/inicio" style={{ textDecoration: 'none' }}>Guía de inicio</Link><button className="btn" onClick={() => open({ k: 'expense' })}>Registrar gasto</button></div>
      </section>

      <Expenses data={data} />

      <section className="stack">
        <h2>Copia de seguridad (JSON)</h2>
        <p className="small muted">Última copia: <b>{s.lastBackupAt ? fmtDateTime(s.lastBackupAt) : 'nunca'}</b>. Formato <span className="kbd">{FORMAT}</span> · esquema v{SCHEMA_VERSION}. Tus datos viven solo en este dispositivo: descarga copias con frecuencia, sobre todo antes de cambiar de teléfono.</p>
        {!s.lastBackupAt && <div className="banner">Aún no has hecho ninguna copia de seguridad.</div>}
        <div className="row wrap"><button className="btn primary" onClick={exportJson}>Descargar copia</button><button className="btn" onClick={copyJson}>Copiar JSON</button><button className="btn" onClick={() => setShowJson(true)}>Ver formato</button></div>
        <h3>Restaurar</h3>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
        <button className="btn" onClick={() => file.current?.click()}>Elegir archivo de respaldo…</button>
        {result && <div className={`banner ${result.startsWith('Error') ? 'bad' : 'ok'}`} role="status">{result}</div>}
      </section>

      <section className="stack">
        <h2>Exportar a CSV (Excel)</h2>
        <Field label="Separador"><select value={sep} onChange={(e) => setSep(e.target.value as ',' | ';')}><option value=",">Coma (Excel en México / inglés)</option><option value=";">Punto y coma (Excel con configuración europea)</option></select></Field>
        <div className="grid">
          {[['ingredientes.csv', 'Ingredientes'], ['compras.csv', 'Historial de compras'], ['recetas.csv', 'Recetas'], ['recetas_ingredientes.csv', 'Ingredientes de recetas'], ['herramientas.csv', 'Herramientas'], ['recetas_herramientas.csv', 'Herramientas de recetas'], ['pedidos.csv', 'Pedidos'], ['pedidos_lineas.csv', 'Líneas de pedido'], ['pagos.csv', 'Pagos'], ['clientes.csv', 'Clientes'], ['gastos.csv', 'Gastos']].map(([n, l]) => <button key={n} className="btn" onClick={() => exportCsv(n)}>{l}</button>)}
        </div>
        <button className="btn primary" onClick={() => exportCsv('todo')}>Exportar todo</button>
        <p className="small">¿Quieres un reporte de ventas, costos y ganancias por fechas? Ve a <Link to="/finanzas">Finanzas → Exportar reporte</Link> (PDF o CSV).</p>
        <p className="small muted">UTF-8 con BOM (acentos correctos en Excel). Los archivos comparten identificadores (<span className="kbd">id</span>, <span className="kbd">receta_id</span>, <span className="kbd">pedido_id</span>…) para poder relacionarlos. Los datos de demostración no se exportan.</p>
      </section>

      <section className="stack">
        <h2>Datos de demostración</h2>
        <p className="small muted">Ejemplos claramente marcados con «demo», separados de tus datos reales. No se incluyen en copias ni en exportaciones.</p>
        <div className="row wrap">
          {!s.demoLoaded && <button className="btn" onClick={async () => { await loadDemo(); ui.toast('Datos de demostración cargados') }}>Cargar ejemplos</button>}
          {s.demoLoaded && <button className="btn danger" onClick={async () => { if (await ui.confirm('Se borrarán solo los registros marcados como demo. Tus datos reales no se tocan.', 'Borrar demo')) { await deleteDemoData(); ui.toast('Demo eliminada') } }}>Borrar datos de demostración</button>}
        </div>
      </section>

      <section className="stack">
        <h2>Zona delicada</h2>
        <button className="btn danger" onClick={async () => {
          if (!(await ui.confirm('Se borrarán TODOS los datos de este dispositivo. Descarga una copia antes.', 'Borrar todo'))) return
          if (!(await ui.confirm('Última confirmación: no hay forma de recuperarlos sin una copia.', 'Sí, borrar todo'))) return
          await Promise.all([db.ingredients, db.purchases, db.recipes, db.customers, db.orders, db.expenses, db.tools, db.settings].map((t) => t.clear())); ui.toast('Datos borrados')
        }}>Borrar todos los datos</button>
      </section>

      <p className="small muted" style={{ textAlign: 'center' }}>Versión de la app: <span className="kbd">{__APP_VERSION__}</span></p>

      {report && (
        <Sheet title="Revisar copia de seguridad" onClose={() => setReport(null)}
          footer={<><button className="btn" onClick={() => setReport(null)}>Cancelar</button><button className="btn primary" disabled={!report.rep.ok || busy} onClick={doRestore}>{mode === 'reemplazar' ? 'Reemplazar datos' : 'Combinar datos'}</button></>}>
          <div className="stack">
            <div className="small muted">{report.name}</div>
            {report.rep.errors.length > 0 && <div className="banner bad" role="alert"><b>No se puede importar:</b><ul>{report.rep.errors.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
            {report.rep.warnings.length > 0 && <div className="banner"><ul style={{ margin: 0 }}>{report.rep.warnings.slice(0, 6).map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
            {report.rep.ok && (
              <>
                <div className="card stack small">
                  <b>Contenido (v{report.rep.data!.schemaVersion}, {fmtDateTime(report.rep.data!.createdAt)})</b>
                  {Object.entries(report.rep.counts).map(([k, v]) => <div key={k} className="row between"><span style={{ textTransform: 'capitalize' }}>{({ ingredients: 'Ingredientes', purchases: 'Compras', recipes: 'Recetas', customers: 'Clientes', orders: 'Pedidos', expenses: 'Gastos', tools: 'Herramientas' } as Record<string, string>)[k]}</span><span className="num">{v}</span></div>)}
                </div>
                <Field label="Modo de restauración">
                  <select value={mode} onChange={(e) => setMode(e.target.value as 'reemplazar' | 'combinar')}>
                    <option value="combinar">Combinar: agrega lo que falte y conserva lo actual</option>
                    <option value="reemplazar">Reemplazar: sustituye todos mis datos</option>
                  </select>
                </Field>
                {mode === 'reemplazar' && <div className="banner bad">Reemplazar borra tus datos actuales. Se pedirá confirmación.</div>}
                <p className="small muted">La operación es atómica: si algo falla, tus datos quedan como estaban.</p>
              </>
            )}
          </div>
        </Sheet>
      )}
      {showJson && (
        <Sheet title="Formato de la copia" onClose={() => setShowJson(false)}>
          <pre className="small" style={{ whiteSpace: 'pre-wrap' }}>{`{
  "format": "${FORMAT}",
  "schemaVersion": ${SCHEMA_VERSION},
  "createdAt": "ISO-8601",
  "appVersion": "1.0.0",
  "ingredients": [...], "purchases": [...],
  "recipes": [...], "customers": [...],
  "orders": [...], "expenses": [...],
  "tools": [...],
  "settings": {...}
}`}</pre>
          <p className="small muted">Importes en centavos MXN (enteros). Cada registro tiene un <span className="kbd">id</span> estable y las relaciones usan esos ids. Las copias de versiones anteriores se migran automáticamente al importar; las de versiones más nuevas se rechazan.</p>
        </Sheet>
      )}
    </div>
  )
}

function Expenses({ data }: { data: Data }) {
  const open = useOpen()
  const list = [...data.expenses].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8)
  if (!list.length) return null
  return (
    <section className="stack">
      <h2>Gastos recientes</h2>
      {list.map((e) => <button key={e.id} className="item" onClick={() => open({ k: 'expense', v: e })}><div className="grow">{e.concept} {e.fixed && <Badge>fijo</Badge>} {e.demo && <Badge tone="pink">demo</Badge>}<div className="small muted">{e.date} · {e.category}</div></div><b className="num">{formatMXN(e.amountCents)}</b></button>)}
    </section>
  )
}
