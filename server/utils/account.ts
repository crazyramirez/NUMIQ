import { createHash, randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import { and, eq, isNull } from 'drizzle-orm'

/**
 * Cuenta de usuario: enlaces de un solo uso (restablecer contraseña, verificar email, invitaciones)
 * y límites de intentos. En la base de datos solo se guarda el hash del enlace.
 */

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export function newToken() {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token) }
}

/** URL pública de la app para los enlaces de los correos */
export function siteUrl(event: H3Event) {
  return (useRuntimeConfig().siteUrl || getRequestURL(event, { xForwardedProto: true }).origin).replace(/\/+$/, '')
}

/** Crea un enlace de un solo uso (anula los anteriores del mismo tipo) */
export async function issueUserToken(userId: number, kind: 'reset' | 'verify', ttlMs: number) {
  const db = useDb()
  const t = tables.userTokens
  await db.update(t).set({ usedAt: new Date() }).where(and(eq(t.userId, userId), eq(t.kind, kind), isNull(t.usedAt)))
  const { token, hash } = newToken()
  await db.insert(t).values({ userId, kind, tokenHash: hash, expiresAt: new Date(Date.now() + ttlMs) })
  return token
}

/** Valida y gasta un enlace; devuelve el usuario */
export async function consumeUserToken(token: string, kind: 'reset' | 'verify') {
  const db = useDb()
  const t = tables.userTokens
  const [row] = await db.select().from(t).where(and(eq(t.tokenHash, hashToken(token)), eq(t.kind, kind)))
  if (!row || row.usedAt || row.expiresAt < new Date()) {
    throw createError({ statusCode: 400, statusMessage: 'El enlace no es válido o ha caducado: pide uno nuevo' })
  }
  await db.update(t).set({ usedAt: new Date() }).where(eq(t.id, row.id))
  return row.userId
}

// Límite de intentos en memoria (por proceso): suficiente para frenar fuerza bruta y abusos de envío
const hits = new Map<string, number[]>()

export function rateLimit(key: string, max: number, windowMs: number, message = 'Demasiados intentos: espera unos minutos') {
  const now = Date.now()
  const list = (hits.get(key) ?? []).filter(t => now - t < windowMs)
  if (list.length >= max) throw createError({ statusCode: 429, statusMessage: message })
  list.push(now)
  hits.set(key, list)
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => now - t < windowMs)) hits.delete(k)
}

/** ¿Se ha alcanzado el límite? (sin contar este intento) */
export function isRateLimited(key: string, max: number, windowMs: number) {
  const now = Date.now()
  return (hits.get(key) ?? []).filter(t => now - t < windowMs).length >= max
}

/** Anota un intento fallido */
export function recordAttempt(key: string) {
  hits.set(key, [...(hits.get(key) ?? []), Date.now()])
}

export function clearRateLimit(key: string) {
  hits.delete(key)
}

/** Correo de la cuenta (verificación, contraseña, invitaciones) con la imagen de NUMIQ */
export async function sendAccountEmail(to: string, m: { subject: string, title: string, lines: string[], action: { label: string, url: string }, footer?: string }) {
  if (!mailEnabled()) throw createError({ statusCode: 503, statusMessage: 'El envío de correo no está configurado' })
  // Dominios reservados (RFC 2606): cuentas de prueba, nunca se entregan
  if (isTestAddress(to)) {
    console.info(`[cuenta] correo a ${to} omitido (dominio de pruebas)`)
    return
  }
  const { text, html } = mailLayout({
    brand: 'NUMIQ',
    accent: '#4f46e5',
    title: m.title,
    lines: m.lines,
    action: m.action,
    footer: m.footer ?? 'Si no esperabas este correo, puedes ignorarlo.',
  })
  await sendMail({ to, subject: m.subject, text, html, fromName: 'NUMIQ' })
}

export async function sendVerificationEmail(event: H3Event, user: { id: number, email: string, name: string }) {
  const token = await issueUserToken(user.id, 'verify', 7 * 86_400_000)
  await sendAccountEmail(user.email, {
    subject: 'Confirma tu email · NUMIQ',
    title: `Hola, ${user.name.split(' ')[0]}`,
    lines: ['Confirma tu email para proteger tu cuenta: así podrás recuperarla si olvidas la contraseña.'],
    action: { label: 'Confirmar mi email', url: `${siteUrl(event)}/verificar?token=${token}` },
  })
}

export const ROLE_LABELS: Record<string, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  member: 'Equipo',
  advisor: 'Gestor (solo consulta)',
}
