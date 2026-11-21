import { eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({ email: emailField() })

/**
 * ¿Olvidaste la contraseña? en el escritorio: no hace falta correo, quien está delante del equipo
 * es el dueño de la cuenta. Solo responde a la ventana de la app (lleva su secreto) y devuelve el
 * enlace de un solo uso para elegir una contraseña nueva en /restablecer.
 */
export default defineEventHandler(async (event) => {
  requireDesktopWindow(event)
  const { email } = await readInput(event, schema)
  rateLimit(`desktop-reset:${email}`, 10, 15 * 60_000)
  const [user] = await useDb().select({ id: tables.users.id }).from(tables.users).where(eq(tables.users.email, email))
  if (!user) throw createError({ statusCode: 404, statusMessage: 'No hay ninguna cuenta con ese email en este equipo', data: { field: 'email' } })
  const token = await issueUserToken(user.id, 'reset', 15 * 60_000)
  await audit(event, { userId: user.id, action: 'user.password.forgot' })
  return { token }
})
