/**
 * Cambia la plantilla o la programación. Si cambia la próxima fecha o la frecuencia, la serie se
 * re-ancla en la nueva fecha (su día del mes manda a partir de ahí).
 */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const rec = await getRecurring(company.id, idParam(event))
  const input = await readInput(event, recurringInputSchema)
  await updateRecurring(company.id, rec, input)
  await audit(event, { companyId: company.id, userId: user.id, action: 'recurring.update', entity: 'recurring', entityId: rec.id })
  return { ok: true }
})
