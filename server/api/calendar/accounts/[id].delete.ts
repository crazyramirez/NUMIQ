import { and, eq } from 'drizzle-orm'

/** Desconecta: borra el calendario «NUMIQ» que se creó (o los eventos de NUMIQ) y retira el permiso */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'advisor')
  const [account] = await useDb().select().from(tables.calendarAccounts)
    .where(and(eq(tables.calendarAccounts.id, idParam(event)), eq(tables.calendarAccounts.companyId, company.id), eq(tables.calendarAccounts.userId, user.id)))
  if (!account) throw createError({ statusCode: 404, statusMessage: 'Calendario no encontrado' })
  await disconnectAccount(account)
  await audit(event, { companyId: company.id, userId: user.id, action: 'calendar.disconnect', entity: 'calendar_account', entityId: account.id, data: { provider: account.provider } })
  return { ok: true }
})
