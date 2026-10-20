import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Pide a iOS/navegador que no limpie los datos automáticamente (best-effort; no hay garantía).
try { navigator.storage?.persist?.() } catch { /* sin soporte */ }

// En la PWA instalada: bloquea el zoom por pellizco (gestos de Safari iOS). En el navegador de escritorio no se toca.
const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
if (standalone) for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
