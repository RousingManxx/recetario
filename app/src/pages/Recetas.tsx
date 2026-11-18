import { useState } from 'react'
import { db } from '../db/db'
import { recipeCost } from '../domain/costing'
import { formatMXN, formatNum } from '../domain/money'
import { analyzePrice } from '../domain/pricing'
import { useOpen } from '../ui/create'
import type { Data } from '../ui/data'
import { categoriesOf, duplicateRecipe } from '../ui/forms/RecipeForm'
import { Badge, Empty, Icon, useUi } from '../ui/ui'

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

function printRecipes(recipes: Data['recipes'], data: Data): boolean {
  const printWindow = window.open('', '_blank')
  if (!printWindow) return false
  const content = recipes.map((recipe) => {
    const components = recipe.components.map((component) => {
      const ingredient = data.ingMap.get(component.ingredientId)
      return `<li><span class="ingredient-name">${escapeHtml(ingredient?.name ?? 'Ingrediente')}</span><span class="ingredient-amount">${escapeHtml(formatNum(component.qty))} ${escapeHtml(component.unit)}</span></li>`
    })
    const recipeComponents = (recipe.recipeComponents ?? []).map((component) => {
      const source = data.recipeMap.get(component.recipeId)
      return `<li><span class="ingredient-name">${escapeHtml(source?.name ?? 'Receta')}</span><span class="ingredient-amount">${escapeHtml(formatNum(component.qty))} unidad(es)</span></li>`
    })
    const imageDataUrl = recipe.imageDataUrl
    const image = imageDataUrl && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(imageDataUrl)
      ? `<div class="hero-photo"><img class="recipe-image" src="${escapeHtml(imageDataUrl)}" alt="Foto de ${escapeHtml(recipe.name)}"></div>` : ''
    const steps = recipe.steps.split(/\r?\n/).map((step) => step.trim()).filter(Boolean)
      .map((step) => `<li>${escapeHtml(step.replace(/^\d+[.)]\s*/, ''))}</li>`).join('')
    const totalMinutes = recipe.activeMin + recipe.bakeMin + recipe.restMin
    const yieldLabel = `${formatNum(recipe.yieldQty)} ${recipe.yieldQty === 1 ? 'unidad' : 'unidades'}`
    const business = data.settings.businessName.trim()
    return `<article>
      <header class="masthead"><span class="brand">${escapeHtml(business || 'RECETARIO')}</span><span class="edition">${escapeHtml(recipe.category || 'Receta')}</span></header>
      <section class="intro">${image}<div class="intro-copy"><p class="eyebrow">RECETA · ${escapeHtml(recipe.category.toUpperCase())}</p><h1>${escapeHtml(recipe.name)}</h1>${recipe.description ? `<p class="description">${escapeHtml(recipe.description)}</p>` : ''}</div></section>
      <section class="facts"><div><span class="fact-label">Rendimiento</span><strong>${escapeHtml(yieldLabel)}</strong></div>${recipe.portionsPerUnit > 1 ? `<div><span class="fact-label">Porciones</span><strong>${escapeHtml(formatNum(recipe.portionsPerUnit))} por unidad</strong></div>` : ''}${totalMinutes > 0 ? `<div><span class="fact-label">Tiempo total</span><strong>${escapeHtml(formatNum(totalMinutes))} min</strong></div>` : ''}</section>
      <div class="columns"><section class="ingredients"><h2><span class="section-number">01</span> Ingredientes</h2><ul>${[...components, ...recipeComponents].join('') || '<li><span class="ingredient-name">Sin ingredientes registrados</span></li>'}</ul></section>
      ${steps ? `<section class="preparation"><h2><span class="section-number">02</span> Preparación</h2><ol>${steps}</ol></section>` : ''}</div>
      ${recipe.notes ? `<aside class="notes"><h2>Notas</h2><p>${escapeHtml(recipe.notes)}</p></aside>` : ''}
      <footer><span>${escapeHtml(business || recipe.name)}</span><span>Hecho con cariño · ${escapeHtml(recipe.category)}</span></footer>
    </article>`
  }).join('')
  printWindow.onload = () => { printWindow.focus(); printWindow.print() }
  printWindow.document.open()
  printWindow.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Recetas</title><style>
    :root{color-scheme:light;--ink:#30231f;--muted:#78655d;--berry:#a64e5c;--berry-pale:#f8edef;--cream:#fbf8f2;--line:#eadfd6}
    *{box-sizing:border-box}body{margin:0;background:#f2eee8;color:var(--ink);font:15px/1.55 "Aptos", "Segoe UI", Arial, sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    article{position:relative;max-width:850px;min-height:1050px;margin:32px auto;padding:42px 52px 72px;background:#fff;box-shadow:0 12px 40px #48342b14;break-after:page;overflow:hidden}
    article:last-child{break-after:auto}.masthead{display:flex;justify-content:space-between;align-items:center;padding-bottom:14px;border-bottom:1px solid var(--line);font-size:10px;letter-spacing:.15em}.brand{font-weight:700;color:var(--berry)}.edition{text-transform:uppercase;color:var(--muted)}
    .intro{display:flex;flex-direction:column-reverse;gap:24px;padding:38px 0 24px}.intro-copy{max-width:620px}.eyebrow{margin:0 0 10px;color:var(--berry);font-size:10px;font-weight:700;letter-spacing:.18em}
    h1{margin:0;font:500 42px/1.08 Georgia, "Times New Roman", serif;letter-spacing:-.025em}.description{max-width:620px;margin:14px 0 0;color:var(--muted);font:italic 16px/1.55 Georgia, "Times New Roman", serif}
    .hero-photo{height:300px;overflow:hidden;border-radius:4px;background:var(--cream)}.recipe-image{display:block;width:100%;height:100%;object-fit:cover}
    .facts{display:flex;flex-wrap:wrap;gap:0;margin:6px 0 32px;padding:15px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
    .facts>div{display:flex;flex:1;min-width:120px;flex-direction:column;gap:3px;padding:0 18px;border-left:1px solid var(--line)}.facts>div:first-child{padding-left:0;border-left:0}
    .fact-label{color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.1em}.facts strong{font-size:13px;font-weight:600}
    .columns{display:grid;grid-template-columns:minmax(210px,.82fr) minmax(0,1.3fr);gap:38px}h2{margin:0 0 14px;font:500 21px/1.2 Georgia, "Times New Roman", serif}.section-number{margin-right:5px;color:var(--berry);font:700 10px/1 "Aptos", "Segoe UI", Arial, sans-serif;letter-spacing:.08em}
    ul,ol{margin:0;padding:0;list-style:none} .ingredients li{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--line);font-size:12px}.ingredient-name{font-weight:500}.ingredient-amount{flex:none;color:var(--muted);text-align:right}
    .preparation ol{counter-reset:step}.preparation li{position:relative;min-height:35px;margin:0 0 14px;padding-left:34px;font-size:13px;counter-increment:step}.preparation li:before{position:absolute;left:0;top:-2px;display:grid;width:24px;height:24px;place-items:center;border-radius:50%;background:var(--berry-pale);color:var(--berry);content:counter(step, decimal-leading-zero);font-size:9px;font-weight:700}
    .notes{margin-top:30px;padding:16px 18px;border-left:3px solid #d5ab7c;background:var(--cream)}.notes h2{margin-bottom:5px;font:700 10px/1.4 "Aptos", "Segoe UI", Arial, sans-serif;text-transform:uppercase;letter-spacing:.13em;color:var(--muted)}.notes p{margin:0;font-size:12px;white-space:pre-wrap}
    footer{position:absolute;right:52px;bottom:25px;left:52px;display:flex;justify-content:space-between;gap:12px;padding-top:10px;border-top:1px solid var(--line);color:var(--muted);font-size:9px;letter-spacing:.04em}
    @media screen and (max-width:700px){article{min-height:0;margin:12px;padding:26px 22px 64px}h1{font-size:34px}.columns{grid-template-columns:1fr;gap:28px}footer{right:22px;left:22px}.hero-photo{height:230px}}
    @page{size:A4;margin:0}@media print{body{background:#fff}article{width:210mm;min-height:297mm;margin:0;padding:17mm 18mm 24mm;box-shadow:none}article:last-child{break-after:auto}.hero-photo{height:68mm}h1{font-size:38px}footer{right:18mm;bottom:10mm;left:18mm}}
    </style></head><body>${content}</body></html>`)
  printWindow.document.close()
  return true
}

export function Recetas({ data }: { data: Data }) {
  const open = useOpen()
  const ui = useUi()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [favs, setFavs] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const list = data.recipes
    .filter((r) => r.name.toLowerCase().includes(q.toLowerCase()) && (!cat || r.category === cat) && (!favs || r.favorite))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
  const selectedRecipes = data.recipes.filter((recipe) => selected.includes(recipe.id))
  const print = (recipes: Data['recipes']) => {
    if (!printRecipes(recipes, data)) ui.toast('Permite las ventanas emergentes para imprimir las recetas.', true)
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
        <button className="btn small" onClick={() => print(selectedRecipes)} disabled={!selectedRecipes.length}>Imprimir seleccionadas ({selectedRecipes.length})</button>
        <button className="btn small" onClick={() => print([...data.recipes].sort((a, b) => a.name.localeCompare(b.name, 'es')))}>Imprimir todas</button>
        <span className="small muted">En el diálogo puedes imprimir o guardar como PDF.</span>
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
              <button className="btn small ghost" aria-label={`Imprimir ${r.name}`} onClick={() => print([r])}><Icon n="print" size={18} /></button>
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
