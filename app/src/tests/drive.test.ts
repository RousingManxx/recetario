import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDB, createBackup, createIngredient, getSettings, saveSettings } from '../db/db'
import {
  BLOCKED, DriveError, blockDrive, checkRemote, driveFileName, getDriveState, isBlockingGoogleError, isLocalEmpty, markDirty, pullRemote, setDriveEnabled, syncNow, trackChanges, unblockDrive, uploadBackup,
  type DriveEnv,
} from '../db/drive'

interface FakeFile { id: string; name: string; content: string; appProperties: Record<string, string>; version: number; modifiedTime: string; trashed: boolean }

/** Drive simulado en memoria: solo lo que usa el servicio (buscar, metadatos, descargar, subir multipart). */
function fakeDrive() {
  const files = new Map<string, FakeFile>()
  let n = 0, tick = 0
  const calls: string[] = []
  const meta = (f: FakeFile) => ({ id: f.id, version: String(f.version), modifiedTime: f.modifiedTime, trashed: f.trashed, appProperties: f.appProperties })
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
  const parts = (body: string) => {
    const boundary = body.slice(2, body.indexOf('\r\n'))
    const [m, c] = body.split(`--${boundary}`).slice(1, 3).map((p) => p.slice(p.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, ''))
    return { meta: JSON.parse(m), content: c }
  }
  const env = (token: () => Promise<string> = async () => 'tok'): DriveEnv => ({
    token,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input)), method = init?.method ?? 'GET'
      calls.push(`${method} ${url.pathname}`)
      const id = url.pathname.split('/').pop()!
      if (url.pathname.startsWith('/upload/')) {
        const p = parts(String(init!.body))
        if (method === 'POST') {
          const f: FakeFile = { id: `f${++n}`, name: p.meta.name, content: p.content, appProperties: p.meta.appProperties, version: 1, modifiedTime: `t${++tick}`, trashed: false }
          files.set(f.id, f); return json(meta(f))
        }
        const f = files.get(id); if (!f) return json({}, 404)
        f.content = p.content; f.appProperties = p.meta.appProperties; f.version++; f.modifiedTime = `t${++tick}`
        return json(meta(f))
      }
      if (id === 'files') {
        const app = /value='([^']+)'/.exec(url.searchParams.get('q') ?? '')?.[1]
        return json({ files: [...files.values()].filter((f) => !f.trashed && f.appProperties.app === app).slice(0, 1).map(meta) })
      }
      const f = files.get(id); if (!f) return json({}, 404)
      return url.searchParams.get('alt') === 'media' ? new Response(f.content) : json(meta(f))
    }) as typeof fetch,
  })
  /** Otro dispositivo modifica el archivo directamente en Drive. */
  const editRemote = (id: string, content: string, deviceId = 'otro') => { const f = files.get(id)!; f.content = content; f.version++; f.modifiedTime = `t${++tick}`; f.appProperties = { ...f.appProperties, deviceId } }
  return { files, env, calls, editRemote }
}

let d: AppDB
beforeEach(async () => {
  d = new AppDB('t' + Math.random()); await d.open()
  setDriveEnabled(false) // restablece el estado del dispositivo (versión conocida, pendiente, bloqueo)
  trackChanges(d)
})

const ing = (name: string, db = d) => createIngredient(
  { name, category: 'Chocolates' },
  { date: '2026-01-01', qty: 1, unit: 'kg', priceCents: 18000, discountCents: 0, extraCents: 0 }, db)
const backupText = async (db = d) => JSON.stringify(await createBackup(db, { touch: false }))
const names = (content: string) => (JSON.parse(content).ingredients as { name: string }[]).map((i) => i.name)

describe('Respaldo en Google Drive', () => {
  it('sube con nombre fijo, actualiza el mismo archivo y no vuelve a subir sin cambios', async () => {
    await saveSettings({ businessName: 'Pastelería Ñoño' }, d)
    await ing('Chocolate')
    const dr = fakeDrive(), env = dr.env()
    expect((await checkRemote(env, d)).status).toBe('none')

    expect((await syncNow(env, d)).status).toBe('uploaded')
    expect(dr.files.size).toBe(1)
    const f = [...dr.files.values()][0]
    expect(f.name).toBe(driveFileName('Pastelería Ñoño')); expect(f.name).toBe('recetario-pasteleria-nono.json')
    expect(f.appProperties.app).toBe('recetario')
    expect(getDriveState().dirty).toBe(false)

    dr.calls.length = 0
    expect((await syncNow(env, d)).status).toBe('idle')
    expect(dr.calls.some((c) => c.startsWith('PATCH') || c.startsWith('POST'))).toBe(false)

    await ing('Azúcar glass')
    expect(getDriveState().dirty).toBe(true)
    expect((await syncNow(env, d)).status).toBe('uploaded')
    expect(dr.files.size).toBe(1)
    const g = [...dr.files.values()][0]
    expect(g.id).toBe(f.id); expect(g.name).toBe(f.name); expect(g.version).toBe(2)
    expect(names(g.content)).toContain('Azúcar glass')
    expect(getDriveState().dirty).toBe(false)
  })

  it('las subidas automáticas no cuentan como copia manual (lastBackupAt)', async () => {
    await ing('Chocolate')
    const dr = fakeDrive()
    await syncNow(dr.env(), d)
    expect((await getSettings(d)).lastBackupAt).toBeUndefined()
    await createBackup(d)
    expect((await getSettings(d)).lastBackupAt).toBeDefined()
  })

  it('no pisa una versión de Drive desconocida: conflicto, y solo "forzar" sobrescribe', async () => {
    await ing('Chocolate')
    const dr = fakeDrive(), env = dr.env()
    await syncNow(env, d)
    const id = [...dr.files.keys()][0]
    dr.editRemote(id, await backupText())          // otro dispositivo subió algo
    await ing('Local')

    expect((await checkRemote(env, d)).status).toBe('conflict')
    const before = dr.files.get(id)!.version
    expect((await uploadBackup(env, {}, d)).status).toBe('conflict'); expect(dr.files.get(id)!.version).toBe(before)
    expect((await syncNow(env, d)).status).toBe('conflict')

    expect((await uploadBackup(env, { force: true }, d)).status).toBe('uploaded')
    expect(dr.files.get(id)!.version).toBe(before + 1)
    expect((await checkRemote(env, d)).status).toBe('in-sync')
  })

  it('avisa de versión más nueva (sin cambios locales) y "traer" la combina conservando lo local', async () => {
    await ing('Local')
    const dr = fakeDrive(), env = dr.env()
    await syncNow(env, d)
    const id = [...dr.files.keys()][0]
    // otro dispositivo (otra base) agrega un ingrediente y sube
    const other = new AppDB('o' + Math.random()); await other.open()
    await ing('Remoto', other)
    dr.editRemote(id, await backupText(other))

    expect((await checkRemote(env, d)).status).toBe('remote-newer')
    expect(await syncNow(env, d)).toMatchObject({ status: 'remote-newer' })   // no sube ni pisa
    expect(dr.files.get(id)!.version).toBe(2)

    const r = await pullRemote(env, 'combinar', d)
    expect(r.added).toBeGreaterThan(0)
    expect((await d.ingredients.toArray()).map((i) => i.name).sort()).toEqual(['Local', 'Remoto'])
    // lo combinado queda pendiente de subir (Drive aún no lo tiene idéntico)
    expect(getDriveState().version).toBe('2')
    expect((await checkRemote(env, d)).status).toBe('local-ahead')
    expect((await syncNow(env, d)).status).toBe('uploaded')
    expect((await checkRemote(env, d)).status).toBe('in-sync')
  })

  it('"traer" con reemplazar deja el dispositivo idéntico a Drive y en sincronía', async () => {
    const dr = fakeDrive(), env = dr.env()
    await ing('Original')
    await syncNow(env, d)
    await ing('Solo local')
    const id = [...dr.files.keys()][0]
    const other = new AppDB('o' + Math.random()); await other.open()
    await ing('Remoto', other)
    dr.editRemote(id, await backupText(other))
    await pullRemote(env, 'reemplazar', d)
    expect((await d.ingredients.toArray()).map((i) => i.name)).toEqual(['Remoto'])
    expect((await checkRemote(env, d)).status).toBe('in-sync')
  })

  it('un dispositivo nuevo que ya tiene datos ve conflicto, no sobrescribe a ciegas', async () => {
    await ing('Chocolate')
    const dr = fakeDrive(), env = dr.env()
    await syncNow(env, d)
    setDriveEnabled(false) // equivale a otro dispositivo: no conoce el id ni la versión de Drive
    expect((await checkRemote(env, d)).status).toBe('conflict')
    expect((await uploadBackup(env, {}, d)).status).toBe('conflict')
    expect(dr.files.size).toBe(1)
  })

  it('un dispositivo SIN datos nunca sube sobre la copia de Drive: ofrece traerla', async () => {
    const dr = fakeDrive(), env = dr.env()
    await ing('Chocolate')
    await syncNow(env, d)
    const id = [...dr.files.keys()][0]
    const antes = dr.files.get(id)!

    // dispositivo nuevo y vacío (otra base, sin estado de sincronización)
    const vacio = new AppDB('v' + Math.random()); await vacio.open()
    setDriveEnabled(false)
    expect(await isLocalEmpty(vacio)).toBe(true)
    expect((await checkRemote(env, vacio)).status).toBe('remote-newer')
    expect(await syncNow(env, vacio)).toMatchObject({ status: 'remote-newer' })
    expect((await uploadBackup(env, {}, vacio)).status).toBe('conflict')
    expect(dr.files.get(id)!.version).toBe(antes.version); expect(dr.files.get(id)!.content).toBe(antes.content)

    // y puede traerla
    await pullRemote(env, 'reemplazar', vacio)
    expect((await vacio.ingredients.toArray()).map((i) => i.name)).toEqual(['Chocolate'])
  })

  it('"Borrar todos los datos" no sube una copia vacía sobre la de Drive', async () => {
    const dr = fakeDrive(), env = dr.env()
    await ing('Chocolate')
    await syncNow(env, d)
    const id = [...dr.files.keys()][0]
    const antes = dr.files.get(id)!.content
    // lo mismo que hace Ajustes → Zona delicada
    await Promise.all([d.ingredients, d.purchases, d.recipes, d.customers, d.orders, d.expenses, d.tools, d.settings].map((t) => t.clear()))
    expect(getDriveState().dirty).toBe(true)
    expect(await syncNow(env, d)).toMatchObject({ status: 'remote-newer' })
    expect(dr.files.get(id)!.content).toBe(antes)
    expect(dr.files.get(id)!.version).toBe(1)
  })

  it('sin datos y sin archivo en Drive no se crea un archivo vacío', async () => {
    const dr = fakeDrive()
    expect((await syncNow(dr.env(), d)).status).toBe('idle')
    expect(dr.files.size).toBe(0)
  })

  it('los datos de demostración no cuentan como datos propios', async () => {
    await createIngredient({ name: 'Demo', category: 'x', demo: true }, { date: '2026-01-01', qty: 1, unit: 'kg', priceCents: 100, discountCents: 0, extraCents: 0, demo: true }, d)
    expect(await isLocalEmpty(d)).toBe(true)
  })

  it('recrea el archivo si se borró de Drive y tolera que el id guardado ya no exista', async () => {
    await ing('Chocolate')
    const dr = fakeDrive(), env = dr.env()
    await syncNow(env, d)
    dr.files.clear()
    markDirty()
    expect((await syncNow(env, d)).status).toBe('uploaded')
    expect(dr.files.size).toBe(1)
  })

  it('errores comprensibles: sin conexión, sesión vencida, límite y token', async () => {
    await ing('Chocolate')
    const rejects = async (env: DriveEnv, code: string, msg: RegExp) => {
      const e = await syncNow(env, d).then(() => null, (x: unknown) => x)
      expect(e).toBeInstanceOf(DriveError); expect((e as DriveError).code).toBe(code); expect((e as DriveError).message).toMatch(msg)
    }
    await rejects({ token: async () => 't', fetch: (async () => { throw new TypeError('Failed to fetch') }) as typeof fetch }, 'offline', /No hay conexión/)
    await rejects({ token: async () => 't', fetch: (async () => new Response('{}', { status: 401 })) as typeof fetch }, 'session', /vuelve a conectar/)
    await rejects({ token: async () => 't', fetch: (async () => new Response('{}', { status: 403 })) as typeof fetch }, 'http', /403.*límite de uso/)
    await rejects(fakeDrive().env(async () => { throw new DriveError('reconnect', 'Reconecta Google Drive.') }), 'reconnect', /Reconecta/)
  })

  it('traer sin copia en Drive o con archivo dañado falla con mensaje claro', async () => {
    await ing('Chocolate')
    const dr = fakeDrive(), env = dr.env()
    await expect(pullRemote(env, 'combinar', d)).rejects.toThrow(/No hay ninguna copia/)
    await syncNow(env, d)
    dr.editRemote([...dr.files.keys()][0], '{no es json')
    await expect(pullRemote(env, 'combinar', d)).rejects.toThrow(/JSON/)
  })
})

describe('Client ID revocado, eliminado o mal configurado', () => {
  it('clasifica los errores de Google: solo los que invalidan la aplicación bloquean', () => {
    for (const e of ['invalid_client', 'unauthorized_client', 'deleted_client', 'disabled_client', 'invalid_request', 'invalid_scope', 'redirect_uri_mismatch', 'origin_mismatch']) expect(isBlockingGoogleError(e), e).toBe(true)
    for (const e of ['access_denied', 'popup_closed', 'popup_failed_to_open', 'immediate_failed', undefined, '']) expect(isBlockingGoogleError(e), String(e)).toBe(false)
  })

  it('un token bloqueado detiene la sincronización sin tocar los datos locales ni perder cambios', async () => {
    await ing('Chocolate')
    const dr = fakeDrive()
    const revocado = dr.env(async () => { blockDrive('invalid_client'); throw new DriveError('blocked', BLOCKED) })
    const e = await syncNow(revocado, d).then(() => null, (x: unknown) => x)
    expect((e as DriveError).code).toBe('blocked'); expect((e as DriveError).message).toMatch(/revocarse|revocado|revocada/)
    expect(getDriveState().blocked).toBe('invalid_client')
    expect(dr.files.size).toBe(0)

    // la app sigue funcionando: datos intactos, cambios pendientes y copia manual disponible
    expect(await d.ingredients.count()).toBe(1)
    expect(getDriveState().dirty).toBe(true)
    expect((await createBackup(d)).ingredients).toHaveLength(1)
  })

  it('reintentar tras corregir la configuración vuelve a subir y limpia el bloqueo', async () => {
    await ing('Chocolate')
    const dr = fakeDrive()
    blockDrive('invalid_client')
    expect(getDriveState().blocked).toBe('invalid_client')
    unblockDrive()
    expect(getDriveState().blocked).toBeUndefined()
    expect((await syncNow(dr.env(), d)).status).toBe('uploaded')
    expect(dr.files.size).toBe(1)
  })

  it('desconectar y volver a conectar limpia un bloqueo anterior', () => {
    blockDrive('deleted_client')
    setDriveEnabled(false)
    expect(getDriveState().blocked).toBeUndefined()
    blockDrive('deleted_client'); setDriveEnabled(true)
    expect(getDriveState().blocked).toBeUndefined()
  })
})
