import { useState } from 'react'
import { staleIngredients } from '../domain/costing'
import { formatMXN, formatNum } from '../domain/money'
import { useOpen } from '../ui/create'
import { fmtDate, type Data } from '../ui/data'
import { ING_CATEGORIES } from '../ui/forms/IngredientForm'
import { Badge, Empty, Seg } from '../ui/ui'

const LBL = { masa: '100 g', volumen: '100 ml', pieza: 'pza' } as const

export function Ingredientes({ data }: { data: Data }) {
  const open = useOpen()
  const [tab, setTab] = useState<'ingredientes' | 'herramientas'>('ingredientes')
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const stale = new Set(staleIngredients(data.ingredients, data.settings.staleDays).map((i) => i.id))
  const list = data.ingredients.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()) && (!cat || i.category === cat)).sort((a, b) => a.name.localeCompare(b.name, 'es'))
  const tools = data.tools.filter((t) => t.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name, 'es'))
  const usage = (id: string) => data.recipes.filter((r) => (r.toolUses ?? []).some((u) => u.toolId === id))
  const isTools = tab === 'herramientas'
  return (
    <div className="stack">
      <div className="page-head"><h1>Ingredientes</h1><button className="btn primary" onClick={() => open({ k: isTools ? 'tool' : 'ingredient' })}>+ {isTools ? 'Herramienta' : 'Nuevo'}</button></div>
      <Seg value={tab} onChange={(t) => { setTab(t); setQ(''); setCat('') }} options={[['ingredientes', `Ingredientes (${data.ingredients.length})`], ['herramientas', `Herramientas (${data.tools.length})`]]} />
      <div className="row">
        <input aria-label={isTools ? 'Buscar herramienta' : 'Buscar ingrediente'} placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
        {!isTools && <select aria-label="Categoría" value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: 160 }}><option value="">Todas</option>{ING_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>}
      </div>

      {!isTools && (data.ingredients.length === 0 ? (
        <Empty title="Aún no hay ingredientes" text="Anota cuánto pagas por cada uno y calcularemos su costo por gramo, mililitro o pieza." action={<button className="btn primary" onClick={() => open({ k: 'ingredient' })}>Registrar el primero</button>} />
      ) : list.length === 0 ? <Empty title="Sin resultados" text="Prueba con otra búsqueda." /> : list.map((i) => (
        <button key={i.id} className="item" onClick={() => open({ k: 'ingredient', v: i })}>
          <div className="grow">
            <div className="row wrap" style={{ gap: 6 }}><b>{i.name}</b>{i.demo && <Badge tone="pink">demo</Badge>}{stale.has(i.id) && <Badge tone="warn">Precio antiguo</Badge>}</div>
            <div className="small muted">{i.category}{i.brand ? ` · ${i.brand}` : ''} · actualizado {fmtDate(i.priceUpdatedAt)}</div>
          </div>
          <div className="right num"><b>{formatMXN(Math.round(i.costPerBase * (i.dimension === 'pieza' ? 1 : 100)))}</b><div className="small muted">por {LBL[i.dimension]}</div></div>
        </button>
      )))}

      {isTools && (data.tools.length === 0 ? (
        <Empty title="Aún no hay herramientas" text="Registra espátulas, tapetes, moldes… y su precio para saber cuánto cuesta reponerlas. En cada receta cobras un «Uso de herramientas %» general (Costos → Otros)." action={<button className="btn primary" onClick={() => open({ k: 'tool' })}>Registrar la primera</button>} />
      ) : tools.length === 0 ? <Empty title="Sin resultados" text="Prueba con otra búsqueda." /> : tools.map((t) => {
        const used = usage(t.id)
        return (
          <button key={t.id} className="item" onClick={() => open({ k: 'tool', v: t })}>
            <div className="grow">
              <div className="row wrap" style={{ gap: 6 }}><b>{t.name}</b>{t.demo && <Badge tone="pink">demo</Badge>}</div>
              <div className="small muted">Comprada {fmtDate(t.priceUpdatedAt)}{t.lifeUses ? ` · vida útil ${formatNum(t.lifeUses)} usos` : ''}</div>
              {used.length > 0 && <div className="small muted">En {used.length} receta{used.length === 1 ? '' : 's'}: {used.slice(0, 3).map((r) => r.name).join(', ')}{used.length > 3 ? '…' : ''}</div>}
            </div>
            <div className="right num"><b>{formatMXN(t.priceCents)}</b><div className="small muted">precio</div></div>
          </button>
        )
      }))}
    </div>
  )
}
