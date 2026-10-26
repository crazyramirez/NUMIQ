import { and, desc, eq, isNotNull, ne, or } from 'drizzle-orm'

/**
 * Clave de OpenAI de cada usuario: la pega en Ajustes → Inteligencia artificial y se guarda cifrada con
 * AES-256-GCM (la misma custodia que los certificados, con NUXT_CERT_SECRET). Nunca vuelve al navegador
 * ni se registra. Quien no tiene clave propia usa la del titular de la empresa activa; el gestor, siempre la
 * de la empresa que lo invitó si la hay.
 */

export interface AiKey {
  key: string
  source: 'own' | 'owner'
  /** Quien presta su clave en la empresa (el titular o un administrador) */
  ownerName: string | null
  /** Quien paga en OpenAI: el propio usuario o el titular */
  userId: number
  hint: string | null
}

export const MISSING_AI_KEY = 'Añade tu clave de OpenAI en Ajustes → Inteligencia artificial para usar la IA'

export const sealAiKey = (key: string) => sealSecret(Buffer.from(key, 'utf8')).toString('base64')

function openAiKey(stored: string | null | undefined) {
  if (!stored) return null
  try {
    return openSecret(Buffer.from(stored, 'base64')).toString('utf8')
  }
  catch {
    // Cifrada con otro secreto (copia de otra instalación, NUXT_CERT_SECRET cambiado): como si no hubiera
    console.error('[ai] No se pudo descifrar una clave de OpenAI guardada: hay que volver a pegarla')
    return null
  }
}

/** «sk-proj-…a1b2»: lo justo para reconocerla */
export function aiKeyHint(key: string) {
  const prefix = key.match(/^sk-(proj-|svcacct-|admin-)?/)?.[0] ?? key.slice(0, 3)
  return `${prefix}…${key.slice(-4)}`
}

/**
 * Clave que presta la empresa: la del titular y, si no tiene, la del administrador que invitó a este usuario.
 * Nunca la de otro administrador: no paga el uso de alguien a quien no ha invitado.
 */
async function companyAiKey(companyId: number, userId: number): Promise<AiKey | null> {
  const db = useDb()
  const m = tables.companyMembers
  const i = tables.companyInvites
  const [invite] = await db.select({ by: i.invitedBy }).from(i)
    .where(and(eq(i.companyId, companyId), eq(i.acceptedBy, userId)))
    .orderBy(desc(i.id)).limit(1)
  const lenders = await db.select({ id: tables.users.id, name: tables.users.name, key: tables.users.openaiKey, hint: tables.users.openaiKeyHint, role: m.role })
    .from(m)
    .innerJoin(tables.users, eq(tables.users.id, m.userId))
    .where(and(
      eq(m.companyId, companyId),
      ne(m.userId, userId),
      isNotNull(tables.users.openaiKey),
      invite?.by ? or(eq(m.role, 'owner'), and(eq(m.role, 'admin'), eq(m.userId, invite.by))) : eq(m.role, 'owner'),
    ))
  // Primero el titular
  for (const l of lenders.sort((a, b) => Number(a.role !== 'owner') - Number(b.role !== 'owner'))) {
    const key = openAiKey(l.key)
    if (key) return { key, source: 'owner', ownerName: l.name, userId: l.id, hint: l.hint }
  }
  return null
}

/**
 * Cada uno usa su clave y, sin ella, la de la empresa. El gestor al revés: trabaja para la empresa que lo
 * invitó, así que la IA la paga ella; su clave propia solo cuenta si la empresa no tiene ninguna.
 */
export async function findAiKey(userId: number, companyId: number | null): Promise<AiKey | null> {
  const db = useDb()
  const [own] = await db.select({ key: tables.users.openaiKey, hint: tables.users.openaiKeyHint }).from(tables.users).where(eq(tables.users.id, userId))
  const key = openAiKey(own?.key)
  const mine: AiKey | null = key ? { key, source: 'own', ownerName: null, userId, hint: own!.hint } : null
  if (!companyId) return mine
  const [member] = await db.select({ role: tables.companyMembers.role }).from(tables.companyMembers)
    .where(and(eq(tables.companyMembers.companyId, companyId), eq(tables.companyMembers.userId, userId)))
  if (mine && member?.role !== 'advisor') return mine
  return (await companyAiKey(companyId, userId)) ?? mine
}

/**
 * Clave de quien hace la petición en curso (requireCompany deja usuario y empresa en el contexto), también
 * para el trabajo que sigue en segundo plano. Se busca una sola vez por petición.
 */
export function currentAiKey(): Promise<AiKey | null> {
  let event
  try {
    event = useEvent()
  }
  catch {
    return Promise.resolve(null)
  }
  const scope = event.context.aiScope as { companyId: number, userId: number } | undefined
  if (!scope) return Promise.resolve(null)
  return (event.context.aiKey ??= findAiKey(scope.userId, scope.companyId))
}

/**
 * Comprueba con OpenAI que la clave existe antes de guardarla. Solo un 401 la rechaza: una clave
 * restringida puede no tener permiso para listar modelos (403) y aun así leer documentos.
 */
export async function checkAiKey(key: string) {
  let res: Response
  try {
    res = await fetch('https://api.openai.com/v1/models?limit=1', { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) })
  }
  catch {
    throw createError({ statusCode: 502, statusMessage: 'No se pudo comprobar la clave con OpenAI: inténtalo de nuevo' })
  }
  if (res.status === 401) throw createError({ statusCode: 400, statusMessage: 'OpenAI no reconoce esta clave: cópiala de nuevo completa', data: { field: 'key' } })
}
