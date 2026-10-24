import { eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  token: z.string().min(20).max(100),
  password: z.string().min(8, 'La contraseña necesita al menos 8 caracteres').max(200),
})

/** Nueva contraseña con el enlace del correo; entra directamente en la cuenta */
export default defineEventHandler(async (event) => {
  const input = await readInput(event, schema)
  rateLimit(`reset:${getRequestIP(event, { xForwardedFor: true }) ?? 'ip'}`, 10, 15 * 60_000)
  const userId = await consumeUserToken(input.token, 'reset')
  const db = useDb()
  // Quien recibe el enlace en su correo demuestra que el email es suyo
  await db.update(tables.users).set({ passwordHash: await hashPassword(input.password), emailVerifiedAt: new Date(), lastLoginAt: new Date() }).where(eq(tables.users.id, userId))
  const [user] = await db.select().from(tables.users).where(eq(tables.users.id, userId))
  await setUserSession(event, { user: sessionUser(user!), loggedInAt: Date.now() })
  clearRateLimit(`login:${user!.email}`)
  await audit(event, { userId, action: 'user.password.reset' })
  return { ok: true }
})
