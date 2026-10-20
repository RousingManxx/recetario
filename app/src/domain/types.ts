// Dinero: enteros en centavos MXN. Costos unitarios de ingredientes: centavos por unidad base (float).
export type Unit = 'g' | 'kg' | 'ml' | 'l' | 'cda' | 'cdta' | 'taza' | 'pza' | 'docena'
export type Dimension = 'masa' | 'volumen' | 'pieza'

export interface Flagged { demo?: boolean }

export interface Ingredient extends Flagged {
  id: string
  name: string
  category: string
  supplier?: string
  brand?: string
  /** Costo vigente en centavos por unidad base (g, ml o pza). */
  costPerBase: number
  dimension: Dimension
  /** Densidad g/ml opcional, solo si el usuario la declara. */
  density?: number
  priceUpdatedAt: string
  stock?: number // en unidad base
  minStock?: number
  expiresAt?: string
  createdAt: string
}

export interface Purchase extends Flagged {
  id: string
  ingredientId: string
  date: string
  /** Momento exacto del registro; desempata compras del mismo día. */
  at?: string
  qty: number
  unit: Unit
  /** Precio pagado por la presentación, en centavos. */
  priceCents: number
  discountCents: number
  extraCents: number
  presentation?: string
}

export interface RecipeComponent { ingredientId: string; qty: number; unit: Unit }

export type RecipeKind = 'producto' | 'pastel' | 'porcion' | 'caja' | 'paquete' | 'personalizado'
export type LaborMode = 'hora' | 'minuto' | 'operacion'
export type EnergyMode = 'fijo' | 'porcentaje' | 'tarifa'

export interface Recipe extends Flagged {
  id: string
  name: string
  category: string
  kind: RecipeKind
  description: string
  favorite: boolean
  components: RecipeComponent[]
  /** Unidades producidas por tanda (p. ej. 1 pastel o 24 galletas). */
  yieldQty: number
  /** Rendimiento real observado (opcional). */
  realYield?: number
  /** Porciones en que se divide cada unidad (p. ej. 8 rebanadas). */
  portionsPerUnit: number
  activeMin: number
  bakeMin: number
  restMin: number
  totalMin?: number
  ingredientWastePct: number
  finishedWastePct: number
  laborMode: LaborMode
  /** hora/minuto: centavos por hora o minuto; operacion: centavos por operación. */
  laborRateCents: number
  laborOps: number
  energyMode: EnergyMode
  /** fijo: centavos por tanda; porcentaje: % del costo de ingredientes; tarifa: centavos por hora de horno. */
  energyValue: number
  otherCents: number
  packagingCentsPerUnit: number
  commissionPct: number
  targetMarginPct: number
  /** Precio manual por unidad, en centavos. */
  priceCents?: number
  steps: string
  notes: string
  updatedAt: string
}

export interface Customer extends Flagged {
  id: string
  name: string
  phone?: string
  email?: string
  address?: string
  notes: string
  createdAt: string
}

export type OrderStatus = 'cotizacion' | 'confirmado' | 'preparacion' | 'listo' | 'entregado' | 'cancelado'
export type PaymentMethod = 'efectivo' | 'transferencia' | 'tarjeta' | 'otro'
export type PaymentStatus = 'sin_pago' | 'anticipo' | 'parcial' | 'pagado' | 'reembolsado'

export interface CostShares { ingredients: number; labor: number; energy: number; packaging: number; other: number }

export interface OrderLine {
  id: string
  recipeId: string
  name: string
  qty: number
  unitPriceCents: number
  /** Costo unitario congelado. En cotización se refresca; al confirmar queda fijo. */
  unitCostCents: number
  commissionPct: number
  /** Fracción del costo unitario por rubro (suma 1), congelada junto con el costo. Opcional: pedidos anteriores no la tienen. */
  costShares?: CostShares
  customization: string
}

export interface Payment {
  id: string
  date: string
  amountCents: number // negativo = reembolso
  method: PaymentMethod
  note?: string
}

export interface CostAdjustment { id: string; date: string; amountCents: number; note: string }

export interface Order extends Flagged {
  id: string
  folio: string
  customerId?: string
  customerName: string
  createdAt: string
  deliveryAt: string
  status: OrderStatus
  lines: OrderLine[]
  discountCents: number
  deliveryFeeCents: number
  payments: Payment[]
  adjustments: CostAdjustment[]
  message: string
  deliveryAddress?: string
  notes: string
  confirmedAt?: string
}

export interface Expense extends Flagged {
  id: string
  date: string
  concept: string
  category: string
  amountCents: number
  fixed: boolean
}

export interface Settings {
  id: 'main'
  businessName: string
  currency: 'MXN'
  locale: 'es-MX'
  nextFolio: number
  defaultLaborMode: LaborMode
  defaultLaborRateCents: number
  defaultMarginPct: number
  staleDays: number
  onboarding: Record<string, boolean>
  onboardingDone: boolean
  lastBackupAt?: string
  demoLoaded: boolean
}
