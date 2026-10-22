import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { createBackup, db } from '../db/db'
import { BLOCKED, DriveError, driveFileName, getDriveState, isLocalEmpty, pullRemote, setDriveEnabled, subscribeChanges, syncNow, trackChanges, unblockDrive, uploadBackup, type DriveEnv, type RemoteInfo } from '../db/drive'
import { download, fmtDateTime, type Data } from './data'
import { accessToken, driveAvailable, driveEnv, revokeAccess } from './driveAuth'
import { Icon, useUi } from './ui'

type Phase = 'idle' | 'syncing' | 'error' | 'reconnect' | 'blocked'
export interface DrivePending { status: 'remote-newer' | 'conflict'; remote: RemoteInfo; /** Este dispositivo no tiene datos propios. */ empty: boolean }
type Action = 'reemplazar' | 'combinar' | 'subir' | 'luego'
interface Drive {
  /** Hay Client ID: solo entonces se muestra algo de Drive. */
  available: boolean
  enabled: boolean
  phase: Phase
  error: string
  pending: DrivePending | null
  dirty: boolean
  lastSyncAt?: string
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  reconnect: () => Promise<void>
  retry: () => Promise<void>
  sync: () => Promise<void>
  resolve: (a: Action) => Promise<void>
}
const D = createContext<Drive>(null as never)
export const useDrive = () => useContext(D)

const DEBOUNCE = 60_000 // tras el último cambio, se espera un minuto para subir

/** Un clic del usuario puede abrir la ventana de Google; los ciclos automáticos solo intentan en silencio. */
const interactiveEnv: DriveEnv = { ...driveEnv, token: () => accessToken({ interactive: true }) }

export function DriveSyncProvider({ children }: { children: ReactNode }) {
  const ui = useUi()
  const [, setTick] = useState(0)
  const st = getDriveState()
  const [phase, setPhase] = useState<Phase>(st.blocked ? 'blocked' : 'idle')
  const [error, setError] = useState(st.blocked ? BLOCKED : '')
  const [pending, setPending] = useState<DrivePending | null>(null)
  const busy = useRef(false)
  const renewing = useRef<Promise<boolean> | null>(null)
  const postponed = useRef('') // versión de Drive que el usuario pospuso en esta sesión: no se vuelve a ofrecer hasta la próxima
  const failures = useRef(0) // intentos seguidos con clic que Google no completó
  const enabled = driveAvailable && st.enabled
  const refresh = () => setTick((n) => n + 1)

  useEffect(() => { trackChanges(db); return () => { db.onChange = null } }, [])

  const run = useCallback(async (manual = false) => {
    if (busy.current) return
    if (!manual && getDriveState().blocked) return // aplicación bloqueada: no se insiste solo
    busy.current = true; setPhase('syncing'); setError('')
    try {
      const out = await syncNow(manual ? interactiveEnv : driveEnv)
      if (out.status === 'remote-newer' || out.status === 'conflict') { if (postponed.current !== out.remote.version) setPending({ status: out.status, remote: out.remote, empty: await isLocalEmpty() }) } else setPending(null)
      setPhase('idle')
    } catch (e) {
      const code = e instanceof DriveError ? e.code : undefined
      if (!(e instanceof DriveError)) console.error(e)
      setError(e instanceof Error ? e.message : 'No se pudo sincronizar con Google Drive.')
      setPhase(code === 'reconnect' || code === 'session' ? 'reconnect' : code === 'blocked' ? 'blocked' : 'error')
    } finally { busy.current = false; setTick((n) => n + 1) }
  }, [])

  // Al abrir, al volver a la app, al recuperar la conexión y un minuto después de cada cambio; al salir de la app, si quedó algo pendiente.
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const go = () => { if (navigator.onLine) void run() }
    const onVisible = () => { if (document.visibilityState === 'visible') go(); else if (getDriveState().dirty) go() }
    const unsub = subscribeChanges(() => { clearTimeout(timer); timer = setTimeout(go, DEBOUNCE) })
    addEventListener('online', go); document.addEventListener('visibilitychange', onVisible)
    go()
    return () => { unsub(); clearTimeout(timer); removeEventListener('online', go); document.removeEventListener('visibilitychange', onVisible) }
  }, [enabled, run])

  /** Avisa de por qué no se pudo completar una acción hecha con clic. Tras repetidos fallos orienta sobre una app revocada. */
  const failed = (e: unknown) => {
    if (e instanceof DriveError && e.code === 'blocked') { failures.current = 0; setError(e.message); setPhase('blocked'); ui.toast(e.message, true); return }
    failures.current++
    ui.toast(failures.current >= 2
      ? 'Google no completó la conexión. Si viste un error de la aplicación, puede estar revocada o mal configurada: tus datos siguen seguros aquí y puedes usar «Descargar copia».'
      : e instanceof DriveError && e.code !== 'reconnect' ? e.message : 'No se pudo conectar con Google Drive. Inténtalo de nuevo.', true)
  }

  const connect = async () => {
    try { await accessToken({ interactive: true }); failures.current = 0; setDriveEnabled(true); setPhase('idle'); setError(''); refresh() } catch (e) { failed(e) }
  }
  const disconnect = async () => {
    await revokeAccess(); setDriveEnabled(false); setPending(null); setPhase('idle'); setError(''); failures.current = 0; refresh()
  }
  /** Renueva el acceso desde un gesto del usuario. Un solo intento a la vez, aunque lo pidan el clic global y el botón. */
  const renew = useCallback((): Promise<boolean> => {
    renewing.current ??= accessToken({ interactive: true }).then(() => true, () => false).finally(() => { renewing.current = null })
    return renewing.current
  }, [])
  const reconnect = async () => {
    if (await renew()) { failures.current = 0; await run() } else failed(new DriveError('reconnect', ''))
  }
  /** Reintenta tras un bloqueo (p. ej. se corrigió el Client ID o se publicó una versión nueva). */
  const retry = async () => { unblockDrive(); setPhase('idle'); setError(''); failures.current = 0; await run(true) }
  const sync = () => run(true)

  // Si el acceso venció, el siguiente toque en cualquier parte de la app lo renueva: viene de un gesto del usuario, así que el
  // navegador sí permite la ventana de Google (que se cierra sola si ya diste permiso). Un intento por cada ciclo fallido; el
  // siguiente intento de sincronización lo vuelve a armar.
  useEffect(() => {
    if (!enabled || phase !== 'reconnect') return
    const onClick = () => {
      document.removeEventListener('click', onClick, true)
      void renew().then((ok) => { if (ok) void run() })
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [enabled, phase, renew, run])

  const resolve = async (a: Action) => {
    if (!pending) return
    if (a === 'luego') { postponed.current = pending.remote.version; setPending(null); return }
    try {
      if (a === 'subir') {
        await uploadBackup(interactiveEnv, { force: true }); ui.toast('Copia subida a Google Drive'); setPending(null)
      } else if (a === 'combinar') {
        const r = await pullRemote(interactiveEnv, 'combinar')
        ui.toast(`Copia de Drive combinada: ${r.added} registro(s) agregados; se conservó todo lo de este dispositivo.`); setPending(null); void run()
      } else {
        const conflict = pending.status === 'conflict'
        if (!pending.empty && !(await ui.confirm(conflict ? 'Se reemplazarán los datos de este dispositivo por los de Google Drive y se perderán los cambios que aún no están respaldados allí. Antes se descargará una copia de lo que hay aquí.' : 'Se reemplazarán los datos de este dispositivo por la copia más nueva de Google Drive. No tienes cambios sin respaldar.', 'Traer de Drive'))) return
        if (conflict) { const b = await createBackup(); download(`recetario-antes-de-traer-${b.createdAt.slice(0, 10)}.json`, JSON.stringify(b, null, 2), 'application/json') }
        await pullRemote(interactiveEnv, 'reemplazar'); ui.toast('Copia de Google Drive restaurada'); setPending(null)
      }
    } catch (e) { ui.toast(e instanceof Error ? e.message : 'No se pudo completar la acción con Google Drive.', true) }
    refresh()
  }

  const value: Drive = { available: driveAvailable, enabled, phase, error, pending, dirty: st.dirty, lastSyncAt: st.lastSyncAt, connect, disconnect, reconnect, retry, sync, resolve }
  return <D.Provider value={value}>{children}</D.Provider>
}

const who = (r: RemoteInfo) => (r.deviceId && r.deviceId === getDriveState().deviceId ? 'este dispositivo' : 'otro dispositivo')

/** Estado de «ocupado» para no duplicar acciones con doble toque. */
function useGuard(): [boolean, (fn: () => Promise<unknown>) => Promise<void>] {
  const [busy, setBusy] = useState(false)
  const ref = useRef(false)
  return [busy, async (fn) => { if (ref.current) return; ref.current = true; setBusy(true); try { await fn() } finally { ref.current = false; setBusy(false) } }]
}

/** Aviso global: copia en Drive para traer, reconexión necesaria o conexión inhabilitada. No ocupa espacio si todo está en orden. */
export function DriveBanner() {
  const d = useDrive(), [busy, guard] = useGuard()
  if (!d.enabled) return null
  if (d.pending) {
    const { status, remote, empty } = d.pending
    const when = remote.modifiedTime ? fmtDateTime(remote.modifiedTime) : 'fecha desconocida'
    return (
      <div className="banner stack" role="region" aria-label="Copia en Google Drive" style={{ marginBottom: 12 }}>
        <div className="row"><Icon n="down" size={20} /><div className="grow">{empty
          ? <><b>Hay una copia de tu pastelería en Google Drive</b> (de {who(remote)}, {when}). Este dispositivo todavía no tiene datos.</>
          : status === 'remote-newer'
            ? <><b>Hay una copia más nueva en Google Drive</b> (de {who(remote)}, {when}). Este dispositivo no tiene cambios sin respaldar.</>
            : <><b>Google Drive y este dispositivo tienen cambios distintos</b> (copia de {who(remote)}, {when}). Elige qué hacer; no se sobrescribe nada sin tu confirmación.</>}</div></div>
        <div className="row wrap">
          {status === 'remote-newer' || empty
            ? <button className="btn small primary" disabled={busy} onClick={() => guard(() => d.resolve('reemplazar'))}>Traer la copia de Drive</button>
            : <><button className="btn small primary" disabled={busy} onClick={() => guard(() => d.resolve('combinar'))}>Combinar</button>
              <button className="btn small" disabled={busy} onClick={() => guard(() => d.resolve('subir'))}>Subir la mía</button>
              <button className="btn small" disabled={busy} onClick={() => guard(() => d.resolve('reemplazar'))}>Usar la de Drive</button></>}
          <button className="btn small ghost" disabled={busy} onClick={() => d.resolve('luego')}>Ahora no</button>
        </div>
      </div>
    )
  }
  if (d.phase === 'blocked') return <Link to="/ajustes" className="banner bad" style={{ marginBottom: 12 }}>El respaldo en Google Drive está inhabilitado: Google rechazó la conexión de la aplicación. Tus datos siguen seguros en este dispositivo. Toca para ver detalles.</Link>
  if (d.phase === 'reconnect') return <button className="banner" style={{ marginBottom: 12 }} onClick={() => d.reconnect()}>Google Drive necesita renovar el acceso para respaldar tus cambios. Toca aquí o en cualquier parte de la app.</button>
  return null
}

/** Sección de Ajustes: conectar, estado y sincronización manual. */
export function DriveSettings({ data }: { data: Data }) {
  const d = useDrive(), ui = useUi(), [busy, guard] = useGuard()
  if (!d.available) return null
  const name = driveFileName(data.settings.businessName)
  const blocked = d.phase === 'blocked'
  return (
    <section className="stack">
      <h2>Respaldo en Google Drive</h2>
      <p className="small muted">Guarda una copia en tu Google Drive con un nombre fijo y avisa al abrir la app si hay una versión más nueva. No sincroniza en vivo: tú decides si traerla.</p>
      {blocked && (
        <div className="banner bad" role="alert">
          <b>Respaldo en Drive inhabilitado.</b> {d.error || BLOCKED} Puedes seguir usando la app y descargar copias manuales (arriba). Si el problema es de la aplicación, se corrige publicando una versión con una configuración nueva; después toca «Reintentar».
        </div>
      )}
      {!d.enabled ? (
        <>
          <p className="small muted">Se crea un archivo visible en «Mi unidad» (<span className="kbd">{name}</span>). La app solo puede ver ese archivo, no el resto de tu Drive. El archivo es JSON legible e incluye tus recetas, costos, pedidos y clientes: protege tu cuenta de Google.</p>
          <div className="row wrap">
            {/* Sin conectar, «Reintentar» es volver a conectar: si Google ya acepta la aplicación, queda conectada y respalda. */}
            <button className="btn primary" disabled={busy} onClick={() => guard(d.connect)}>{blocked ? 'Reintentar' : 'Conectar Google Drive'}</button>
          </div>
        </>
      ) : (
        <>
          <p className="small muted">Archivo: <span className="kbd">{name}</span> · Última sincronización: <b>{d.lastSyncAt ? fmtDateTime(d.lastSyncAt) : 'nunca'}</b> · {d.phase === 'syncing' ? 'sincronizando…' : d.dirty ? 'hay cambios por subir' : 'todo respaldado'}</p>
          {d.phase === 'error' && <div className="banner bad">{d.error}</div>}
          {d.phase === 'reconnect' && <div className="banner">{d.error} <button className="btn small" onClick={() => d.reconnect()}>Reconectar</button></div>}
          <div className="row wrap">
            {blocked
              ? <button className="btn primary" disabled={busy} onClick={() => guard(d.retry)}>Reintentar</button>
              : <button className="btn primary" disabled={busy || d.phase === 'syncing'} onClick={() => guard(d.sync)}>Sincronizar ahora</button>}
            <button className="btn" disabled={busy} onClick={async () => { if (await ui.confirm('Se dejará de respaldar en Google Drive desde este dispositivo y se revocará el acceso. El archivo en tu Drive no se borra.', 'Desconectar')) await guard(d.disconnect) }}>Desconectar</button>
          </div>
        </>
      )}
    </section>
  )
}
