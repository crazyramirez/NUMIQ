import { eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({ email: emailField() })

/**
 * Enlace para restablecer la contraseña (válido 1 hora). Siempre responde lo mismo, exista o no la
 * cuenta: así no se puede averiguar qué emails están registrados.
 */
export default defineEventHandler(async (event) => {
  const { email } = await readInput(event, schema)
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'ip'
  rateLimit(`forgot:${ip}`, 8, 15 * 60_000)
  rateLimit(`forgot:${email}`, 3, 15 * 60_000, 'Ya te hemos enviado un enlace: revisa tu correo (también el spam)')
  const [user] = await useDb().select({ id: tables.users.id, email: tables.users.email, name: tables.users.name }).from(tables.users).where(eq(tables.users.email, email))
  if (user) {
    const token = await issueUserToken(user.id, 'reset', 60 * 60_000)
    try {
      await sendAccountEmail(user.email, {
        subject: 'Restablece tu contraseña · NUMIQ',
        title: `Hola, ${user.name.split(' ')[0]}`,
        lines: ['Has pedido restablecer tu contraseña. El enlace caduca en una hora y solo se puede usar una vez.'],
        action: { label: 'Elegir una contraseña nueva', url: `${siteUrl(event)}/restablecer?token=${token}` },
        footer: 'Si no lo has pedido tú, ignora este correo: tu contraseña sigue igual.',
      })
    }
    catch (err) {
      console.error('[auth] email de restablecimiento', err)
    }
    await audit(event, { userId: user.id, action: 'user.password.forgot' })
  }
  return { ok: true }
})
