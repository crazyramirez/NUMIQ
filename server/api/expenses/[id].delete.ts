/**
 * Elimina completamente un gasto (factura recibida, ticket o cuota)
 * junto con sus líneas de IVA, pagos, archivos y desvincula los movimientos bancarios.
 */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const { deleted } = await deleteExpenses(company.id, [id])
  const expense = deleted[0]
  if (!expense) throw createError({ statusCode: 404, statusMessage: 'Gasto no encontrado' })

  await audit(event, {
    companyId: company.id,
    userId: user.id,
    action: 'expense.delete',
    entity: 'expense',
    entityId: id,
    data: { description: expense.description, number: expense.number, total: expense.total },
  })

  return { ok: true }
})
