import { and, eq } from 'drizzle-orm'

/** Nueva dirección: la anterior deja de funcionar en todos los dispositivos */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'advisor')
  const link = await calendarLink(company.id, user.id)
  const token = newCalendarToken()
  await useDb().update(tables.calendarLinks).set({ token, lastUsedAt: null }).where(and(eq(tables.calendarLinks.id, link.id), eq(tables.calendarLinks.userId, user.id)))
  await audit(event, { companyId: company.id, userId: user.id, action: 'calendar.link_reset', entity: 'calendar_link', entityId: link.id })
  return calendarLinkDto(event, { ...link, token, lastUsedAt: null }, company.tradeName || company.legalName)
})
