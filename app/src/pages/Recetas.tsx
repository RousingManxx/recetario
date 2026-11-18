import { useEffect, useRef, useState } from 'react'
import { db } from '../db/db'
import { recipeCost } from '../domain/costing'
import { formatMXN, formatNum } from '../domain/money'
import { analyzePrice } from '../domain/pricing'
import { recipePdf, recipePdfFileName } from '../domain/recipePdf'
import { useOpen } from '../ui/create'
import { download, type Data } from '../ui/data'
import { categoriesOf, duplicateRecipe } from '../ui/forms/RecipeForm'
import { Badge, Empty, Icon, useUi } from '../ui/ui'

function RecipeActions({ recipe, onDownloadPdf, onToggleFavorite, onDuplicate, onOrder }: {
  recipe: Data['recipes'][number]
  onDownloadPdf: () => void
  onToggleFavorite: () => void
  onDuplicate: () => void
  onOrder: () => void
}) {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const firstAction = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    firstAction.current?.focus()
    const pointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('pointerdown', pointerDown)
    document.addEventListener('keydown', keyDown)
    return () => {
      document.removeEventListener('pointerdown', pointerDown)
      document.removeEventListener('keydown', keyDown)
    }
  }, [open])

  const run = (action: () => void) => () => { setOpen(false); action() }

  return (
    <div className="recipe-actions" ref={container}>
      <button ref={trigger} type="button" className="btn small ghost recipe-more" aria-label={`Más acciones de ${recipe.name}`}
        aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Icon n="more" size={22} />
      </button>
      {open && <div className="recipe-actions-menu" role="menu" aria-label={`Acciones de ${recipe.name}`}>
        <button ref={firstAction} type="button" role="menuitem" onClick={run(onDownloadPdf)}><Icon n="down" size={18} />Descargar PDF</button>
        <button type="button" role="menuitemcheckbox" aria-checked={recipe.favorite} onClick={run(onToggleFavorite)}>
          <Icon n="star" size={18} />{recipe.favorite ? 'Quitar de favoritas' : 'Marcar favorita'}
        </button>
        <button type="button" role="menuitem" onClick={run(onDuplicate)}><Icon n="copy" size={18} />Duplicar receta</button>
        <button type="button" role="menuitem" onClick={run(onOrder)}><Icon n="bag" size={18} />Crear pedido</button>
      </div>}
    </div>
  )
}

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
            <label className="recipe-select">
              <input type="checkbox" aria-label={`Seleccionar ${r.name} para imprimir`} checked={selected.includes(r.id)} onChange={(e) => setSelected((ids) => e.target.checked ? [...new Set([...ids, r.id])] : ids.filter((id) => id !== r.id))} />
            </label>
            <button className="recipe-open" onClick={() => open({ k: 'recipe', v: r })}>
              {r.imageDataUrl && <img className="recipe-thumb" src={r.imageDataUrl} alt="" />}
              <div className="grow">
                <div className="row wrap" style={{ gap: 6 }}><b>{r.name}</b>{r.demo && <Badge tone="pink">demo</Badge>}<span className="small muted">{r.category}</span></div>
                <div className="small muted num">Costo {formatMXN(c.unitCostCents)}{r.portionsPerUnit > 1 ? ` · porción ${formatMXN(c.portionCostCents)}` : ''}</div>
                {a && <div className="small num">Precio {formatMXN(r.priceCents!)} · <span style={{ color: (a.marginPct ?? 0) < 0 ? 'var(--bad)' : 'var(--ok)' }}>margen {a.marginPct == null ? '—' : formatNum(a.marginPct) + ' %'}</span></div>}
                {!a && <div className="small" style={{ color: 'var(--warn)' }}>Sin precio de venta</div>}
              </div>
            </button>
            <RecipeActions recipe={r} onDownloadPdf={() => exportPdf([r])}
              onToggleFavorite={() => { void db.recipes.update(r.id, { favorite: !r.favorite }) }}
              onDuplicate={() => { void duplicateRecipe(r) }} onOrder={() => open({ k: 'order', recipeId: r.id })} />
          </div>
        )
      })}
    </div>
  )
}
