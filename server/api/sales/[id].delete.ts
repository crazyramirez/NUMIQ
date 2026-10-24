/**
 * Elimina completamente un documento de venta (factura, presupuesto, proforma o rectificativa)
 * junto con sus líneas y cobros; lo relacionado se desvincula (ver deleteSalesDocuments).
 */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)

  const { deleted, blocked } = await deleteSalesDocuments(company.id, [id])
  if (blocked.length) throw createError({ statusCode: 409, statusMessage: 'Esta factura ya está registrada en VeriFactu: para anularla emite una rectificativa' })
  const doc = deleted[0]
  if (!doc) throw createError({ statusCode: 404, statusMessage: 'Documento no encontrado' })

  await audit(event, {
    companyId: company.id,
    userId: user.id,
    action: 'sales.delete',
    entity: 'sales_document',
    entityId: id,
    data: { number: doc.number, kind: doc.kind, total: doc.total },
  })

  return { ok: true }
})
