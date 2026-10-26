import { and, eq } from 'drizzle-orm'

/**
 * Desbloquear NUMIQ (o confirmar un cambio) con una llave de acceso de la cuenta: la del dispositivo, o la
 * del móvil con el QR en un ordenador sin huella. Siempre con la huella, la cara o el PIN comprobados:
 * tocar una llave USB sin PIN no basta
 */
const handler = defineWebAuthnAuthenticateEventHandler({
  async getOptions(event) {
    const { user } = await requireUserSession(event)
    const rows = await useDb().select({ id: tables.userPasskeys.id, transports: tables.userPasskeys.transports })
      .from(tables.userPasskeys).where(eq(tables.userPasskeys.userId, user.id))
    return {
      userVerification: 'required' as const,
      allowCredentials: rows.map(r => ({ id: r.id, transports: (r.transports ?? undefined) as never })),
    }
  },
  storeChallenge: (_event, challenge, attemptId) => storePasskeyChallenge(challenge, attemptId),
  getChallenge: (_event, attemptId) => takePasskeyChallenge(attemptId),
  // Solo llaves de quien tiene la sesión: la de otra cuenta en el mismo móvil no desbloquea esta
  async getCredential(event, credentialId) {
    const { user } = await requireUserSession(event)
    const [row] = await useDb().select().from(tables.userPasskeys)
      .where(and(eq(tables.userPasskeys.id, credentialId), eq(tables.userPasskeys.userId, user.id)))
    if (!row) throw createError({ statusCode: 400, statusMessage: 'Esta llave ya no está en tu cuenta: usa tu contraseña' })
    return { id: row.id, publicKey: row.publicKey, counter: row.counter, backedUp: row.backedUp, transports: (row.transports ?? undefined) as never, userId: row.userId }
  },
  async onSuccess(event, { credential, authenticationInfo }) {
    if (!authenticationInfo.userVerified) throw createError({ statusCode: 400, statusMessage: 'Hace falta tu huella, tu cara o el PIN del dispositivo' })
    const user = await requireUser(event)
    await useDb().update(tables.userPasskeys).set({ counter: authenticationInfo.newCounter, lastUsedAt: new Date() }).where(eq(tables.userPasskeys.id, credential.id))
    const body = await readBody<{ response?: { authenticatorAttachment?: string } }>(event)
    await markUnlocked(event, body?.response?.authenticatorAttachment === 'platform' ? credential.id : undefined)
    await audit(event, { userId: user.id, companyId: user.currentCompanyId, action: 'user.unlock', data: { method: 'passkey' } })
  },
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  // Como la entrada: 30 comprobaciones cada 15 minutos (pedir el reto, con más margen)
  const verify = (await readBody<{ verify?: boolean }>(event).catch(() => null))?.verify === true
  const [key, max] = verify ? [`unlock:${user.id}`, 30] : [`unlock-opts:${user.id}`, 300]
  if (isRateLimited(key, max, 15 * 60_000)) throw createError({ statusCode: 429, statusMessage: 'Demasiados intentos: espera unos minutos o usa tu contraseña' })
  recordAttempt(key)
  alignPasskeyOrigin(event)
  return handler(event)
})
