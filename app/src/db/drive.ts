import { buildBackup, parseBackup, type BackupFile } from '../domain/backup'
import { createBackup, db, getSettings, restoreBackup, snapshot, uid, type AppDB } from './db'

/**
 * Respaldo en Google Drive: un solo archivo con nombre fijo. No hay fusión automática: si Drive tiene una versión que este
 * dispositivo no conoce, se avisa y el usuario decide (traer, combinar o subir la suya). Acceso por `drive.file`: la app
 * solo ve el archivo que ella misma creó. Un dispositivo sin datos nunca sube sobre una copia existente.
 */
const API = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'
const FIELDS = 'id,version,modifiedTime,trashed,appProperties'
const APP_KEY = 'recetario'

/** Error redactado para el usuario. `code` permite a la interfaz decidir qué ofrecer. */
export type DriveErrorCode = 'reconnect' | 'blocked' | 'offline' | 'session' | 'http'
export class DriveError extends Error {
  code: DriveErrorCode
  constructor(code: DriveErrorCode, message: string) { super(message); this.name = 'DriveError'; this.code = code }
}
export const RECONNECT = 'Reconecta Google Drive para seguir respaldando.'
export const BLOCKED = 'Google rechazó la conexión de la aplicación (puede haberse revocado o estar mal configurada). Tus datos en este dispositivo no se ven afectados.'

/** Errores de Google que indican que la aplicación (Client ID) no es utilizable: reintentar no sirve hasta que se corrija. */
const BLOCKING = new Set(['invalid_client', 'unauthorized_client', 'deleted_client', 'disabled_client', 'invalid_request', 'invalid_scope', 'redirect_uri_mismatch', 'origin_mismatch'])
export const isBlockingGoogleError = (e?: string): boolean => !!e && BLOCKING.has(e)

/** Acceso a la red y al token, inyectables (pruebas y manejo de expiración en la interfaz). */
export interface DriveEnv { fetch: typeof fetch; token: () => Promise<string> }

export interface RemoteInfo { id: string; version: string; modifiedTime: string; backupCreatedAt: string; deviceId: string }
/** Estado propio de cada dispositivo (no viaja en la copia). `dirty`: hay cambios locales sin subir. `blocked`: motivo por el que se dejó de intentar. */
export interface DriveState { deviceId: string; enabled: boolean; dirty: boolean; fileId?: string; version?: string; backupCreatedAt?: string; lastSyncAt?: string; blocked?: string }
export type RemoteStatus =
  | { status: 'none' }
  | { status: 'in-sync'; remote: RemoteInfo }
  | { status: 'local-ahead'; remote: RemoteInfo }
  | { status: 'remote-newer'; remote: RemoteInfo }
  | { status: 'conflict'; remote: RemoteInfo }
export type UploadResult = { status: 'uploaded'; remote: RemoteInfo } | { status: 'conflict'; remote: RemoteInfo }
export type SyncOutcome = { status: 'idle' } | { status: 'uploaded'; remote: RemoteInfo } | { status: 'remote-newer' | 'conflict'; remote: RemoteInfo }

/* ───────── Estado local del dispositivo ───────── */
let mem: string | undefined
let seq = 0
const listeners = new Set<() => void>()
const STATE_KEY = 'recetario.drive'

export function getDriveState(): DriveState {
  let raw: string | null | undefined
  try { raw = localStorage.getItem(STATE_KEY) } catch { /* sin almacenamiento */ }
  raw ??= mem
  if (raw) { try { return JSON.parse(raw) as DriveState } catch { /* estado dañado: se recrea */ } }
  const fresh: DriveState = { deviceId: uid(), enabled: false, dirty: true }
  saveState(fresh)
  return fresh
}
function saveState(s: DriveState): void {
  mem = JSON.stringify(s)
  try { localStorage.setItem(STATE_KEY, mem) } catch { /* sin almacenamiento */ }
}
const patchState = (p: Partial<DriveState>): DriveState => { const s = { ...getDriveState(), ...p }; saveState(s); return s }

export function setDriveEnabled(enabled: boolean): void {
  if (enabled) patchState({ enabled, blocked: undefined })
  else patchState({ enabled, fileId: undefined, version: undefined, backupCreatedAt: undefined, blocked: undefined, dirty: true })
}
/** Deja de intentar sincronizar (p. ej. Client ID revocado) hasta que el usuario reintente. Los datos locales no se tocan. */
export const blockDrive = (reason: string): void => { patchState({ blocked: reason }) }
export const unblockDrive = (): void => { patchState({ blocked: undefined }) }

/** Marca cambios locales sin subir y avisa a quien escuche (para la subida automática). */
export function markDirty(): void {
  seq++
  if (!getDriveState().dirty) patchState({ dirty: true })
  listeners.forEach((f) => f())
}
/** Conecta las escrituras de la base con `markDirty`. */
export function trackChanges(d: AppDB = db): void { d.onChange = markDirty }
export function subscribeChanges(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f) } }

/* ───────── Datos locales ───────── */
const emptyBackup = (f: BackupFile): boolean => [f.ingredients, f.purchases, f.recipes, f.customers, f.orders, f.expenses, f.tools].every((t) => t.length === 0)
/** Sin ningún dato real (los de demostración no cuentan): nada propio que perder ni que valga la pena respaldar. */
export const isLocalEmpty = async (d: AppDB = db): Promise<boolean> => emptyBackup(buildBackup(await snapshot(d)))

/* ───────── Cliente de Drive ───────── */
interface DriveFile { id: string; version?: string; modifiedTime?: string; trashed?: boolean; appProperties?: Record<string, string> }
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'pasteleria'
/** Nombre fijo: se asigna al crear el archivo y no cambia aunque cambien los datos. */
export const driveFileName = (name: string): string => `recetario-${slug(name)}.json`

async function call(env: DriveEnv, url: string, init: RequestInit = {}): Promise<Response> {
  const token = await env.token() // si falla, su mensaje (p. ej. «reconecta») llega tal cual al usuario
  let r: Response
  try { r = await env.fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` } }) }
  catch { throw new DriveError('offline', 'No hay conexión con Google Drive.') }
  if (r.status === 401) throw new DriveError('session', 'Google Drive cerró la sesión: vuelve a conectar.')
  return r
}
const check = (r: Response, what: string) => {
  if (!r.ok) throw new DriveError('http', `Google Drive no pudo ${what} (${r.status}).${r.status === 403 ? ' Puede ser un límite de uso o que la aplicación esté deshabilitada en Google.' : ''}`)
}
const info = (f: DriveFile): RemoteInfo => ({ id: f.id, version: String(f.version ?? ''), modifiedTime: f.modifiedTime ?? '', backupCreatedAt: f.appProperties?.backupCreatedAt ?? '', deviceId: f.appProperties?.deviceId ?? '' })

/** Localiza el archivo: primero por el id guardado y, si no, buscándolo por sus propiedades. */
async function findRemote(env: DriveEnv): Promise<RemoteInfo | null> {
  const st = getDriveState()
  if (st.fileId) {
    const r = await call(env, `${API}/${st.fileId}?fields=${FIELDS}`)
    if (r.ok) { const f = (await r.json()) as DriveFile; if (!f.trashed) return info(f) }
    else if (r.status !== 404) check(r, 'consultar la copia')
    patchState({ fileId: undefined })
  }
  const q = encodeURIComponent(`appProperties has { key='app' and value='${APP_KEY}' } and trashed=false`)
  const r = await call(env, `${API}?q=${q}&orderBy=modifiedTime%20desc&pageSize=1&fields=files(${FIELDS})`)
  check(r, 'buscar la copia')
  const f = ((await r.json()) as { files?: DriveFile[] }).files?.[0]
  if (!f) return null
  patchState({ fileId: f.id })
  return info(f)
}

function multipart(meta: object, content: string, boundary: string): string {
  return `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`
}

async function upload(env: DriveEnv, remote: RemoteInfo | null, d: AppDB): Promise<RemoteInfo> {
  const startSeq = seq
  const file = await createBackup(d, { touch: false })
  const st = getDriveState()
  const appProperties = { app: APP_KEY, backupCreatedAt: file.createdAt, deviceId: st.deviceId, appVersion: file.appVersion, schemaVersion: String(file.schemaVersion) }
  const boundary = `recetario-${uid()}`
  const meta = remote ? { appProperties } : { name: driveFileName((await getSettings(d)).businessName), mimeType: 'application/json', appProperties }
  const url = remote ? `${UPLOAD}/${remote.id}?uploadType=multipart&fields=${FIELDS}` : `${UPLOAD}?uploadType=multipart&fields=${FIELDS}`
  const r = await call(env, url, { method: remote ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart(meta, JSON.stringify(file), boundary) })
  check(r, 'subir la copia')
  const out = info((await r.json()) as DriveFile)
  // Si hubo cambios mientras se subía, siguen pendientes.
  patchState({ fileId: out.id, version: out.version, backupCreatedAt: file.createdAt, lastSyncAt: new Date().toISOString(), dirty: seq !== startSeq })
  return out
}

/* ───────── Operaciones ───────── */
/** Compara Drive con lo que este dispositivo sabe: sin descargar el archivo (solo metadatos). */
export async function checkRemote(env: DriveEnv, d: AppDB = db): Promise<RemoteStatus> {
  const remote = await findRemote(env)
  if (!remote) return { status: 'none' }
  // Un dispositivo sin datos (nuevo, o tras «borrar todo») nunca sube sobre la copia de Drive: ofrece traerla.
  if (await isLocalEmpty(d)) return { status: 'remote-newer', remote }
  const st = getDriveState()
  if (st.version === remote.version) return { status: st.dirty ? 'local-ahead' : 'in-sync', remote }
  return { status: st.dirty ? 'conflict' : 'remote-newer', remote }
}

/** Sube la copia. Sin `force` nunca pisa una versión de Drive que este dispositivo no conoce ni sube un dispositivo vacío. */
export async function uploadBackup(env: DriveEnv, o: { force?: boolean } = {}, d: AppDB = db): Promise<UploadResult> {
  const remote = await findRemote(env)
  if (remote && !o.force && (remote.version !== getDriveState().version || await isLocalEmpty(d))) return { status: 'conflict', remote }
  return { status: 'uploaded', remote: await upload(env, remote, d) }
}

/** Ciclo automático: sube si hay cambios locales y Drive no tiene nada nuevo; si no, avisa. */
export async function syncNow(env: DriveEnv, d: AppDB = db): Promise<SyncOutcome> {
  const c = await checkRemote(env, d)
  if (c.status === 'in-sync') return { status: 'idle' }
  if (c.status === 'remote-newer' || c.status === 'conflict') return c
  if (c.status === 'none' && await isLocalEmpty(d)) return { status: 'idle' } // no se crea un archivo vacío
  return { status: 'uploaded', remote: await upload(env, c.status === 'none' ? null : c.remote, d) }
}

/** Trae la copia de Drive y la aplica con las reglas de la restauración (`combinar` conserva lo local). */
export async function pullRemote(env: DriveEnv, mode: 'combinar' | 'reemplazar', d: AppDB = db): Promise<{ added: number; skipped: number }> {
  const remote = (await findRemote(env)) ?? (() => { throw new DriveError('http', 'No hay ninguna copia en Google Drive.') })()
  const r = await call(env, `${API}/${remote.id}?alt=media`)
  check(r, 'descargar la copia')
  const rep = parseBackup(await r.text())
  if (!rep.ok || !rep.data) throw new DriveError('http', rep.errors[0] ?? 'La copia de Drive no es válida.')
  const hadLocal = getDriveState().dirty
  const out = await restoreBackup(rep.data, mode, d)
  // Combinar deja datos que Drive aún no tiene: quedan pendientes de subir. Reemplazar deja ambos iguales.
  patchState({ fileId: remote.id, version: remote.version, backupCreatedAt: remote.backupCreatedAt, lastSyncAt: new Date().toISOString(), dirty: mode === 'combinar' && (hadLocal || out.added > 0) })
  return out
}
