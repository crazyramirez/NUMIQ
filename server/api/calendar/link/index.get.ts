/** Dirección privada para suscribirse desde Google Calendar, Apple Calendar u Outlook */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'advisor')
  return calendarLinkDto(event, await calendarLink(company.id, user.id), company.tradeName || company.legalName)
})
