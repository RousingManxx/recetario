import { createContext, useContext, useState, type ReactNode } from 'react'
import type { Customer, Expense, Ingredient, Order, Recipe, Tool } from '../domain/types'
import type { Data } from './data'
import { CustomerForm, ExpenseForm } from './forms/SimpleForms'
import { IngredientForm } from './forms/IngredientForm'
import { RecipeForm } from './forms/RecipeForm'
import { ToolForm } from './forms/ToolForm'
import { OrderSheet } from './forms/OrderSheet'

export type Sheet =
  | { k: 'ingredient'; v?: Ingredient } | { k: 'recipe'; v?: Recipe } | { k: 'order'; v?: Order; recipeId?: string }
  | { k: 'customer'; v?: Customer } | { k: 'expense'; v?: Expense } | { k: 'tool'; v?: Tool }

const Ctx = createContext<(s: Sheet) => void>(() => {})
export const useOpen = () => useContext(Ctx)

export function SheetHost({ data, children }: { data: Data; children: ReactNode }) {
  const [s, setS] = useState<Sheet | null>(null)
  const close = () => setS(null)
  return (
    <Ctx.Provider value={setS}>
      {children}
      {s?.k === 'ingredient' && <IngredientForm key={s.v?.id ?? 'new'} ingredient={s.v} onClose={close} />}
      {s?.k === 'recipe' && <RecipeForm key={s.v?.id ?? 'new'} recipe={s.v} data={data} onClose={close} />}
      {s?.k === 'order' && <OrderSheet key={s.v?.id ?? 'new'} order={s.v} presetRecipeId={s.recipeId} data={data} onClose={close} />}
      {s?.k === 'customer' && <CustomerForm customer={s.v} onClose={close} />}
      {s?.k === 'expense' && <ExpenseForm expense={s.v} onClose={close} />}
      {s?.k === 'tool' && <ToolForm key={s.v?.id ?? 'new'} tool={s.v} onClose={close} />}
    </Ctx.Provider>
  )
}
