// E2E: creación, recosteo dinámico y pedido de una receta compuesta (vite preview en :4173).
import { chromium } from 'playwright-core'

const log = (m) => console.log('✔', m)
const expect = (condition, message) => { if (!condition) throw new Error('FALLÓ: ' + message); log(message) }
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-MX' })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const URL = 'http://localhost:4173/'
const sheet = page.locator('[role=dialog]').last()

try {
  await page.goto(URL)
  await page.waitForURL(/#\/inicio/)
  await page.goto(URL + '#/recetas')

  const createSource = async (name) => {
    await page.getByRole('button', { name: '+ Nueva receta' }).click()
    expect(await sheet.getByRole('button', { name: '+ Agregar receta componente' }).count() === 0, 'Una receta nueva normal no muestra el control de componentes')
    await sheet.getByPlaceholder('Pastel de chocolate').fill(name)
    await sheet.getByLabel('Categoría').selectOption({ label: 'Tartas' })
    await sheet.getByRole('tab', { name: '2 · Costos' }).click()
    await sheet.getByLabel('Método').first().selectOption('operacion')
    await sheet.getByLabel('Costo por operación (MXN)').fill('20')
    await sheet.getByRole('tab', { name: '1 · Receta' }).click()
    await sheet.getByRole('button', { name: 'Guardar receta' }).click()
  }
  await createSource('Base de tarta (galleta)')
  await createSource('Relleno de limón de tarta')
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Combinar recetas' && !b.disabled))
  expect(await page.getByRole('button', { name: 'Combinar recetas' }).isEnabled(), 'El botón de combinar está disponible con dos recetas')

  await page.getByRole('button', { name: 'Combinar recetas' }).click()
  expect(await sheet.getByRole('button', { name: '+ Agregar receta componente' }).count() === 1, 'El flujo de combinar sí permite agregar recetas componentes')
  await sheet.getByPlaceholder('Pastel de chocolate').fill('Tarta de limón')
  await sheet.getByLabel('Categoría').selectOption({ label: 'Tartas' })
  await sheet.getByRole('button', { name: '+ Agregar receta componente' }).click()
  await sheet.getByRole('button', { name: '+ Agregar receta componente' }).click()
  const componentSelects = sheet.getByLabel('Receta componente', { exact: true })
  const selectedComponents = [
    await componentSelects.nth(0).locator('option:checked').textContent(),
    await componentSelects.nth(1).locator('option:checked').textContent(),
  ]
  expect(selectedComponents.includes('Base de tarta (galleta)') && selectedComponents.includes('Relleno de limón de tarta'), 'Se seleccionaron ambas recetas originales')
  await sheet.getByLabel('Unidades de receta').nth(0).fill('1')
  await sheet.getByLabel('Unidades de receta').nth(1).fill('1')
  await sheet.getByLabel('Unidades por tanda').fill('1')
  expect(await componentSelects.count() === 2, 'Las dos recetas componentes se ven antes de guardar')

  await sheet.getByRole('tab', { name: '3 · Precio' }).click()
  expect(await sheet.getByText('Recomendado: $100.00').count() === 1, 'El costo de $40 de los componentes produce precio recomendado de $100')
  await sheet.getByRole('button', { name: /Usar precio recomendado/ }).click()
  const priceRows = sheet.getByText('Precio de venta', { exact: true })
  expect(await priceRows.count() === 2, 'El precio aparece en el cálculo superior y en el resumen')
  expect((await priceRows.nth(1).locator('..').innerText()).includes('$100.00'), 'El resumen coincide exactamente con el precio de venta calculado')
  await sheet.getByRole('button', { name: 'Guardar receta' }).click()
  const savedComposite = page.locator('.item').filter({ hasText: 'Tarta de limón' })
  await savedComposite.waitFor()
  expect(await savedComposite.count() === 1, 'La receta compuesta se guardó')
  expect(await page.locator('.item').filter({ hasText: 'Base de tarta (galleta)' }).count() === 1
    && await page.locator('.item').filter({ hasText: 'Relleno de limón de tarta' }).count() === 1, 'Las recetas originales se conservaron')

  const updateSource = async (name, rate) => {
    await page.locator('.item').filter({ hasText: name }).click()
    await sheet.getByRole('tab', { name: '2 · Costos' }).click()
    await sheet.getByLabel('Costo por operación (MXN)').fill(String(rate))
    await sheet.getByRole('tab', { name: '1 · Receta' }).click()
    await sheet.getByRole('button', { name: 'Guardar receta' }).click()
  }
  await updateSource('Base de tarta (galleta)', 40)
  const composedRow = page.locator('.item').filter({ hasText: 'Tarta de limón' })
  await page.getByText('Costo $60.00').waitFor()
  expect((await composedRow.innerText()).includes('Costo $60.00'), 'Editar un componente actualiza dinámicamente el costo compuesto')

  await page.goto(URL + '#/pedidos')
  await page.getByRole('button', { name: /Nuevo/ }).click()
  await sheet.getByRole('button', { name: '+ Nuevo' }).click()
  const customerSheet = page.locator('[role=dialog]').last()
  await customerSheet.getByLabel('Nombre', { exact: true }).fill('Ana Test')
  await customerSheet.getByRole('button', { name: 'Guardar' }).click()
  const product = sheet.getByLabel('Agregar producto')
  const productValue = await product.locator('option').filter({ hasText: 'Tarta de limón' }).getAttribute('value')
  await product.selectOption(productValue)
  await sheet.getByLabel('Cantidad').fill('20')
  await sheet.getByRole('button', { name: 'Guardar', exact: true }).click()
  const quoteRow = page.locator('.item').filter({ hasText: 'Ana Test' })
  await quoteRow.waitFor()
  expect((await quoteRow.innerText()).includes('$2,000.00'), 'La cotización inicial multiplica el precio de receta por las 20 unidades')

  await page.goto(URL + '#/recetas')
  await page.locator('.item').filter({ hasText: 'Tarta de limón' }).click()
  await sheet.getByRole('tab', { name: '3 · Precio' }).click()
  await sheet.getByLabel('Tu precio por unidad (MXN)').fill('150')
  await sheet.getByRole('button', { name: 'Guardar receta' }).click()
  await page.goto(URL + '#/pedidos')
  await page.waitForFunction(() => [...document.querySelectorAll('.item')].some((item) => item.textContent?.includes('Ana Test') && item.textContent.includes('$3,000.00')))
  expect((await quoteRow.innerText()).includes('$3,000.00'), 'La cotización de 20 unidades se actualiza al cambiar el precio de la receta')
  await quoteRow.click()
  expect(await sheet.getByLabel('Precio unitario (MXN)').inputValue() === '150', 'La cotización abierta muestra el precio actualizado de la receta')
  const marginCheckbox = sheet.getByLabel('Aplicar margen al pedido')
  const checkboxBounds = await marginCheckbox.boundingBox()
  expect(checkboxBounds.width <= 24 && checkboxBounds.height <= 24, 'El selector de margen mantiene el tamaño compacto de los demás checkboxes')
  await marginCheckbox.check()
  await sheet.getByLabel('Margen de ganancia sobre venta (%)').fill('30')
  expect(await sheet.getByLabel('Precio unitario (MXN)').inputValue() === '85.71', 'El margen propio del 30 % calcula el precio sobre costo y comisión vigentes')
  expect(await sheet.getByLabel('Precio unitario (MXN)').isDisabled(), 'El margen del pedido controla el precio de todas las líneas')
  expect((await sheet.innerText()).includes('$1,714.20'), 'El precio con margen se multiplica por las 20 unidades sin cambiar su costo unitario')
  await sheet.getByRole('button', { name: 'Confirmar pedido' }).click()
  await sheet.getByText('Confirmado', { exact: true }).waitFor()
  expect(await sheet.getByLabel('Precio unitario (MXN)').inputValue() === '85.71', 'Al confirmar se conserva el precio calculado con margen del pedido')
  expect((await sheet.innerText()).includes('Costo unitario (congelado): $60.00'), 'El pedido toma y congela el costo actual de la receta compuesta')
  await sheet.getByRole('button', { name: 'Cerrar', exact: true }).click()

  await page.goto(URL + '#/recetas')
  await updateSource('Base de tarta (galleta)', 50)
  await page.goto(URL + '#/pedidos')
  await page.getByText('Ana Test').click()
  expect((await sheet.innerText()).includes('Costo unitario (congelado): $60.00'), 'El pedido confirmado conserva su costo aunque cambie la receta fuente')
  await sheet.getByRole('button', { name: 'Eliminar pedido', exact: true }).click()
  await page.getByRole('button', { name: 'Eliminar pedido definitivamente' }).click()
  await page.locator('.item').filter({ hasText: 'PED-0001' }).waitFor({ state: 'detached' })
  expect(true, 'El pedido confirmado se eliminó definitivamente')
  expect(errors.length === 0, `Sin errores de consola${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}
