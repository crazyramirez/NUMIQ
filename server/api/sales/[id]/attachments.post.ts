import { and, eq } from 'drizzle-orm'

/** Adjunta documentos a una factura o presupuesto: orden de pedido, albarán, contrato… */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const [doc] = await useDb().select({ id: tables.salesDocuments.id }).from(tables.salesDocuments)
    .where(and(eq(tables.salesDocuments.id, id), eq(tables.salesDocuments.companyId, company.id)))
  if (!doc) throw createError({ statusCode: 404, statusMessage: 'Documento no encontrado' })

  const parts = (await readMultipartFormData(event))?.filter(p => p.name === 'files' && p.data?.length) ?? []
  if (!parts.length) throw createError({ statusCode: 400, statusMessage: 'Elige al menos un archivo' })
  if (parts.length > 10) throw createError({ statusCode: 400, statusMessage: 'Máximo 10 archivos a la vez' })

  const ids: number[] = []
  for (const p of parts) ids.push(await saveAttachment(company.id, user.id, p, { type: 'sales_document', id }))
  await audit(event, { companyId: company.id, userId: user.id, action: 'sales.attach', entity: 'sales_document', entityId: id, data: { files: ids } })
  return { ids }
})
