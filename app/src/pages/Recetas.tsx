import { useState } from 'react'
import { db } from '../db/db'
import { recipeCost } from '../domain/costing'
import { formatMXN, formatNum } from '../domain/money'
import { analyzePrice } from '../domain/pricing'
import { recipePdf, recipePdfFileName } from '../domain/recipePdf'
import { useOpen } from '../ui/create'
import { download, type Data } from '../ui/data'
import { categoriesOf, duplicateRecipe } from '../ui/forms/RecipeForm'
import { Badge, Empty, Icon, useUi } from '../ui/ui'

export function Recetas({ data }: { data: Data }) {
  const open = useOpen()
  const ui = useUi()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [favs, setFavs] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [exporting, setExporting] = useState(false)
  const list = data.recipes
    .filter((r) => r.name.toLowerCase().includes(q.toLowerCase()) && (!cat || r.category === cat) && (!favs || r.favorite))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
  const selectedRecipes = data.recipes.filter((recipe) => selected.includes(recipe.id))
  const exportPdf = (recipes: Data['recipes']) => {
    if (!recipes.length || exporting) return
    setExporting(true)
    try {
      const name = recipePdfFileName(recipes)
      const bytes = recipePdf(recipes, { businessName: data.settings.businessName, ingredients: data.ingMap, recipes: data.recipeMap })
      download(name, new Blob([bytes as BlobPart], { type: 'application/pdf' }))
      ui.toast(`PDF descargado: ${name}`)
    } catch (error) {
      ui.toast(`No se pudo generar el PDF: ${(error as Error).message}`, true)
    } finally { setExporting(false) }
  }
  const canCombine = [data.recipes.filter((r) => !r.demo), data.recipes.filter((r) => r.demo)].some((group) => group.length >= 2)
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Recetas</h1>
        <div className="row wrap">
          <button className="btn" disabled={!canCombine} onClick={() => open({ k: 'recipe', compose: true })}>Combinar recetas</button>
          <button className="btn primary" onClick={() => open({ k: 'recipe' })}>+ Nueva receta</button>
        </div>
      </div>
      <p className="small muted">«Nueva receta» es para definir ingredientes y costos; «Combinar recetas» crea una receta a partir de otras ya guardadas.</p>
      {data.recipes.length > 0 && <div className="row wrap">
        <button className="btn small" onClick={() => setSelected((ids) => [...new Set([...ids, ...list.map((recipe) => recipe.id)])])} disabled={!list.length}>Seleccionar visibles</button>
        <button className="btn small" onClick={() => setSelected([])} disabled={!selected.length}>Limpiar selección</button>
        <button className="btn small" onClick={() => exportPdf(selectedRecipes)} disabled={!selectedRecipes.length || exporting}>{exporting ? 'Generando…' : `Descargar PDF seleccionadas (${selectedRecipes.length})`}</button>
        <button className="btn small" onClick={() => exportPdf([...data.recipes].sort((a, b) => a.name.localeCompare(b.name, 'es')))} disabled={exporting}>{exporting ? 'Generando…' : 'Descargar PDF todas'}</button>
      </div>}
      <div className="row">
        <div className="grow" style={{ position: 'relative' }}><input aria-label="Buscar receta" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select aria-label="Categoría" value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: 150 }}><option value="">Todas</option>{categoriesOf(data.recipes).map((c) => <option key={c}>{c}</option>)}</select>
        <button className="btn" aria-pressed={favs} onClick={() => setFavs(!favs)} aria-label="Solo favoritas" style={favs ? { background: 'var(--accent-soft)' } : {}}><Icon n="star" size={18} /></button>
      </div>
      {data.recipes.length === 0 ? (
        <Empty title="Aún no tienes recetas" text="Calcula cuánto cuesta cada producto y qué precio cobrar." action={<button className="btn primary" onClick={() => open({ k: 'recipe' })}>Crear mi primera receta</button>} />
      ) : list.length === 0 ? <Empty title="Sin resultados" text="Prueba con otra búsqueda o filtro." /> : list.map((r) => {
        const c = recipeCost(r, data.ingMap, data.toolMap, data.recipeMap)
        const a = r.priceCents != null ? analyzePrice(r.priceCents, c.unitCostCents, r.commissionPct) : null
        return (
          <div key={r.id} className="item recipe-row">
            <input type="checkbox" aria-label={`Seleccionar ${r.name} para imprimir`} checked={selected.includes(r.id)} onChange={(e) => setSelected((ids) => e.target.checked ? [...new Set([...ids, r.id])] : ids.filter((id) => id !== r.id))} />
            <button className="recipe-open" onClick={() => open({ k: 'recipe', v: r })}>
              {r.imageDataUrl && <img className="recipe-thumb" src={r.imageDataUrl} alt="" />}
              <div className="grow">
                <div className="row wrap" style={{ gap: 6 }}><b>{r.name}</b>{r.demo && <Badge tone="pink">demo</Badge>}<span className="small muted">{r.category}</span></div>
                <div className="small muted num">Costo {formatMXN(c.unitCostCents)}{r.portionsPerUnit > 1 ? ` · porción ${formatMXN(c.portionCostCents)}` : ''}</div>
                {a && <div className="small num">Precio {formatMXN(r.priceCents!)} · <span style={{ color: (a.marginPct ?? 0) < 0 ? 'var(--bad)' : 'var(--ok)' }}>margen {a.marginPct == null ? '—' : formatNum(a.marginPct) + ' %'}</span></div>}
                {!a && <div className="small" style={{ color: 'var(--warn)' }}>Sin precio de venta</div>}
              </div>
            </button>
            <div className="row recipe-actions" style={{ gap: 2 }}>
              <button className="btn small ghost" aria-label={`Descargar PDF de ${r.name}`} onClick={() => exportPdf([r])} disabled={exporting}><Icon n="down" size={18} /></button>
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
