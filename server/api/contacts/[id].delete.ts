/**
 * Elimina completamente un contacto (cliente o proveedor).
 * Si tiene facturas o gastos asignados, se desasignan (contactId/supplierId = null)
 * conservando los datos congelados del cliente/proveedor en el documento.
 */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)

  const { deleted, unassignedSales, unassignedExpenses } = await deleteContacts(company.id, [id])
  const contact = deleted[0]
  if (!contact) throw createError({ statusCode: 404, statusMessage: 'Contacto no encontrado' })

  await audit(event, {
    companyId: company.id,
    userId: user.id,
    action: 'contact.delete',
    entity: 'contact',
    entityId: id,
    data: {
      name: contact.name,
      unassignedSales,
      unassignedExpenses,
    },
  })

  return { ok: true, unassignedSales, unassignedExpenses }
})
