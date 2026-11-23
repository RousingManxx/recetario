import { formatNum } from './money'
import type { Ingredient, Recipe } from './types'
import { C, M, PW, Pdf, type RGB } from './pdf'

export interface RecipePdfContext {
  businessName: string
  ingredients: Map<string, Ingredient>
  recipes: Map<string, Recipe>
}

const CONTENT_WIDTH = PW - 2 * M
const dateStamp = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const RECIPE_SOFT: RGB = [0.98, 0.96, 0.94]
const RECIPE_TINT: RGB = [0.97, 0.92, 0.91]

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
    pdf.rect(0, 0, PW, 7, C.sales)
    pdf.y = 25
    pdf.text(M, pdf.y, business, { size: 10, bold: true, color: C.sales })
    const categoryLines = pdf.wrap(recipe.category.toUpperCase(), CONTENT_WIDTH - 24, 7.5)
    const categoryWidth = Math.max(24, ...categoryLines.map((line) => pdf.measureText(line, 7.5) + 24))
    const categoryHeight = Math.max(20, categoryLines.length * 9 + 10)
    pdf.roundRect(PW - M - categoryWidth, pdf.y - 5, categoryWidth, categoryHeight, 10, C.head)
    categoryLines.forEach((line, lineIndex) => pdf.text(PW - M - categoryWidth / 2, pdf.y + lineIndex * 9 + 1, line, { size: 7.5, color: C.muted, align: 'c' }))
    pdf.y += Math.max(22, categoryHeight + 7)

    const facts = [
      { label: 'RENDIMIENTO', value: `${formatNum(recipe.yieldQty)} ${recipe.yieldQty === 1 ? 'unidad' : 'unidades'}` },
      ...(recipe.portionsPerUnit > 1 ? [{ label: 'PORCIONES', value: `${formatNum(recipe.portionsPerUnit)} por unidad` }] : []),
      ...((recipe.activeMin + recipe.bakeMin + recipe.restMin) > 0 ? [{ label: 'TIEMPO TOTAL', value: `${formatNum(recipe.activeMin + recipe.bakeMin + recipe.restMin)} min` }] : []),
    ]
    if (recipe.imageDataUrl) {
      const dimensions = pdf.imageDimensions(recipe.imageDataUrl)
      const imageScale = Math.min(250 / dimensions.width, 180 / dimensions.height)
      const imageWidth = dimensions.width * imageScale, imageHeight = dimensions.height * imageScale
      const frameWidth = imageWidth + 8, frameHeight = imageHeight + 8
      const infoX = M + 8 + frameWidth + 12, infoWidth = PW - M - 8 - infoX
      const titleLines = pdf.wrap(recipe.name, infoWidth, 18, true)
      const descriptionLines = recipe.description ? pdf.wrap(recipe.description, infoWidth, 8.5) : []
      const detailsHeight = 12 + titleLines.length * 21 + (descriptionLines.length ? 7 + descriptionLines.length * 12 : 0) + facts.length * 17
      const heroHeight = Math.max(frameHeight + 16, detailsHeight + 12)
      pdf.ensure(heroHeight + 12)
      pdf.roundRect(M, pdf.y, CONTENT_WIDTH, heroHeight, 10, C.head)
      const frameY = pdf.y + (heroHeight - frameHeight) / 2
      pdf.roundRect(M + 8, frameY, frameWidth, frameHeight, 7, C.white)
      pdf.image(recipe.imageDataUrl, M + 12, frameY + 4, imageWidth, imageHeight)

      let detailsY = pdf.y + 12
      titleLines.forEach((line) => { pdf.text(infoX, detailsY, line, { size: 18, bold: true }); detailsY += 21 })
      if (descriptionLines.length) {
        detailsY += 2
        descriptionLines.forEach((line) => { pdf.text(infoX, detailsY, line, { size: 8.5, color: C.muted }); detailsY += 12 })
        detailsY += 5
      }
      facts.forEach((fact) => {
        pdf.roundRect(infoX, detailsY - 2, infoWidth, 14, 6, RECIPE_SOFT)
        pdf.text(infoX + 7, detailsY + 1, fact.label, { size: 6.5, bold: true, color: C.sales })
        pdf.text(infoX + infoWidth - 7, detailsY + 1, fact.value, { size: 7.5, bold: true, align: 'r' })
        detailsY += 17
      })
      pdf.y += heroHeight + 14
    } else {
      pdf.paragraph(recipe.name, { size: 25, bold: true, color: C.text, gap: 3 })
      if (recipe.description) pdf.paragraph(recipe.description, { size: 9.5, color: C.muted, gap: 10 })
      pdf.roundRect(M, pdf.y, CONTENT_WIDTH, 46, 8, C.head)
      const factWidth = CONTENT_WIDTH / facts.length
      facts.forEach((fact, factIndex) => {
        const x = M + factIndex * factWidth
        if (factIndex > 0) pdf.line(x, pdf.y + 9, x, pdf.y + 37, C.white, 1)
        pdf.text(x + 10, pdf.y + 9, fact.label, { size: 7, bold: true, color: C.sales })
        pdf.text(x + 10, pdf.y + 24, fact.value, { size: 9, bold: true })
      })
      pdf.y += 59
    }

    const section = (title: string, detail?: string) => {
      pdf.ensure(38)
      pdf.rect(M, pdf.y + 2, 3, 16, C.sales)
      pdf.text(M + 11, pdf.y, title, { size: 14, bold: true })
      if (detail) pdf.text(PW - M, pdf.y + 4, detail, { size: 8, color: C.muted, align: 'r' })
      pdf.y += 25
    }
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
    section('Ingredientes', `${ingredients.length} ${ingredients.length === 1 ? 'ingrediente' : 'ingredientes'}`)
    for (const [ingredientIndex, item] of ingredients.entries()) {
      const nameLines = pdf.wrap(item.name, CONTENT_WIDTH - 130, 9)
      const rowHeight = Math.max(23, nameLines.length * 12 + 10)
      pdf.ensure(rowHeight + 2)
      if (ingredientIndex % 2 === 0) pdf.roundRect(M, pdf.y - 5, CONTENT_WIDTH, rowHeight, 5, RECIPE_SOFT)
      nameLines.forEach((line, lineIndex) => pdf.text(M + 10, pdf.y + lineIndex * 12, line, { size: 9 }))
      if (item.amount) {
        pdf.roundRect(PW - M - 116, pdf.y - 3, 108, 18, 8, RECIPE_TINT)
        pdf.text(PW - M - 16, pdf.y + 1, item.amount, { size: 8, bold: true, color: C.sales, align: 'r' })
      }
      pdf.y += rowHeight
    }
    pdf.y += 9

    const steps = recipe.steps.split(/\r?\n/).map((step) => step.trim()).filter(Boolean)
    section('Preparación', `${steps.length} ${steps.length === 1 ? 'paso' : 'pasos'}`)
    if (steps.length === 0) pdf.paragraph('Sin pasos de preparación registrados.', { size: 9, color: C.muted })
    for (const [stepIndex, rawStep] of steps.entries()) {
      const step = rawStep.replace(/^\d+[.)]\s*/, '')
      const lines = pdf.wrap(step, CONTENT_WIDTH - 50, 9)
      const rowHeight = Math.max(30, lines.length * 13 + 13)
      pdf.ensure(rowHeight + 3)
      pdf.roundRect(M, pdf.y - 4, CONTENT_WIDTH, rowHeight, 7, RECIPE_SOFT)
      pdf.roundRect(M + 8, pdf.y + 2, 22, 19, 9, C.sales)
      pdf.text(M + 19, pdf.y + 7, `${stepIndex + 1}`, { size: 8, bold: true, color: C.white, align: 'c' })
      lines.forEach((line, lineIndex) => pdf.text(M + 40, pdf.y + 3 + lineIndex * 13, line, { size: 9 }))
      pdf.y += rowHeight + 4
    }
    if (recipe.notes) {
      pdf.y += 5
      section('Notas')
      const lines = pdf.wrap(recipe.notes, CONTENT_WIDTH - 24, 9)
      const noteHeight = Math.max(35, lines.length * 13 + 16)
      pdf.ensure(noteHeight + 2)
      pdf.roundRect(M, pdf.y - 4, CONTENT_WIDTH, noteHeight, 7, RECIPE_SOFT)
      lines.forEach((line, lineIndex) => pdf.text(M + 12, pdf.y + 5 + lineIndex * 13, line, { size: 9, color: C.muted }))
      pdf.y += noteHeight + 6
    }
  })

  return pdf.build(`${business} · Recetas`)
}
