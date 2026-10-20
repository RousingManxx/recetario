import { useState } from 'react'
import { db } from '../db/db'
import { recipeCost } from '../domain/costing'
import { formatMXN, formatNum } from '../domain/money'
import { analyzePrice } from '../domain/pricing'
import { useOpen } from '../ui/create'
import type { Data } from '../ui/data'
import { duplicateRecipe, RECIPE_CATEGORIES } from '../ui/forms/RecipeForm'
import { Badge, Empty, Icon } from '../ui/ui'

export function Recetas({ data }: { data: Data }) {
  const open = useOpen()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [favs, setFavs] = useState(false)
  const list = data.recipes
    .filter((r) => r.name.toLowerCase().includes(q.toLowerCase()) && (!cat || r.category === cat) && (!favs || r.favorite))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
  return (
    <div className="stack">
      <div className="page-head"><h1>Recetas</h1><button className="btn primary" onClick={() => open({ k: 'recipe' })}>+ Nueva</button></div>
      <div className="row">
        <div className="grow" style={{ position: 'relative' }}><input aria-label="Buscar receta" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select aria-label="Categoría" value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: 150 }}><option value="">Todas</option>{RECIPE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
        <button className="btn" aria-pressed={favs} onClick={() => setFavs(!favs)} aria-label="Solo favoritas" style={favs ? { background: 'var(--accent-soft)' } : {}}><Icon n="star" size={18} /></button>
      </div>
      {data.recipes.length === 0 ? (
        <Empty title="Aún no tienes recetas" text="Calcula cuánto cuesta cada producto y qué precio cobrar." action={<button className="btn primary" onClick={() => open({ k: 'recipe' })}>Crear mi primera receta</button>} />
      ) : list.length === 0 ? <Empty title="Sin resultados" text="Prueba con otra búsqueda o filtro." /> : list.map((r) => {
        const c = recipeCost(r, data.ingMap)
        const a = r.priceCents != null ? analyzePrice(r.priceCents, c.unitCostCents, r.commissionPct) : null
        return (
          <div key={r.id} className="item" onClick={() => open({ k: 'recipe', v: r })} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open({ k: 'recipe', v: r })}>
            <div className="grow">
              <div className="row wrap" style={{ gap: 6 }}><b>{r.name}</b>{r.demo && <Badge tone="pink">demo</Badge>}<span className="small muted">{r.category}</span></div>
              <div className="small muted num">Costo {formatMXN(c.unitCostCents)}{r.portionsPerUnit > 1 ? ` · porción ${formatMXN(c.portionCostCents)}` : ''}</div>
              {a && <div className="small num">Precio {formatMXN(r.priceCents!)} · <span style={{ color: (a.marginPct ?? 0) < 0 ? 'var(--bad)' : 'var(--ok)' }}>margen {a.marginPct == null ? '—' : formatNum(a.marginPct) + ' %'}</span></div>}
              {!a && <div className="small" style={{ color: 'var(--warn)' }}>Sin precio de venta</div>}
            </div>
            <div className="row" style={{ gap: 2 }} onClick={(e) => e.stopPropagation()}>
              <button className="btn small ghost" aria-label={r.favorite ? 'Quitar de favoritas' : 'Marcar favorita'} onClick={() => db.recipes.update(r.id, { favorite: !r.favorite })} style={{ color: r.favorite ? 'var(--accent-strong)' : 'var(--text-2)' }}>{r.favorite ? '★' : '☆'}</button>
              <button className="btn small ghost" aria-label="Duplicar receta" onClick={() => duplicateRecipe(r)}><Icon n="copy" size={18} /></button>
              <button className="btn small ghost" aria-label="Crear pedido con esta receta" onClick={() => open({ k: 'order', recipeId: r.id })}><Icon n="bag" size={18} /></button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
