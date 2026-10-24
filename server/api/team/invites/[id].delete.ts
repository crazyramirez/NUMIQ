import { and, eq } from 'drizzle-orm'

/** Anula una invitación pendiente */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  const id = idParam(event)
  const r = await useDb().update(tables.companyInvites).set({ expiresAt: new Date() })
    .where(and(eq(tables.companyInvites.id, id), eq(tables.companyInvites.companyId, company.id)))
  if (!r[0].affectedRows) throw createError({ statusCode: 404, statusMessage: 'Invitación no encontrada' })
  await audit(event, { companyId: company.id, userId: user.id, action: 'team.invite.cancel', entityId: id })
  return { ok: true }
})
