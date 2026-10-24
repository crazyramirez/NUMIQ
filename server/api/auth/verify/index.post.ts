import { eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({ token: z.string().min(20).max(100) })

/** Confirma el email con el enlace del correo */
export default defineEventHandler(async (event) => {
  const { token } = await readInput(event, schema)
  rateLimit(`verify-token:${getRequestIP(event, { xForwardedFor: true }) ?? 'ip'}`, 20, 15 * 60_000)
  const userId = await consumeUserToken(token, 'verify')
  await useDb().update(tables.users).set({ emailVerifiedAt: new Date() }).where(eq(tables.users.id, userId))
  await audit(event, { userId, action: 'user.email.verified' })
  return { ok: true }
})
