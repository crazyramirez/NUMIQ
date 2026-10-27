import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'

/**
 * Bloqueo de NUMIQ con la huella, la cara o el PIN del dispositivo. Solo en las sesiones de un dispositivo
 * con llave de acceso (sin llave no hay con qué desbloquear) y lo decide el servidor: con la sesión
 * bloqueada, la API responde 423 a todo salvo entrar, salir y desbloquear (middleware/01.app-lock.ts).
 * Quitar la pantalla de bloqueo en el navegador no da acceso a ningún dato. El estado va en la parte
 * sellada de la cookie de sesión: no se puede falsear ni depende de qué proceso atienda la petición.
 */
export type LockMode = 'always' | 'daily' | 'off'

/** «Siempre»: sin señales de vida de la app a la vista durante este tiempo, se vuelve a pedir */
export const LOCK_AWAY_MS = 2 * 60_000
/** En el ordenador se cambia de ventana a cada rato: cuenta el rato sin usarla, como el bloqueo de pantalla */
export const LOCK_AWAY_DESK_MS = 15 * 60_000
/** «Una vez al día» */
export const LOCK_DAILY_MS = 24 * 60 * 60_000
/** Bajar la protección o quitar una llave: solo con la identidad comprobada hace muy poco */
export const LOCK_RECENT_MS = 5 * 60_000

export function weakerLock(next: LockMode, prev: LockMode) {
  return LOCK_RANK[next] < LOCK_RANK[prev]
}

/** `desk`: sesión de un ordenador (lo dice la app con la sesión desbloqueada) */
interface SessionLock { key?: string, at?: number, seen?: number, verified?: number, desk?: boolean }

const awayMs = (lock: SessionLock) => (lock.desk ? LOCK_AWAY_DESK_MS : LOCK_AWAY_MS)

export interface LockStatus {
  userId: number
  mode: LockMode
  /** Llaves de acceso de la cuenta */
  keys: string[]
  /** La sesión es de un dispositivo con llave: se bloquea según el modo */
  bound: boolean
  locked: boolean
  lock: SessionLock
}

/** Modo y llaves de cada usuario: se miran en cada petición, así que se recuerdan unos segundos */
const infoCache = new Map<number, { at: number, mode: LockMode, keys: string[] }>()
const INFO_TTL = 10_000

async function lockInfo(userId: number) {
  const hit = infoCache.get(userId)
  if (hit && Date.now() - hit.at < INFO_TTL) return hit
  const db = useDb()
  const [[user], keys] = await Promise.all([
    db.select({ mode: tables.users.lockMode }).from(tables.users).where(eq(tables.users.id, userId)),
    db.select({ id: tables.userPasskeys.id }).from(tables.userPasskeys).where(eq(tables.userPasskeys.userId, userId)),
  ])
  if (infoCache.size > 5000) infoCache.clear()
  const info = { at: Date.now(), mode: user?.mode ?? 'off', keys: keys.map(k => k.id) }
  infoCache.set(userId, info)
  return info
}

/** Tras cambiar el modo o las llaves: que cuente ya en la siguiente petición */
export function forgetLockInfo(userId: number) {
  infoCache.delete(userId)
}

export async function lockStatus(event: H3Event): Promise<LockStatus | null> {
  const session = await getUserSession(event)
  if (!session.user) return null
  const lock: SessionLock = session.secure?.lock ?? {}
  const { mode, keys } = await lockInfo(session.user.id)
  const bound = !!lock.key && (lock.key === '*' ? keys.length > 0 : keys.includes(lock.key))
  const now = Date.now()
  const locked = bound && (
    mode === 'daily'
      ? now - (lock.at ?? 0) > LOCK_DAILY_MS
      : mode === 'always' && now - Math.max(lock.at ?? 0, lock.seen ?? 0) > awayMs(lock))
  return { userId: session.user.id, mode, keys, bound, locked, lock }
}

export async function requireLockStatus(event: H3Event) {
  const status = await lockStatus(event)
  if (!status) throw createError({ statusCode: 401, statusMessage: 'Inicia sesión' })
  return status
}

export function lockedError() {
  return createError({ statusCode: 423, statusMessage: 'NUMIQ está bloqueada: desbloquéala con tu huella, tu cara o el PIN', data: { locked: true } })
}

/** Lo que la app necesita saber (nunca el contenido de la cookie) */
export function lockPayload(s: LockStatus) {
  return { mode: s.mode, hasKeys: s.keys.length > 0, bound: s.bound, locked: s.locked, unlockedAt: s.lock.at ?? null, awayMs: awayMs(s.lock), dailyMs: LOCK_DAILY_MS }
}

/** Bloqueo de una sesión recién iniciada (contraseña, llave o enlace del correo): desbloqueada y comprobada */
export function freshLock(key?: string): SessionLock {
  const now = Date.now()
  return { ...(key ? { key } : {}), at: now, seen: now, verified: now }
}

export async function updateSessionLock(event: H3Event, lock: SessionLock) {
  const prev = (await getUserSession(event)).secure?.lock ?? {}
  await setUserSession(event, { secure: { lock: { ...prev, ...lock } } })
}

/** Identidad comprobada ahora (huella, cara, PIN o contraseña), con la llave de este dispositivo si se sabe */
export async function markUnlocked(event: H3Event, key?: string) {
  await updateSessionLock(event, freshLock(key))
}

/**
 * Bajar la protección (modo más flojo, quitar una llave) pide haber confirmado la identidad hace muy poco:
 * quien coge el móvil desbloqueado un momento no puede dejarlo sin bloqueo para después.
 * El 403 con `reverify` hace que la app pida la huella o la contraseña y repita la petición
 */
export function requireRecentVerification(status: LockStatus) {
  if (!status.keys.length || Date.now() - (status.lock.verified ?? 0) < LOCK_RECENT_MS) return
  throw createError({ statusCode: 403, statusMessage: 'Confirma que eres tú para hacer este cambio', data: { reverify: true } })
}

// Al final del archivo: la búsqueda de exportaciones de Nuxt se salta la que sigue a un literal
const LOCK_RANK: Record<LockMode, number> = Object.freeze({ off: 0, daily: 1, always: 2 })
