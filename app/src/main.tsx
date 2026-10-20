import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Pide a iOS/navegador que no limpie los datos automáticamente (best-effort; no hay garantía).
try { navigator.storage?.persist?.() } catch { /* sin soporte */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
