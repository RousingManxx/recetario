# Historial de cambios

Todos los cambios relevantes de Recetario se anotan aquí. Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y versionado [SemVer](https://semver.org/lang/es/): **MAYOR.MENOR.PARCHE** (MAYOR: cambia el formato de datos o rompe compatibilidad; MENOR: función nueva; PARCHE: corrección).

> Las versiones 1.0.0 a 1.2.1 se asignaron **retroactivamente**, agrupando los commits del historial de Git (20–22 de octubre de 2026). `app/package.json` indica la versión vigente; la pantalla de Ajustes muestra además el commit y la fecha de compilación.

**Cómo publicar una versión:** mueve lo de «Sin publicar» a una sección nueva con su número y fecha, sube `version` en `app/package.json` y haz el merge a `main` (el workflow publica en GitHub Pages).

## [Sin publicar]

## [1.3.0] — 2026-10-22

### Agregado
- **Respaldo en Google Drive (opcional).** La copia de la pastelería se sube sola a un archivo de «Mi unidad» con nombre fijo (`recetario-<nombre>.json`) y se actualiza siempre el mismo. Se sube un minuto después del último cambio, al salir de la app y al recuperar conexión.
- **Aviso de versión más nueva.** Al abrir la app (y al volver a ella) se compara con Drive consultando solo metadatos. Si hay una copia más nueva se ofrece traerla; si ambos lados cambiaron se ofrece *Combinar*, *Subir la mía* o *Usar la de Drive*. Nunca se sobrescribe sin confirmación y, antes de reemplazar con cambios locales, se descarga una copia de lo local.
- **Un dispositivo sin datos nunca sube sobre la copia de Drive**: en un dispositivo nuevo, o tras «Borrar todos los datos», ofrece traer la copia en lugar de subir una vacía.
- **Renovación del acceso de Google con el siguiente toque.** El acceso dura ~1 h; cuando vence y el navegador bloquea la ventana de renovación automática, la app la renueva con el primer clic o toque del usuario en cualquier parte, o con el aviso.
- **Client ID revocado, eliminado o mal configurado:** si Google rechaza la aplicación, el respaldo en Drive se inhabilita con un aviso claro, la app deja de insistir, los datos locales y las copias manuales siguen funcionando y «Reintentar» vuelve a conectar cuando se corrija. Ver `app/docs/DRIVE.md`.
- Sección **Ajustes → Respaldo en Google Drive** (conectar, estado, sincronizar ahora, desconectar). No aparece si el despliegue no define `VITE_GOOGLE_CLIENT_ID`.
- Documentación `app/docs/DRIVE.md`; 17 pruebas unitarias nuevas (119 en total) y un recorrido E2E (`app/e2e/drive.mjs`, 28 comprobaciones) con Google y Drive simulados.
- `deploy.yml` pasa `VITE_GOOGLE_CLIENT_ID` (variable de repositorio `GOOGLE_CLIENT_ID`) a la compilación. Sin esa variable la sección de Drive queda oculta.

### Cambiado
- `createBackup` acepta `{ touch: false }` para no registrar «última copia» en las subidas automáticas.
- Las escrituras de datos avisan a la sincronización (`AppDB.onChange`); no afecta al resto de la app.

### Limitaciones conocidas
- Sin servidor propio no hay «refresh token»: puede pedirse renovar el acceso cada hora (sobre todo en Safari/iOS, aún sin probar en dispositivos reales).
- *Combinar* solo agrega registros que faltan (gana lo local); no propaga ediciones de registros existentes.
- El archivo en Drive es JSON legible; el cifrado con contraseña queda para una versión futura.

## [1.2.1] — 2026-10-22
### Agregado
- Página pública de **política de privacidad** (`/privacidad.html`), requisito de Google para publicar la pantalla de consentimiento de OAuth. (PR #1)

## [1.2.0] — 2026-10-20
### Agregado
- **Herramientas**: catálogo, porcentaje de uso por receta y esquema de datos v2; gastos ya cobrados considerados en recetas.
- Uso de herramientas (%) general en la receta.
- Demo de macarrones con recetas separadas; categorías de receta dinámicas.
### Corregido
- Fecha UTC en los datos de demostración.

## [1.1.0] — 2026-10-20
### Agregado
- Finanzas: panel con gráficas interactivas, comparación de periodos y flujo de caja.
- Exportar reportes de Finanzas en PDF y CSV con fechas y filtros.
- Autoactualización de la PWA y versión visible en Ajustes.
### Cambiado
- Se bloquea el zoom por pellizco y doble toque; campos de 16 px forzados para evitar el zoom automático.

## [1.0.0] — 2026-10-20
### Agregado
- Primera versión: gestión de pastelería (PWA local-first) con recetas, ingredientes, costos reales, precios y márgenes, pedidos, clientes, gastos, resumen, guía de inicio, exportación CSV y respaldo/restauración JSON; animaciones, almacenamiento persistente y recordatorio de copia de seguridad.
