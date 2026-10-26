import { eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({ password: z.string().min(1, 'Escribe tu contraseña').max(200) })

/**
 * Desbloquear (o confirmar un cambio) con la contraseña, si la huella o Face ID no van. Comparte el freno
 * de la pantalla de entrada: no da más intentos que cerrar sesión y volver a entrar
 */
export default defineEventHandler(async (event) => {
  const { password } = await readInput(event, schema)
  const user = await requireUser(event)
  const [row] = await useDb().select({ passwordHash: tables.users.passwordHash }).from(tables.users).where(eq(tables.users.id, user.id))
  const byEmail = `login:${user.email.toLowerCase()}`
  const byIp = `login-ip:${getRequestIP(event, { xForwardedFor: true }) ?? 'ip'}`
  if (isRateLimited(byEmail, 8, 15 * 60_000) || isRateLimited(byIp, 30, 15 * 60_000)) {
    throw createError({ statusCode: 429, statusMessage: 'Demasiados intentos fallidos: espera 15 minutos' })
  }
  if (!row?.passwordHash) throw createError({ statusCode: 400, statusMessage: 'Tu cuenta no tiene contraseña: usa tu huella, Face ID o el PIN' })
  if (!(await verifyPassword(row.passwordHash, password))) {
    recordAttempt(byEmail)
    recordAttempt(byIp)
    throw createError({ statusCode: 400, statusMessage: 'Contraseña incorrecta', data: { field: 'password' } })
  }
  clearRateLimit(byEmail)
  await markUnlocked(event)
  await audit(event, { userId: user.id, companyId: user.currentCompanyId, action: 'user.unlock', data: { method: 'password' } })
  return { ok: true }
})
