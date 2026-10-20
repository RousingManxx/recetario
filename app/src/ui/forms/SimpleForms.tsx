import { useState } from 'react'
import { db, uid } from '../../db/db'
import { pesosToCents } from '../../domain/money'
import type { Customer, Expense } from '../../domain/types'
import { todayISO } from '../data'
import { Field, NumInput, Sheet, useUi } from '../ui'

export function CustomerForm({ customer, onClose, onSaved }: { customer?: Customer; onClose: () => void; onSaved?: (c: Customer) => void }) {
  const ui = useUi()
  const [name, setName] = useState(customer?.name ?? '')
  const [phone, setPhone] = useState(customer?.phone ?? '')
  const [email, setEmail] = useState(customer?.email ?? '')
  const [address, setAddress] = useState(customer?.address ?? '')
  const [notes, setNotes] = useState(customer?.notes ?? '')
  const [tried, setTried] = useState(false)
  const save = async () => {
    setTried(true)
    if (!name.trim()) return
    const c: Customer = { id: customer?.id ?? uid(), name: name.trim(), phone: phone.trim() || undefined, email: email.trim() || undefined, address: address.trim() || undefined, notes, createdAt: customer?.createdAt ?? new Date().toISOString(), demo: customer?.demo }
    await db.customers.put(c)
    if (customer && customer.name !== c.name) {
      // Mantiene coherente el nombre visible en pedidos abiertos; los confirmados conservan su texto original.
      await db.orders.where('customerId').equals(c.id).filter((o) => o.status === 'cotizacion').modify({ customerName: c.name })
    }
    ui.toast('Cliente guardado'); onSaved?.(c); onClose()
  }
  const remove = async () => {
    const n = await db.orders.where('customerId').equals(customer!.id).count()
    if (n) return ui.toast(`Tiene ${n} pedido(s); no se puede eliminar`, true)
    if (await ui.confirm(`Se eliminará a «${customer!.name}».`, 'Eliminar')) { await db.customers.delete(customer!.id); onClose() }
  }
  return (
    <Sheet title={customer ? 'Editar cliente' : 'Nuevo cliente'} onClose={onClose}
      footer={<>{customer && <button className="btn danger" onClick={remove}>Eliminar</button>}<button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={save}>Guardar</button></>}>
      <div className="stack">
        <Field label="Nombre" error={tried && !name.trim() ? 'Escribe un nombre' : undefined}><input value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-invalid={tried && !name.trim()} /></Field>
        <div className="grid2">
          <Field label="Teléfono"><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label="Correo"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        </div>
        <Field label="Dirección de entrega habitual"><input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <Field label="Preferencias y notas" hint="Alergias, sabores favoritos, fechas especiales…"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Sheet>
  )
}

export function ExpenseForm({ expense, onClose }: { expense?: Expense; onClose: () => void }) {
  const ui = useUi()
  const [concept, setConcept] = useState(expense?.concept ?? '')
  const [category, setCategory] = useState(expense?.category ?? 'Renta y servicios')
  const [amount, setAmount] = useState<number | undefined>(expense ? expense.amountCents / 100 : undefined)
  const [date, setDate] = useState(expense?.date ?? todayISO())
  const [fixed, setFixed] = useState(expense?.fixed ?? false)
  const [tried, setTried] = useState(false)
  const bad = !concept.trim() || amount === undefined || amount <= 0
  const save = async () => {
    setTried(true)
    if (bad) return
    await db.expenses.put({ id: expense?.id ?? uid(), concept: concept.trim(), category, amountCents: pesosToCents(amount!), date, fixed, demo: expense?.demo })
    ui.toast('Gasto guardado'); onClose()
  }
  return (
    <Sheet title={expense ? 'Editar gasto' : 'Nuevo gasto'} onClose={onClose}
      footer={<>{expense && <button className="btn danger" onClick={async () => { if (await ui.confirm('¿Eliminar este gasto?', 'Eliminar')) { await db.expenses.delete(expense.id); onClose() } }}>Eliminar</button>}<button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={save}>Guardar</button></>}>
      <div className="stack">
        <Field label="Concepto" error={tried && !concept.trim() ? 'Requerido' : undefined}><input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Gas del mes" autoFocus /></Field>
        <div className="grid2">
          <Field label="Monto (MXN)" error={tried && (amount === undefined || amount <= 0) ? 'Mayor que 0' : undefined}><NumInput value={amount} onChange={setAmount} /></Field>
          <Field label="Fecha"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Categoría"><select value={category} onChange={(e) => setCategory(e.target.value)}>{['Renta y servicios', 'Equipo y utensilios', 'Marketing', 'Transporte', 'Sueldos', 'Otros'].map((c) => <option key={c}>{c}</option>)}</select></Field>
        <label className="row"><input type="checkbox" style={{ width: 22, minHeight: 22 }} checked={fixed} onChange={(e) => setFixed(e.target.checked)} /> Es un gasto fijo (se repite cada mes)</label>
        <p className="small muted">Los gastos se restan de la ganancia neta del mes. No se suman al costo de las recetas, para evitar contarlos dos veces.</p>
      </div>
    </Sheet>
  )
}
