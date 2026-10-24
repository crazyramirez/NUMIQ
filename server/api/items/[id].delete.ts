/** Elimina un producto o servicio del catálogo (las facturas que lo usan conservan su línea) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)

  const { deleted, unlinkedDocuments } = await deleteItems(company.id, [id])
  if (!deleted.length) throw createError({ statusCode: 404, statusMessage: 'Producto no encontrado' })

  await audit(event, {
    companyId: company.id,
    userId: user.id,
    action: 'item.delete',
    entity: 'item',
    entityId: id,
    data: { name: deleted[0]!.name, unlinkedDocuments },
  })
  return { ok: true, unlinkedDocuments }
})
