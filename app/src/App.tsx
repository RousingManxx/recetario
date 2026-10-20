import { useEffect, useRef, useState } from 'react'
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Ajustes } from './pages/Ajustes'
import { Inicio } from './pages/Inicio'
import { Ingredientes } from './pages/Ingredientes'
import { Pedidos } from './pages/Pedidos'
import { Recetas } from './pages/Recetas'
import { Resumen } from './pages/Resumen'
import { SheetHost, useOpen } from './ui/create'
import { useData } from './ui/data'
import { Icon, UiProvider } from './ui/ui'

const TABS = [['/', 'Resumen', 'home'], ['/recetas', 'Recetas', 'cake'], ['/ingredientes', 'Ingredientes', 'jar'], ['/pedidos', 'Pedidos', 'bag'], ['/ajustes', 'Ajustes', 'gear']] as const

function PlusMenu() {
  const [openMenu, setOpenMenu] = useState(false)
  const open = useOpen()
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (openMenu) first.current?.focus() }, [openMenu])
  useEffect(() => {
    if (!openMenu) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpenMenu(false)
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [openMenu])
  const items = [['recipe', 'Nueva receta', 'cake'], ['ingredient', 'Nuevo ingrediente', 'jar'], ['order', 'Nuevo pedido', 'bag'], ['customer', 'Nuevo cliente', 'user'], ['expense', 'Nuevo gasto', 'coin']] as const
  return (
    <>
      <button className="plus glass" aria-label="Crear nuevo" aria-haspopup="menu" aria-expanded={openMenu} onClick={() => setOpenMenu(!openMenu)}><Icon n="plus" /></button>
      {openMenu && (
        <>
          <div className="scrim" onClick={() => setOpenMenu(false)} />
          <div className="menu glass" role="menu">
            {items.map(([k, l, ic], i) => (
              <button key={k} role="menuitem" ref={i === 0 ? first : undefined} onClick={() => { setOpenMenu(false); open({ k } as never) }}><Icon n={ic} size={20} />{l}</button>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function Shell() {
  const data = useData()
  const loc = useLocation()
  const nav = useNavigate()
  const redirected = useRef(false)
  const title = TABS.find(([p]) => p === loc.pathname)?.[1] ?? 'Guía de inicio'
  // Primera apertura: lleva al asistente una sola vez.
  useEffect(() => {
    if (data.ready && !redirected.current) {
      redirected.current = true
      if (!data.settings.onboardingDone && !data.settings.businessName && data.orders.length === 0 && data.recipes.length === 0) nav('/inicio', { replace: true })
    }
  }, [data.ready, data.settings, data.orders.length, data.recipes.length, nav])
  if (!data.ready) return <div className="main muted" role="status">Cargando…</div>
  return (
    <SheetHost data={data}>
      <div className="topbar"><PlusMenu /><div className="title">{title}</div></div>
      <div className="shell">
        <nav className="tabbar glass" aria-label="Navegación principal">
          {TABS.map(([to, l, ic]) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}><Icon n={ic} size={22} />{l}</NavLink>)}
        </nav>
        <main className="main">
          <div className="page" key={loc.pathname}>
          <Routes>
            <Route path="/" element={<Resumen data={data} />} />
            <Route path="/recetas" element={<Recetas data={data} />} />
            <Route path="/ingredientes" element={<Ingredientes data={data} />} />
            <Route path="/pedidos" element={<Pedidos data={data} />} />
            <Route path="/ajustes" element={<Ajustes data={data} />} />
            <Route path="/inicio" element={<Inicio data={data} />} />
            <Route path="*" element={<Resumen data={data} />} />
          </Routes>
          </div>
        </main>
      </div>
    </SheetHost>
  )
}

export default function App() {
  return <HashRouter><UiProvider><Shell /></UiProvider></HashRouter>
}
