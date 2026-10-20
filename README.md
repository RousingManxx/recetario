# Recetario — gestión de pastelería (Web + iPhone)

PWA *local-first* en español (MXN). Recetas, ingredientes, costos reales, precios/márgenes, pedidos, clientes,
gastos, resumen, guía de inicio, exportación CSV y respaldo/restauración JSON. Código en `app/`.

## Ejecutar

```powershell
cd app
npm install
npm run dev          # desarrollo: http://localhost:5173
npm test             # 37 pruebas unitarias/persistencia (Vitest)
npm run build        # producción en app/dist
npx vite preview --port 4173 ; npm run e2e   # E2E con Edge (Playwright) sobre el build
```

## Instalar en tu iPhone (desde Windows, sin Mac)

Estado real: **la instalación en iPhone no se ha probado** (no hay iPhone/Safari iOS en este entorno).
El procedimiento es estándar de PWA y es el único que no necesita Mac, Xcode ni cuenta de Apple:

1. Publica `app/dist` en un hosting **HTTPS** estático gratuito (Cloudflare Pages, Netlify, GitHub Pages…).
   Es una web estática: no hay servidor ni claves. (Con `http://IP-local:5173` solo sirve para ver la interfaz.)
2. En el iPhone abre la URL en **Safari** → Compartir → **Añadir a pantalla de inicio**.
3. Se abre a pantalla completa y funciona sin conexión.

Importante en iOS: los datos viven en el almacenamiento del navegador de **ese** dispositivo. Instalada en la
pantalla de inicio, iOS no los purga por inactividad (en una pestaña normal de Safari sí puede, tras ~7 días sin uso).
**Haz copias JSON periódicas** (Ajustes → Copia de seguridad); es también la vía para pasar los datos de un dispositivo a otro.

### App nativa con xtool (fase siguiente, pendiente)
xtool compila SwiftPM → .ipa desde Windows vía WSL2 + usbipd. En este equipo **WSL no tiene distribución instalada**
(requiere instalar WSL2/Ubuntu, posible reinicio), además de Swift, un Xcode.xip descargado con Apple ID y firma
(cuenta gratuita: la app caduca a los 7 días). Plan: un contenedor SwiftUI con `WKWebView` que cargue esta PWA empaquetada,
para tener un `.app` real; Liquid Glass nativo exigiría reescribir la UI en SwiftUI y añadir sincronización (ver abajo).
No se ha iniciado.

## Arquitectura

- **Vite + React + TypeScript**, rutas con `HashRouter` (hosting estático sin reglas de reescritura).
- **IndexedDB (Dexie)** como base de datos real; `useLiveQuery` mantiene la UI reactiva.
- **`src/domain/`**: lógica pura sin UI, toda cubierta por pruebas: `units`, `costing`, `pricing`, `orders`,
  `dashboard`, `backup` (validación/migración/fusión), `csv`, `money`.
- **`src/db/`**: persistencia, transacciones (compras, folios, restauración atómica), datos demo.
- **`src/ui`, `src/pages`**: componentes, formularios y pantallas. Tokens de diseño en `index.css`
  (crema/rosa empolvado/cacao, modo oscuro, `backdrop-filter` para el «vidrio» web, respeta
  `prefers-reduced-transparency`/`reduced-motion`, áreas seguras de iOS).

### Decisiones de cálculo
- **Dinero** en centavos enteros; costos unitarios de ingrediente en centavos por g/ml/pza (float) y se **redondean
  half-up solo al calcular totales** (tanda, línea de pedido). Los totales se suman como enteros.
- **Unidades**: masa (g, kg), volumen (ml, l, cda, cdta, taza), pieza (pza, docena). Sin conversión g↔ml salvo que el
  ingrediente declare una densidad; pieza nunca se convierte.
- **Costo de receta** = ingredientes (+merma %) + mano de obra (hora/minuto/operación) + energía (fija / % de ingredientes /
  tarifa por hora de horno: **un solo método**, sin duplicar) + otros + empaque; la merma del terminado reduce unidades vendibles.
- **Margen** = ganancia/precio; **recargo** = ganancia/costo; **precio** = costo / (1 − margen − comisión%). Valida ≥100 %.
- **Costos históricos**: una cotización usa costos vigentes; al **confirmar** cada línea congela precio, costo y comisión.
  Cambios posteriores en ingredientes/recetas no alteran el pedido. Ajustes de costo y pagos/reembolsos se añaden sin sobrescribir.
- Estado del pedido y estado de pago son independientes (el de pago se deriva de los pagos).
- **Resumen**: ventas (confirmados), cobrado, costos estimados, gastos y ganancias se muestran por separado y rotuladas como estimadas.
- Gastos fijos **no** se reparten en el costo de recetas (evita doble conteo); se restan en la ganancia neta del periodo.

### Respaldo
JSON `recetasapp-backup`, `schemaVersion: 1`, con tablas e ids estables. Importar valida estructura, versión
(las más nuevas se rechazan; hay tabla de migraciones para las anteriores), ids duplicados y referencias; muestra resumen;
permite **combinar** (conserva lo local) o **reemplazar** (con confirmación); se ejecuta en **una transacción** (si falla, nada cambia).
Los datos demo (marcados `demo`) no entran a copias ni CSV. CSV: UTF-8 con BOM, coma o punto y coma, ids para relacionar archivos,
protección contra inyección de fórmulas.

### Sincronización (no implementada)
Hoy **no hay sincronización**: iPhone y navegador de escritorio tienen bases de datos independientes; se mueven datos con el respaldo JSON.
Diseño previsto: backend con autenticación (p. ej. Supabase/Postgres + RLS por usuario, TLS), `updatedAt`/versión por registro y
fusión por registro (el más reciente gana, pedidos confirmados inmutables salvo pagos/ajustes, que se anexan y no entran en conflicto).
Los ids ya son UUID estables para facilitar esa transición.

## Verificación realizada
| Qué | Resultado |
|---|---|
| Pruebas unitarias y de persistencia (`npm test`) | 37 pasan (con `TZ=America/Mexico_City`) |
| Build de producción + service worker | OK |
| E2E en Edge (móvil 390 px y escritorio 1280 px) | 21 verificaciones: onboarding → ingredientes → receta ($102.00, precio $255.00) → pedido, anticipo y saldo → costo histórico congelado → resumen → JSON/CSV → borrar todo → restaurar → archivo inválido → persistencia tras recargar; sin errores de consola |
| Safari iOS / iPhone físico / instalación PWA | **No probado** |
| Accesibilidad | Parcial: etiquetas, foco, `aria`, contraste cuidado; **sin auditoría formal** (axe/VoiceOver) |
| Rendimiento | Bundle 140 kB gzip; sin medición en dispositivo |

## Pendiente / limitaciones conocidas
- Sincronización entre dispositivos; app nativa (xtool); Liquid Glass nativo de iOS.
- Fotografía de recetas, sub-recetas (receta dentro de receta), inventario con descuento automático por pedido
  (hay campos de existencia/mínimo/caducidad pero **sin** descuento ni alertas de stock), reportes de rentabilidad por periodo.
- Impuestos no modelados (se decidió no asumir tasas); el precio es el que cobras.
- Sin pruebas automáticas de componentes ni de accesibilidad; el E2E cubre el flujo principal, no cada filtro.
- Las cotizaciones guardadas muestran el costo del momento en que se agregó cada producto; se refresca con las recetas vigentes
  al **confirmar** (`refreshQuote` existe en el dominio pero aún no se invoca al abrir una cotización).
