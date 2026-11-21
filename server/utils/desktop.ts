import { timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { H3Event } from 'h3'

/**
 * NUMIQ de escritorio (carpeta desktop/): el mismo servidor, arrancado por la app de Electron en el
 * ordenador del usuario con su propia base de datos. La app lo indica con NUMIQ_DESKTOP=1 y pasa:
 *  - NUMIQ_DESKTOP_SETTINGS: JSON con lo que en un servidor iría en el .env (el correo de envío)
 *  - NUMIQ_DESKTOP_TOKEN: secreto que solo conoce la ventana de la app (acciones locales, p. ej.
 *    elegir una contraseña nueva sin correo)
 * Sin URL pública: los enlaces para clientes y gestores no existen y los avisos salen como
 * notificaciones del sistema.
 */
export const isDesktop = () => process.env.NUMIQ_DESKTOP === '1'

export interface DesktopMail {
  user: string
  /** Contraseña de aplicación cifrada (sealSecret, base64) */
  password: string
  smtpHost: string
  smtpPort: number
  fromName: string
}

export interface DesktopSettings {
  mail?: DesktopMail | null
}

let cache: { at: number, value: DesktopSettings } | null = null

function settingsFile() {
  return process.env.NUMIQ_DESKTOP_SETTINGS || ''
}

export function desktopSettings(): DesktopSettings {
  const file = settingsFile()
  if (!isDesktop() || !file) return {}
  if (cache && Date.now() - cache.at < 2000) return cache.value
  let value: DesktopSettings = {}
  try {
    if (existsSync(file)) value = JSON.parse(readFileSync(file, 'utf8')) as DesktopSettings
  }
  catch (err) {
    console.error('[escritorio] No se pudo leer la configuración:', (err as Error).message)
  }
  cache = { at: Date.now(), value }
  return value
}

export function saveDesktopSettings(patch: Partial<DesktopSettings>) {
  const file = settingsFile()
  if (!isDesktop() || !file) throw createError({ statusCode: 404, statusMessage: 'Solo en NUMIQ de escritorio' })
  const value = { ...desktopSettings(), ...patch }
  mkdirSync(dirname(file), { recursive: true })
  // Escritura atómica: un cierre a mitad nunca deja el archivo cortado
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 })
  renameSync(`${file}.tmp`, file)
  cache = { at: Date.now(), value }
  return value
}

export const sealDesktopSecret = (s: string) => sealSecret(Buffer.from(s, 'utf8')).toString('base64')

export function openDesktopSecret(s: string | null | undefined) {
  if (!s) return ''
  try {
    return openSecret(Buffer.from(s, 'base64')).toString('utf8')
  }
  catch {
    console.error('[escritorio] No se pudo descifrar la contraseña del correo: hay que volver a escribirla')
    return ''
  }
}

/** Correo de envío configurado en Ajustes → Correo (solo escritorio) */
export function desktopMail() {
  const m = desktopSettings().mail
  if (!m?.user) return null
  return { ...m, password: openDesktopSecret(m.password) }
}

/** La petición viene de la ventana de la app de escritorio (lleva su secreto) */
export function requireDesktopWindow(event: H3Event) {
  const expected = process.env.NUMIQ_DESKTOP_TOKEN ?? ''
  const got = getHeader(event, 'x-numiq-desktop') ?? ''
  const ok = isDesktop() && expected.length >= 32 && got.length === expected.length
    && timingSafeEqual(Buffer.from(got), Buffer.from(expected))
  if (!ok) throw createError({ statusCode: 403, statusMessage: 'Solo desde la app de escritorio' })
}

/**
 * Aviso del sistema (Windows, macOS, Linux): la app de Electron lo recibe por su canal con el
 * servidor (utilityProcess) y lo muestra; al pulsarlo abre `url` en la ventana.
 */
export function desktopNotify(payload: { title: string, body?: string, url?: string, tag?: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const port = (process as any).parentPort as { postMessage: (m: unknown) => void } | undefined
  if (!port) return false
  port.postMessage({ type: 'notify', ...payload })
  return true
}
