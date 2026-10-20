import { useState } from 'react'
import { db, uid } from '../../db/db'
import { formatMXN, formatNum, pesosToCents } from '../../domain/money'
import type { Tool } from '../../domain/types'
import { todayISO } from '../data'
import { Field, NumInput, Sheet, useUi } from '../ui'

/** Recetas que usan una herramienta (para impedir su eliminación y mostrar dónde se usa). */
export async function recipesUsingTool(id: string): Promise<string[]> {
  return (await db.recipes.toArray()).filter((r) => (r.toolUses ?? []).some((u) => u.toolId === id)).map((r) => r.name)
}

export function ToolForm({ tool, onClose }: { tool?: Tool; onClose: () => void }) {
  const ui = useUi()
  const [name, setName] = useState(tool?.name ?? '')
  const [price, setPrice] = useState<number | undefined>(tool ? tool.priceCents / 100 : undefined)
  const [date, setDate] = useState(tool?.priceUpdatedAt ?? todayISO())
  const [life, setLife] = useState<number | undefined>(tool?.lifeUses)
  const [notes, setNotes] = useState(tool?.notes ?? '')
  const [tried, setTried] = useState(false)
  const priceBad = price === undefined || price < 0
  const suggested = life && life > 0 ? 100 / life : null

  const save = async () => {
    setTried(true)
    if (!name.trim() || priceBad) return
    const t: Tool = {
      id: tool?.id ?? uid(), name: name.trim(), priceCents: pesosToCents(price!), priceUpdatedAt: date, lifeUses: life && life > 0 ? life : undefined,
      notes, createdAt: tool?.createdAt ?? new Date().toISOString(), demo: tool?.demo,
    }
    await db.tools.put(t)
    ui.toast('Herramienta guardada'); onClose()
  }
  const remove = async () => {
    const used = await recipesUsingTool(tool!.id)
    if (used.length) return ui.toast(`No se puede eliminar: la usan ${used.join(', ')}`, true)
    if (await ui.confirm(`Se eliminará «${tool!.name}».`, 'Eliminar')) { await db.tools.delete(tool!.id); onClose() }
  }

  return (
    <Sheet title={tool ? 'Editar herramienta' : 'Nueva herramienta'} onClose={onClose}
      footer={<>{tool && <button className="btn danger" onClick={remove}>Eliminar</button>}<button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={save}>Guardar</button></>}>
      <div className="stack">
        <Field label="Nombre" error={tried && !name.trim() ? 'Escribe un nombre' : undefined}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tapete de silicón" autoFocus aria-invalid={tried && !name.trim()} />
        </Field>
        <div className="grid2">
          <Field label="Precio de compra (MXN)" error={tried && priceBad ? 'Escribe el precio' : undefined}><NumInput value={price} onChange={setPrice} placeholder="300" invalid={tried && priceBad} /></Field>
          <Field label="Fecha de compra"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Vida útil estimada en usos (opcional)" hint="Solo es una ayuda para decidir el porcentaje de uso que cobras en cada receta.">
          <NumInput value={life} onChange={setLife} placeholder="200" />
        </Field>
        {suggested !== null && <div className="banner ok">Si la usas en {formatNum(life!)} tandas antes de reponerla, cada tanda consume <b>{formatNum(Math.round(suggested * 1000) / 1000)} %</b> de su precio{price ? ` (${formatMXN(Math.round((pesosToCents(price) * suggested) / 100))} por tanda)` : ''}.</div>}
        <Field label="Notas"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ minHeight: 56 }} /></Field>
        <p className="small muted">En cada receta eliges qué porcentaje de esta herramienta consume una tanda. Ese costo se suma al costo de la receta y, al cambiar el precio aquí, las recetas se recalculan.</p>
      </div>
    </Sheet>
  )
}
