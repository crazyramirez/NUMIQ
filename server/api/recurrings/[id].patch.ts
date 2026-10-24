import { eq } from 'drizzle-orm'

/**
 * Cambia la plantilla o la programación. Si cambia la próxima fecha o la frecuencia, la serie se
 * re-ancla en la nueva fecha (su día del mes manda a partir de ahí).
 */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const rec = await getRecurring(company.id, idParam(event))
  const input = await readInput(event, recurringInputSchema)
  if (input.kind !== rec.kind) throw createError({ statusCode: 400, statusMessage: 'No se puede cambiar de factura a gasto: crea otro recurrente' })
  await assertTemplateRefs(company.id, input)
  const reschedule = input.nextDate !== rec.nextDate || input.frequency !== rec.frequency || input.interval !== rec.interval
  const finished = !!input.endDate && input.nextDate > input.endDate
  await useDb().update(tables.recurrings).set({
    name: input.name,
    frequency: input.frequency,
    interval: input.interval,
    ...(reschedule ? { startDate: input.nextDate, nextDate: input.nextDate } : {}),
    endDate: input.endDate,
    autoIssue: input.autoIssue,
    autoSend: input.autoSend,
    template: buildTemplate(input),
    // Alargar la fecha final reactiva una serie terminada; acortarla por detrás de la próxima la termina
    active: finished ? false : recurringStatus(rec) === 'finished' ? true : rec.active,
    lastError: null,
  }).where(eq(tables.recurrings.id, rec.id))
  await audit(event, { companyId: company.id, userId: user.id, action: 'recurring.update', entity: 'recurring', entityId: rec.id })
  return { ok: true }
})
