import { and, eq } from 'drizzle-orm'

/** Calendarios conectados para escribir (Google, iCloud, CalDAV) de quien mira, y si Google está disponible */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'advisor')
  const rows = await useDb().select().from(tables.calendarAccounts)
    .where(and(eq(tables.calendarAccounts.companyId, company.id), eq(tables.calendarAccounts.userId, user.id)))
  return { accounts: rows.map(accountDto), google: !!googleConfig() }
})
