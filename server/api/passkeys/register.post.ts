import { eq } from 'drizzle-orm'

/** Crea una llave de acceso (huella, cara o PIN) para el usuario con la sesión iniciada */
const handler = defineWebAuthnRegisterEventHandler({
  // Llave «descubrible»: se puede entrar sin escribir el email, y el sistema la muestra como NUMIQ
  getOptions: () => ({
    rpName: 'NUMIQ',
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  }),
  async validateUser(userBody, event) {
    const user = await requireUser(event)
    if (String(userBody.userName).toLowerCase() !== user.email.toLowerCase()) {
      throw createError({ statusCode: 400, statusMessage: 'La llave debe ser de tu propia cuenta' })
    }
    return { userName: user.email, displayName: user.name }
  },
  // No volver a registrar una llave que este dispositivo ya tiene
  async excludeCredentials(event) {
    const user = await requireUser(event)
    const rows = await useDb().select({ id: tables.userPasskeys.id, transports: tables.userPasskeys.transports })
      .from(tables.userPasskeys).where(eq(tables.userPasskeys.userId, user.id))
    return rows.map(r => ({ id: r.id, transports: (r.transports ?? undefined) as never }))
  },
  storeChallenge: (_event, challenge, attemptId) => storePasskeyChallenge(challenge, attemptId),
  getChallenge: (_event, attemptId) => takePasskeyChallenge(attemptId),
  async onSuccess(event, { credential }) {
    const user = await requireUser(event)
    await useDb().insert(tables.userPasskeys).values({
      id: credential.id,
      userId: user.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      backedUp: credential.backedUp,
      transports: credential.transports ?? [],
      name: deviceName(event),
    })
    forgetLockInfo(user.id)
    // Llave creada en este mismo dispositivo: desde ahora la sesión se bloquea con ella
    const body = await readBody<{ response?: { authenticatorAttachment?: string } }>(event)
    if (body?.response?.authenticatorAttachment === 'platform') await markUnlocked(event, credential.id)
    await audit(event, { userId: user.id, companyId: user.currentCompanyId, action: 'user.passkey.add' })
  },
})

export default defineEventHandler(async (event) => {
  alignPasskeyOrigin(event)
  return handler(event)
})
