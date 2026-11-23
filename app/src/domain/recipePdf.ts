import { formatNum } from './money'
import type { Ingredient, Recipe } from './types'
import { C, M, PW, Pdf } from './pdf'

export interface RecipePdfContext {
  businessName: string
  ingredients: Map<string, Ingredient>
  recipes: Map<string, Recipe>
}

const CONTENT_WIDTH = PW - 2 * M
const dateStamp = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export function recipePdfFileName(recipes: Recipe[], date = new Date()): string {
  if (recipes.length === 1) {
    const slug = recipes[0].name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'receta'
    return `receta-${slug}_${dateStamp(date)}.pdf`
  }
  return `recetas_${dateStamp(date)}.pdf`
}

export function recipePdf(recipes: Recipe[], context: RecipePdfContext): Uint8Array {
  if (recipes.length === 0) throw new Error('Selecciona al menos una receta para crear el PDF.')
  const pdf = new Pdf()
  const business = context.businessName.trim() || 'Recetario'

  recipes.forEach((recipe, index) => {
    if (index > 0) pdf.newPage()
    pdf.rect(0, 0, PW, 6, C.sales)
    pdf.y = 25
    pdf.text(M, pdf.y, business, { size: 11, bold: true, color: C.sales })
    pdf.text(PW - M, pdf.y, recipe.category.toUpperCase(), { size: 8, color: C.muted, align: 'r' })
    pdf.y += 24
    pdf.paragraph(recipe.name, { size: 23, bold: true, gap: 5 })
    if (recipe.description) pdf.paragraph(recipe.description, { size: 10, color: C.muted, gap: 10 })

    if (recipe.imageDataUrl) {
      pdf.ensure(224)
      pdf.rect(M, pdf.y, CONTENT_WIDTH, 214, C.head)
      pdf.rect(M + 8, pdf.y + 8, CONTENT_WIDTH - 16, 198, C.white)
      pdf.image(recipe.imageDataUrl, M + 14, pdf.y + 14, CONTENT_WIDTH - 28, 186)
      pdf.y += 226
    }

    const facts = [
      `Rendimiento: ${formatNum(recipe.yieldQty)} ${recipe.yieldQty === 1 ? 'unidad' : 'unidades'}`,
      ...(recipe.portionsPerUnit > 1 ? [`Porciones: ${formatNum(recipe.portionsPerUnit)} por unidad`] : []),
      ...((recipe.activeMin + recipe.bakeMin + recipe.restMin) > 0 ? [`Tiempo: ${formatNum(recipe.activeMin + recipe.bakeMin + recipe.restMin)} min`] : []),
    ]
    pdf.rect(M, pdf.y, CONTENT_WIDTH, 32, C.head)
    facts.forEach((fact, factIndex) => pdf.text(M + 10 + factIndex * (CONTENT_WIDTH / facts.length), pdf.y + 10, fact, { size: 8.5, bold: true }))
    pdf.y += 44

    pdf.heading('Ingredientes')
    const ingredients = recipe.components.map((component) => ({
      name: context.ingredients.get(component.ingredientId)?.name ?? 'Ingrediente',
      amount: `${formatNum(component.qty)} ${component.unit}`,
    }))
    for (const component of recipe.recipeComponents ?? []) {
      ingredients.push({
        name: context.recipes.get(component.recipeId)?.name ?? 'Receta componente',
        amount: `${formatNum(component.qty)} unidad(es)`,
      })
    }
    if (ingredients.length === 0) ingredients.push({ name: 'Sin ingredientes registrados', amount: '' })
    for (const item of ingredients) {
      const nameLines = pdf.wrap(item.name, CONTENT_WIDTH - 120, 9)
      const rowHeight = Math.max(19, nameLines.length * 12 + 6)
      pdf.ensure(rowHeight + 2)
      pdf.rect(M, pdf.y - 3, 2, rowHeight - 2, C.sales)
      nameLines.forEach((line, lineIndex) => pdf.text(M + 8, pdf.y + lineIndex * 12, line, { size: 9 }))
      pdf.text(PW - M - 4, pdf.y, item.amount, { size: 9, color: C.muted, align: 'r' })
      pdf.line(M + 6, pdf.y + rowHeight - 2, PW - M, pdf.y + rowHeight - 2)
      pdf.y += rowHeight
    }
    pdf.y += 10

    pdf.heading('Preparación')
    const steps = recipe.steps.split(/\r?\n/).map((step) => step.trim()).filter(Boolean)
    if (steps.length === 0) pdf.paragraph('Sin pasos de preparación registrados.', { size: 9, color: C.muted })
    for (const [stepIndex, rawStep] of steps.entries()) {
      const step = rawStep.replace(/^\d+[.)]\s*/, '')
      const lines = pdf.wrap(step, CONTENT_WIDTH - 26, 9)
      pdf.ensure(lines.length * 13 + 4)
      pdf.text(M + 2, pdf.y, `${stepIndex + 1}.`, { size: 9, bold: true, color: C.sales })
      lines.forEach((line, lineIndex) => pdf.text(M + 22, pdf.y + lineIndex * 13, line, { size: 9 }))
      pdf.y += lines.length * 13 + 5
    }
    if (recipe.notes) {
      pdf.y += 8
      pdf.heading('Notas')
      pdf.paragraph(recipe.notes, { size: 9, color: C.muted })
    }
  })

  return pdf.build(`${business} · Recetas`)
}
