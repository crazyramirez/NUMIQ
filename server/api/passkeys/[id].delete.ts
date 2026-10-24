import { and, eq } from 'drizzle-orm'

/** Quita una llave de acceso (p. ej. de un móvil que ya no usas) */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = decodeURIComponent(getRouterParam(event, 'id') ?? '')
  const r = await useDb().delete(tables.userPasskeys).where(and(eq(tables.userPasskeys.id, id), eq(tables.userPasskeys.userId, user.id)))
  if (!r[0].affectedRows) throw createError({ statusCode: 404, statusMessage: 'Llave no encontrada' })
  await audit(event, { userId: user.id, companyId: user.currentCompanyId, action: 'user.passkey.remove' })
  return { ok: true }
})
