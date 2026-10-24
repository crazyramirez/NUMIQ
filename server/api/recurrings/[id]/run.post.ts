/** Genera ahora el próximo documento (adelanta la serie) o uno suelto si está pausada */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const rec = await getRecurring(company.id, idParam(event))
  const site = useRuntimeConfig().siteUrl || getRequestURL(event, { xForwardedProto: true }).origin
  const result = await runNow(rec, company, user.id, site)
  const updated = await getRecurring(company.id, rec.id)
  return { ...result, nextDate: updated.nextDate, status: recurringStatus(updated) }
})
