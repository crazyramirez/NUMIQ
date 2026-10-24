/** Un recurrente con su plantilla completa y el historial de documentos generados */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const rec = await getRecurring(company.id, idParam(event))
  const history = await generatedDocuments(company.id, [rec.id], 24)
  return {
    ...rec,
    startDate: rec.startDate ?? rec.nextDate,
    status: recurringStatus(rec),
    template: templateOf(rec),
    history: history.slice(0, 24),
  }
})
