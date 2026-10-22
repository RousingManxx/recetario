# Respaldo en Google Drive

Estado: publicado en la versión 1.3.0 (ver `CHANGELOG.md`). Opcional: si el despliegue no define `VITE_GOOGLE_CLIENT_ID`, la sección no aparece y la app funciona igual que antes.

## Qué hace (y qué no)
- Sube la **misma copia JSON** del respaldo manual (`createBackup`) a **un solo archivo** en el «Mi unidad» del usuario, con nombre fijo `recetario-<nombre>.json` (se asigna al crearlo y no cambia). Siempre se actualiza ese archivo (se guarda su `fileId`; Drive permite nombres duplicados, por eso no se busca solo por nombre).
- Al abrir la app y al volver a ella compara con Drive **sin descargar** (solo metadatos: `version`, `modifiedTime`, `appProperties`) y avisa si hay una versión más nueva.
- **No es sincronización en vivo ni fusiona sola.** Si Drive y el dispositivo difieren, el usuario decide. Drive guarda además el historial de versiones del archivo (clic derecho → Administrar versiones).
- Los datos de demostración no se respaldan (igual que en la copia manual).

## Cómo decide (por dispositivo)
Cada dispositivo guarda en `localStorage` (clave `recetario.drive`): `deviceId`, `enabled`, `fileId`, `version` (la de Drive que ya conoce), `dirty` (hay cambios locales sin subir), `lastSyncAt` y `blocked` (motivo por el que se dejó de intentar). El estado no viaja en la copia. El archivo se identifica en Drive por la propiedad `app=recetario`.

| Drive vs. este dispositivo | Datos propios | `dirty` | Estado | Qué ocurre |
|---|---|---|---|---|
| No hay archivo | con datos | — | `none` | Se crea y se sube |
| No hay archivo | sin datos | — | `none` | No se crea nada (no se sube un archivo vacío) |
| Hay archivo | **sin datos** | — | `remote-newer` | Aviso: *Traer la copia de Drive* (nunca sube) |
| Misma versión | con datos | no | `in-sync` | Nada |
| Misma versión | con datos | sí | `local-ahead` | Se sube (actualiza el mismo archivo) |
| Drive más nueva | con datos | no | `remote-newer` | Aviso: *Traer la copia de Drive* (usa «reemplazar»; no hay nada local que perder) |
| Drive más nueva | con datos | sí | `conflict` | Aviso: *Combinar* / *Subir la mía* / *Usar la de Drive* |
| Dispositivo nuevo con datos y archivo existente | con datos | sí | `conflict` | Igual: no pisa nada a ciegas |

- **Sin datos propios** = ninguna receta, ingrediente, compra, cliente, pedido, gasto ni herramienta reales. Es lo que evita que un dispositivo nuevo, o uno tras «Zona delicada → Borrar todos los datos», suba una copia vacía encima de la de Drive.
- Antes de subir se relee la versión de Drive; si cambió desde la última conocida **no se sobrescribe** (control optimista). Solo «Subir la mía» fuerza la subida.
- *Combinar* conserva lo local y agrega lo que falta (gana lo local ante un mismo id). **No propaga ediciones** de registros que ya existen.
- *Usar la de Drive* con cambios locales descarga antes una copia de lo local.
- Las subidas automáticas no cuentan como «última copia» manual (`createBackup(d, { touch: false })`).

## Cuándo sube
Un minuto después del **último** cambio (se reinicia con cada cambio), al salir de la app con cambios pendientes, al volver a primer plano, al recuperar conexión y con *Sincronizar ahora*. Los cambios se detectan con ganchos de Dexie (`AppDB.onChange`, todas las tablas). No hay Background Sync (no existe en iOS).

## Autorización de Google y por qué pide renovar
- Google Identity Services (flujo de navegador), alcance **`drive.file`** (no sensible): la app solo ve el archivo que ella crea. No hay servidor ni «client secret».
- El acceso dura **~1 hora** y sin servidor propio **no existe refresh token**. Renovarlo abre una ventana de Google que se cierra sola si ya diste permiso, pero **el navegador la bloquea si no nace de un clic** (`popup_failed_to_open`). Como la subida automática no viene de un clic, suele fallar y la app muestra «Google Drive necesita renovar el acceso…».
- **Mitigación:** mientras se necesite renovar, el **siguiente clic o toque en cualquier parte de la app** lo renueva y se reanuda la sincronización; el aviso también es un botón. Los cambios quedan pendientes: no se pierde nada. Un intento por cada ciclo fallido.
- **Solución de fondo (no implementada):** un backend mínimo (Cloudflare Worker gratis u Orange Pi) que guarde el secreto y renueve con refresh token (flujo de código).

## Si se revoca, elimina o se desconfigura el Client ID
**Síntomas.** Google muestra su propia pantalla de error (`invalid_client`, `deleted_client`, `unauthorized_client`, `origin_mismatch`…) o responde con uno de esos errores a la app.

**Qué hace la app (probado en `e2e/drive.mjs` y `src/tests/drive.test.ts`):**
- Clasifica el error (`isBlockingGoogleError`): solo los que invalidan la aplicación **bloquean**; que el usuario cierre la ventana o rechace el permiso (`popup_closed`, `access_denied`) no bloquea.
- Al bloquear **deja de intentar sola** (no abre ventanas ni hace peticiones a Drive) y lo recuerda en `recetario.drive.blocked`, así que no insiste en cada apertura.
- Muestra un aviso global («El respaldo en Google Drive está inhabilitado…») y, en Ajustes, el motivo y el botón **Reintentar**.
- **Los datos locales no se tocan**: la app sigue funcionando, los cambios quedan marcados como pendientes y las copias manuales (*Descargar copia*) siguen disponibles.
- Si tras dos intentos con clic Google no completa la conexión sin dar un error explícito, el aviso orienta sobre una posible aplicación revocada.
- «Reintentar» vuelve a pedir acceso; si Google ya acepta la aplicación, queda conectada y respalda. Desconectar limpia el bloqueo.
- Quitar `VITE_GOOGLE_CLIENT_ID` de la compilación oculta la sección por completo.

**Qué pasa con los archivos de los usuarios.** Siguen en su Drive y no se borran. El acceso `drive.file` está ligado a la aplicación de Google Cloud que los creó: con un Client ID **de otro proyecto** la app puede no ver el archivo anterior y crearía uno nuevo; el viejo se recupera descargándolo desde Drive y usando *Restaurar* en Ajustes. Crear un cliente nuevo **dentro del mismo proyecto** debería conservar el acceso, pero conviene verificarlo antes de depender de ello.

**Cómo recuperarse.** Crear un Client ID nuevo (pasos de abajo), actualizar la variable del repositorio `GOOGLE_CLIENT_ID`, volver a publicar y pedir a los usuarios que toquen **Reintentar**. Mientras tanto nadie pierde datos.

## Configuración en Google Cloud (una vez por despliegue)
1. Proyecto propio de Recetario (cuenta personal) → habilitar **Google Drive API**.
2. **Google Auth Platform → Branding:** nombre `Recetario`, correos de asistencia y contacto, **página principal** (`https://<usuario>.github.io/recetario/`) y **política de privacidad** (`…/recetario/privacidad.html`, página incluida en la app). Sin esas URLs Google no deja publicar.
3. **Acceso a los datos:** agregar el alcance `…/auth/drive.file`.
4. **Público:** externo → **Publicar aplicación** (En producción). En «Pruebas» solo entran los testers y el consentimiento caduca a los 7 días.
5. **Clientes → Crear cliente → Aplicación web.** Orígenes autorizados de JavaScript (solo origen, sin ruta ni barra final): `https://<usuario>.github.io` y, para desarrollo, `http://localhost:5173`. Sin URI de redirección.
6. Copiar el **ID de cliente** (público; no es secreto). Nunca uses ni guardes el «secreto del cliente»: este flujo no lo necesita.
7. Local: `app/.env.local` con `VITE_GOOGLE_CLIENT_ID=<id>` (Git lo ignora por `*.local`). Producción: variable del repositorio `GOOGLE_CLIENT_ID` (Settings → Secrets and variables → Actions → Variables); `.github/workflows/deploy.yml` la pasa como `VITE_GOOGLE_CLIENT_ID` al compilar.
- Costo: $0 (sin facturación). Los cambios de orígenes pueden tardar de minutos a horas en aplicarse (`origin_mismatch` mientras tanto).
- **Mismo origen que otras apps:** todos los sitios de `<usuario>.github.io` comparten origen (y por tanto almacenamiento del navegador). Recetario usa la base `recetasapp` y la clave `recetario.drive`, que no chocan con otras apps.

## Probar
- `npm test` (`src/tests/drive.test.ts`, 17 pruebas): Drive simulado en memoria; cubre nombre fijo, actualizar el mismo archivo, conflicto, aviso, traer/combinar/reemplazar, dispositivo vacío, «borrar todo», recrear archivo borrado, errores (sin conexión, 401, 403, token), archivo dañado y Client ID revocado.
- E2E con Google y Drive **simulados** (no toca ninguna cuenta real), 28 comprobaciones: compilar con un ID cualquiera, servir y ejecutar.
  ```powershell
  cd app
  $env:VITE_GOOGLE_CLIENT_ID='prueba.apps.googleusercontent.com'; npx vite build
  npx vite preview --port 4173      # en otra terminal
  node e2e/drive.mjs
  ```
  Cubre dos dispositivos, conflicto, dispositivo vacío, «borrar todo», Client ID revocado (y reintento) y la renovación con un clic. Nota: Playwright ejecuta sus consultas como un gesto del usuario; por eso el guion espera pasivamente en el escenario de renovación.
- A mano con Google real (`npm run dev`): Ajustes → Conectar → ver el archivo en Drive → cambiar algo → esperar ~1 min o *Sincronizar ahora* → una sola copia con varias versiones.

## Solución de problemas
| Síntoma | Causa y salida |
|---|---|
| `origin_mismatch` / Error 400 | El origen no está en el cliente OAuth (o Google aún no lo aplica). Revisar escritura exacta; esperar. |
| «Google no ha verificado esta app» | Normal sin verificación: Avanzado → Ir a Recetario. Con `drive.file` no se exige verificación. |
| Pide renovar el acceso seguido | Esperado cada hora. Tocar cualquier parte de la app. |
| «Respaldo en Drive inhabilitado» | Google rechazó la aplicación: ver «Si se revoca…». |
| No aparece la sección de Drive | Falta `VITE_GOOGLE_CLIENT_ID` en la compilación. |
| «hay cambios por subir» | Se sube 1 min después del último cambio; usar *Sincronizar ahora* para forzar. |
| Aviso «Hay una copia de tu pastelería en Google Drive» en un dispositivo vacío | Por diseño: ofrece traerla en lugar de subir una vacía. |

## Seguridad y privacidad
- El archivo es **JSON legible** (recetas, costos, pedidos y clientes). Protege la cuenta de Google. El cifrado con contraseña queda para una versión futura.
- El token vive solo en memoria del navegador. La política de privacidad pública está en `app/public/privacidad.html`.

## Pendientes y futuro
- Probar en dispositivos reales (iPhone/Safari, Android): la renovación del acceso tras ~1 h solo se ha verificado con Google simulado.
- Opcional: acortar la espera de 60 s y mostrar «se subirá en unos segundos».
- Futuro: backend de renovación (refresh token), cifrado, fusión por registro (`updatedAt`).

## Código
`src/db/drive.ts` (lógica, estado y cliente de Drive) · `src/ui/driveAuth.ts` (Google Identity Services) · `src/ui/drive.tsx` (proveedor, aviso y sección de Ajustes) · `src/db/db.ts` (`onChange`, `createBackup({ touch })`) · `src/tests/drive.test.ts` · `e2e/drive.mjs`.
