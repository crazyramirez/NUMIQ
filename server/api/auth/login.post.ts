import { eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  email: emailField(),
  password: z.string().min(1, 'Escribe tu contraseña').max(200),
})

export default defineEventHandler(async (event) => {
  const body = await readInput(event, schema)
  // Fuerza bruta: 8 fallos por cuenta y 30 por IP cada 15 minutos
  const byEmail = `login:${body.email}`
  const byIp = `login-ip:${getRequestIP(event, { xForwardedFor: true }) ?? 'ip'}`
  if (isRateLimited(byEmail, 8, 15 * 60_000) || isRateLimited(byIp, 30, 15 * 60_000)) {
    throw createError({ statusCode: 429, statusMessage: 'Demasiados intentos fallidos: espera 15 minutos o restablece tu contraseña' })
  }
  const db = useDb()
  const [user] = await db.select().from(tables.users).where(eq(tables.users.email, body.email))
  if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, body.password))) {
    recordAttempt(byEmail)
    recordAttempt(byIp)
    throw createError({ statusCode: 401, statusMessage: 'Email o contraseña incorrectos' })
  }
  clearRateLimit(byEmail)
  await db.update(tables.users).set({ lastLoginAt: new Date() }).where(eq(tables.users.id, user.id))
  // Sesión nueva, sin restos de otra: la app la asocia después a la llave del dispositivo si la tiene
  await replaceUserSession(event, { user: sessionUser(user), loggedInAt: Date.now(), secure: { lock: freshLock() } })
  await audit(event, { userId: user.id, companyId: user.currentCompanyId, action: 'user.login' })
  return { user: sessionUser(user) }
})
