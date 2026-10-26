import { and, eq, isNotNull } from 'drizzle-orm'

/**
 * Clave de OpenAI de cada usuario: la pega en Ajustes → Inteligencia artificial y se guarda cifrada con
 * AES-256-GCM (la misma custodia que los certificados, con NUXT_CERT_SECRET). Nunca vuelve al navegador
 * ni se registra. Quien no tiene clave propia usa la del titular de la empresa activa (empleados, gestores).
 */

export interface AiKey {
  key: string
  source: 'own' | 'owner'
  /** Titular de la empresa que presta su clave */
  ownerName: string | null
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

export async function findAiKey(userId: number, companyId: number | null): Promise<AiKey | null> {
  const db = useDb()
  const [own] = await db.select({ key: tables.users.openaiKey }).from(tables.users).where(eq(tables.users.id, userId))
  const key = openAiKey(own?.key)
  if (key) return { key, source: 'own', ownerName: null }
  if (!companyId) return null
  const [owner] = await db.select({ name: tables.users.name, key: tables.users.openaiKey })
    .from(tables.companyMembers)
    .innerJoin(tables.users, eq(tables.users.id, tables.companyMembers.userId))
    .where(and(eq(tables.companyMembers.companyId, companyId), eq(tables.companyMembers.role, 'owner'), isNotNull(tables.users.openaiKey)))
    .limit(1)
  const ownerKey = openAiKey(owner?.key)
  return ownerKey ? { key: ownerKey, source: 'owner', ownerName: owner!.name } : null
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
