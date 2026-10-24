import { eq } from 'drizzle-orm'

/** Entrar con una llave de acceso: sin contraseña, con la huella, la cara o el PIN del dispositivo */
const handler = defineWebAuthnAuthenticateEventHandler({
  // Si ha escrito su email, el navegador ofrece directamente sus llaves
  async allowCredentials(_event, userName) {
    const [user] = await useDb().select({ id: tables.users.id }).from(tables.users).where(eq(tables.users.email, String(userName).toLowerCase()))
    if (!user) return []
    const rows = await useDb().select({ id: tables.userPasskeys.id, transports: tables.userPasskeys.transports })
      .from(tables.userPasskeys).where(eq(tables.userPasskeys.userId, user.id))
    return rows.map(r => ({ id: r.id, transports: (r.transports ?? undefined) as never }))
  },
  storeChallenge: (_event, challenge, attemptId) => storePasskeyChallenge(challenge, attemptId),
  getChallenge: (_event, attemptId) => takePasskeyChallenge(attemptId),
  async getCredential(_event, credentialId) {
    const [row] = await useDb().select().from(tables.userPasskeys).where(eq(tables.userPasskeys.id, credentialId))
    if (!row) throw createError({ statusCode: 400, statusMessage: 'Esta llave ya no está en tu cuenta: entra con tu contraseña' })
    return { id: row.id, publicKey: row.publicKey, counter: row.counter, backedUp: row.backedUp, transports: (row.transports ?? undefined) as never, userId: row.userId }
  },
  async onSuccess(event, { credential, authenticationInfo }) {
    const db = useDb()
    const [user] = await db.select().from(tables.users).where(eq(tables.users.id, Number(credential.userId)))
    if (!user) throw createError({ statusCode: 400, statusMessage: 'Cuenta no encontrada' })
    await db.update(tables.userPasskeys).set({ counter: authenticationInfo.newCounter, lastUsedAt: new Date() }).where(eq(tables.userPasskeys.id, credential.id))
    await db.update(tables.users).set({ lastLoginAt: new Date() }).where(eq(tables.users.id, user.id))
    await setUserSession(event, { user: sessionUser(user), loggedInAt: Date.now() })
    await audit(event, { userId: user.id, companyId: user.currentCompanyId, action: 'user.login', data: { method: 'passkey' } })
  },
})

export default defineEventHandler(async (event) => {
  // Mismo freno que el acceso con contraseña: 30 comprobaciones por IP cada 15 minutos. Pedir el reto
  // (cada vez que se abre la pantalla de entrada, y cada 4 minutos para la sugerencia del teclado) tiene un margen mayor
  const verify = (await readBody<{ verify?: boolean }>(event).catch(() => null))?.verify === true
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'ip'
  const [key, max] = verify ? [`passkey-ip:${ip}`, 30] : [`passkey-opts-ip:${ip}`, 300]
  if (isRateLimited(key, max, 15 * 60_000)) throw createError({ statusCode: 429, statusMessage: 'Demasiados intentos: espera unos minutos' })
  recordAttempt(key)
  alignPasskeyOrigin(event)
  return handler(event)
})
