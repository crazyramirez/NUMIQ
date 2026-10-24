import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/mysql2'
import { migrate } from 'drizzle-orm/mysql2/migrator'
import mysql from 'mysql2/promise'
import * as schema from '../db/schema'

export const tables = schema

export interface DbTarget {
  /** Socket Unix de MySQL (p. ej. /var/lib/mysql/mysql.sock): para usuarios que solo pueden entrar como 'localhost' */
  socketPath?: string
  host: string
  port: number
  user: string
  password: string
  database: string
}

/**
 * Datos de conexión. Admite dos formas:
 *  - Variables sueltas (recomendado en Plesk: la contraseña no necesita codificarse):
 *    DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME  (o NUXT_DATABASE_HOST/_PORT/_USER/_PASSWORD/_NAME)
 *    y opcionalmente DB_SOCKET para conectar por el socket Unix en vez de TCP
 *  - Una URL: NUXT_DATABASE_URL=mysql://usuario:contraseña@host:3306/base_de_datos
 */
export function dbTarget(): DbTarget {
  const e = process.env
  const host = e.NUXT_DATABASE_HOST || e.DB_HOST
  const socketPath = e.NUXT_DATABASE_SOCKET || e.DB_SOCKET || undefined
  if (host || socketPath) {
    return {
      socketPath,
      host: host || 'localhost',
      port: Number(e.NUXT_DATABASE_PORT || e.DB_PORT || 3306),
      user: e.NUXT_DATABASE_USER || e.DB_USER || 'root',
      password: e.NUXT_DATABASE_PASSWORD ?? e.DB_PASSWORD ?? '',
      database: e.NUXT_DATABASE_NAME || e.DB_NAME || e.DB_DATABASE || 'numiq',
    }
  }
  const rawUrl = e.NUXT_DATABASE_URL || (typeof useRuntimeConfig === 'function' ? useRuntimeConfig()?.databaseUrl : '') || 'mysql://root:@127.0.0.1:3308/numiq'
  const url = new URL(rawUrl)
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')) || 'numiq',
  }
}

function createDb() {
  const target = dbTarget()
  const pool = mysql.createPool({
    ...target,
    connectionLimit: 10,
    charset: 'utf8mb4',
    timezone: 'Z',
    supportBigNumbers: true,
    enableKeepAlive: true,
  })
  // Fechas siempre en UTC independientemente de la zona del servidor MySQL
  pool.pool.on('connection', (conn) => {
    conn.query('SET time_zone = \'+00:00\'')
  })
  return drizzle(pool, { schema, mode: 'default' })
}

let _db: ReturnType<typeof createDb> | undefined

export function useDb() {
  if (!_db) _db = createDb()
  return _db
}

export type Db = ReturnType<typeof useDb>

function migrationsFolder() {
  const candidates = [
    resolve(process.cwd(), 'server/db/migrations'),
    resolve(process.cwd(), '.output/server/migrations'),
    resolve(process.cwd(), 'migrations'),
  ]
  return candidates.find(p => existsSync(resolve(p, 'meta/_journal.json')))
}

/** Crea la base de datos si no existe (útil en local; en Plesk se crea desde el panel). */
async function ensureDatabaseExists(target: DbTarget) {
  if (!/^[\w$-]+$/.test(target.database)) return
  let conn: mysql.Connection | undefined
  try {
    conn = await mysql.createConnection({ socketPath: target.socketPath, host: target.host, port: target.port, user: target.user, password: target.password, connectTimeout: 8000 })
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${target.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  }
  catch {
    // Sin permisos para crear bases de datos: se asume que ya existe
  }
  finally {
    await conn?.end().catch(() => {})
  }
}

const HINTS: Record<string, string> = {
  ER_ACCESS_DENIED_ERROR: 'usuario o contraseña de MySQL incorrectos',
  ER_DBACCESS_DENIED_ERROR: 'el usuario de MySQL no tiene permisos sobre esa base de datos',
  ER_BAD_DB_ERROR: 'la base de datos no existe (créala en el panel)',
  ECONNREFUSED: 'no hay ningún MySQL escuchando en ese host/puerto',
  ENOTFOUND: 'no se encuentra el host de MySQL',
  ETIMEDOUT: 'el servidor MySQL no responde',
}

/** Código del error de MySQL (Drizzle esconde la causa real en err.cause) */
export function dbErrorCode(err: unknown): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let e: any = err
  while (e?.cause && !e.code) e = e.cause
  return e?.code
}

/** Explica un error de conexión sin exponer contraseñas (Drizzle esconde la causa real en err.cause). */
export function describeDbError(err: unknown, target?: DbTarget) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let e: any = err
  while (e?.cause && !e.code) e = e.cause
  const code = e?.code as string | undefined
  const t = (() => {
    try {
      const d = target ?? dbTarget()
      return `${d.socketPath ?? `${d.host}:${d.port}`}/${d.database}`
    }
    catch {
      return 'configuración inválida'
    }
  })()
  if (code && HINTS[code]) {
    // "using password: NO" = la contraseña llegó vacía (no se leyó DB_PASSWORD o un # la cortó en el .env)
    const sent = /using password: (YES|NO)/.exec(String(e?.message ?? ''))?.[1]
    if (sent) console.error('[db]', e.message)
    return `${HINTS[code]} (${code}, ${t}${sent ? `, contraseña enviada: ${sent === 'YES' ? 'sí' : 'no'}` : ''})`
  }
  return `${e?.message ?? String(err)} (${t})`
}

let _ready: Promise<void> | undefined

/** Ejecuta las migraciones una sola vez por proceso. */
export function ensureDbReady() {
  if (_ready) return _ready
  _ready = (async () => {
    if (!useRuntimeConfig().autoMigrate) return
    await ensureDatabaseExists(dbTarget())
    const folder = migrationsFolder()
    if (!folder) {
      console.warn('[db] No se encontró carpeta de migraciones; se omite la migración automática')
      return
    }
    const db = useDb()
    try {
      await db.execute('ALTER DATABASE CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
    }
    catch {
      // Sin permisos para ALTER DATABASE: no es crítico
    }
    await migrate(db, { migrationsFolder: folder })
    console.info('[db] Migraciones aplicadas')
  })().catch((err) => {
    _ready = undefined
    const msg = describeDbError(err)
    console.error('[db] No se pudo preparar la base de datos:', msg)
    throw new Error(msg)
  })
  return _ready
}
