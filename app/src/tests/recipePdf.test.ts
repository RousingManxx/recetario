import { describe, expect, it } from 'vitest'
import type { Ingredient, Recipe } from '../domain/types'
import { recipePdf, recipePdfFileName } from '../domain/recipePdf'

const image = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWm5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwChRRRXnH6Gf//Z'

const recipe = (id: string, name: string, extra: Partial<Recipe> = {}): Recipe => ({
  id, name, category: 'Pasteles', kind: 'producto', description: 'Una receta deliciosa.', favorite: false,
  components: [{ ingredientId: 'flour', qty: 250, unit: 'g' }],
  yieldQty: 1, portionsPerUnit: 8, activeMin: 15, bakeMin: 30, restMin: 5,
  ingredientWastePct: 0, finishedWastePct: 0, laborMode: 'hora', laborRateCents: 0, laborOps: 1,
  energyMode: 'fijo', energyValue: 0, otherCents: 0, packagingCentsPerUnit: 0, commissionPct: 0,
  targetMarginPct: 60, steps: '1. Mezclar los ingredientes.\n2. Hornear hasta que esté listo.', notes: 'Servir frío.',
  updatedAt: '', ...extra,
})
const ingredients = new Map<string, Ingredient>([['flour', {
  id: 'flour', name: 'Harina', category: 'Abarrotes', costPerBase: 0, dimension: 'masa', priceUpdatedAt: '', createdAt: '',
}]])
const encoded = (text: string) => Array.from(text, (char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('')

describe('PDF de recetas', () => {
  it('genera un PDF descargable válido con la receta, la foto y los datos de cocina', () => {
    const bytes = recipePdf([recipe('r1', 'Pastel de piña', { imageDataUrl: image })], {
      businessName: 'Dulce Rosa', ingredients, recipes: new Map(),
    })
    const pdf = new TextDecoder().decode(bytes)
    expect(pdf.startsWith('%PDF-1.4')).toBe(true)
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(pdf).toContain('/Subtype /Image')
    expect(pdf).toContain('/Filter [/ASCIIHexDecode /DCTDecode]')
    expect(pdf).toContain('/Im1 Do')
    expect(pdf).toContain('/Count 1')
    expect(pdf).toContain('startxref')
    for (const stream of pdf.matchAll(/\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) expect(stream[2].length).toBe(Number(stream[1]))
  })

  it('coloca el separador de ingredientes debajo del texto', () => {
    const pdf = new TextDecoder().decode(recipePdf([recipe('r1', 'Pastel')], {
      businessName: '', ingredients, recipes: new Map(),
    }))
    const nameToken = `<${encoded('Harina')}> Tj ET`
    const nameIndex = pdf.indexOf(nameToken)
    expect(nameIndex).toBeGreaterThan(-1)
    const textOperation = pdf.slice(pdf.lastIndexOf('BT ', nameIndex), nameIndex)
    const textY = Number(textOperation.match(/([\d.]+) ([\d.]+) Td/)?.[2])
    const dividerY = Number(pdf.slice(nameIndex).match(/[\d.]+ ([\d.]+) m [\d.]+ [\d.]+ l S/)?.[1])
    expect(textY - dividerY).toBeGreaterThan(5)
  })

  it('crea un PDF con una página por receta y admite referencias a recetas componentes', () => {
    const base = recipe('base', 'Base')
    const composite = recipe('compuesta', 'Pastel compuesto', { components: [], recipeComponents: [{ recipeId: base.id, qty: 2 }] })
    const pdf = new TextDecoder().decode(recipePdf([base, composite], {
      businessName: '', ingredients, recipes: new Map([[base.id, base]]),
    }))
    expect(pdf).toContain('/Count 2')
    expect(pdf).toContain(encoded('2 unidad(es)'))
    expect(recipePdfFileName([recipe('r1', 'Pastel de piña')], new Date(2026, 10, 18))).toBe('receta-pastel-de-pina_2026-11-18.pdf')
    expect(recipePdfFileName([base, composite], new Date(2026, 10, 18))).toBe('recetas_2026-11-18.pdf')
  })

  it('rechaza una imagen que no sea JPEG válido y la interfaz puede informar el error', () => {
    expect(() => recipePdf([recipe('r1', 'Foto no válida', { imageDataUrl: 'data:image/jpeg;base64,bm90IGEgSlBFRw==' })], {
      businessName: '', ingredients, recipes: new Map(),
    })).toThrow(/JPEG válido/)
  })
})
