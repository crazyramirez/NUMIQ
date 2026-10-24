import { eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  name: z.string().trim().min(2, 'Escribe tu nombre').max(120),
  email: emailField(),
  password: z.string().min(8, 'La contraseña necesita al menos 8 caracteres').max(200),
})

export default defineEventHandler(async (event) => {
  const body = await readInput(event, schema)
  rateLimit(`register:${getRequestIP(event, { xForwardedFor: true }) ?? 'ip'}`, 10, 60 * 60_000)
  const db = useDb()
  const [exists] = await db.select({ id: tables.users.id }).from(tables.users).where(eq(tables.users.email, body.email))
  if (exists) throw createError({ statusCode: 409, statusMessage: 'Ya hay una cuenta con ese email', data: { field: 'email' } })

  const [res] = await db.insert(tables.users).values({
    name: body.name,
    email: body.email,
    passwordHash: await hashPassword(body.password),
    lastLoginAt: new Date(),
  }).$returningId()
  const user = { id: res!.id, email: body.email, name: body.name, avatarUrl: null }
  await setUserSession(event, { user: sessionUser(user), loggedInAt: Date.now() })
  await audit(event, { userId: user.id, action: 'user.register' })
  // Correo de confirmación: si falla, la cuenta funciona igual y se puede reenviar después
  if (mailEnabled()) await sendVerificationEmail(event, user).catch(err => console.error('[auth] verificación', err))
  return { user }
})
