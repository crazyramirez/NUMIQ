import { and, eq } from 'drizzle-orm'

/** Sincronizar ahora */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'advisor')
  const where = and(eq(tables.calendarAccounts.id, idParam(event)), eq(tables.calendarAccounts.companyId, company.id), eq(tables.calendarAccounts.userId, user.id))
  const [account] = await useDb().select({ id: tables.calendarAccounts.id }).from(tables.calendarAccounts).where(where)
  if (!account) throw createError({ statusCode: 404, statusMessage: 'Calendario no encontrado' })
  const result = await syncAccount(account.id)
  const [fresh] = await useDb().select().from(tables.calendarAccounts).where(where)
  return { account: accountDto(fresh!), result }
})
