/** Elimina la importación y todo lo que creó: facturas, gastos, cobros, contactos y productos nuevos y archivos */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const summary = await undoBatch(company, id)
  await audit(event, { companyId: company.id, userId: user.id, action: 'import.undo', entity: 'import_batch', entityId: id, data: { ...summary } })
  return summary
})
