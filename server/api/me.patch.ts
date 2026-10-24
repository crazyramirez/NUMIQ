import { eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  name: z.string().trim().min(2, 'Escribe tu nombre').max(120).optional(),
  currentPassword: z.string().max(200).optional(),
  newPassword: z.string().min(8, 'La contraseña nueva necesita al menos 8 caracteres').max(200).optional(),
})

/** Datos de la propia cuenta: nombre y contraseña (pide la actual) */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const input = await readInput(event, schema)
  const db = useDb()
  const [user] = await db.select().from(tables.users).where(eq(tables.users.id, me.id))
  const values: Partial<typeof tables.users.$inferInsert> = {}
  if (input.name) values.name = input.name
  if (input.newPassword) {
    rateLimit(`password:${me.id}`, 6, 15 * 60_000)
    if (!user?.passwordHash || !input.currentPassword || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw createError({ statusCode: 400, statusMessage: 'La contraseña actual no es correcta', data: { field: 'currentPassword' } })
    }
    values.passwordHash = await hashPassword(input.newPassword)
  }
  if (!Object.keys(values).length) return { ok: true }
  await db.update(tables.users).set(values).where(eq(tables.users.id, me.id))
  if (values.name) await setUserSession(event, { user: sessionUser({ ...user!, name: values.name }) })
  await audit(event, { userId: me.id, action: input.newPassword ? 'user.password.change' : 'user.update' })
  return { ok: true }
})
