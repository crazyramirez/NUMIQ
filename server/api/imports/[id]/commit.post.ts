import { z } from 'zod'

const schema = z.object({
  /** Sin lista: todo lo revisado (listo o con avisos) */
  itemIds: z.array(z.number().int().positive()).max(5000).optional(),
})

/** Crea las facturas, gastos, contactos y productos revisados */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const { itemIds } = await readInput(event, schema)
  if (isBatchRunning(id)) throw createError({ statusCode: 409, statusMessage: 'Espera a que termine la lectura de los archivos' })
  const result = await commitBatch(company.id, user.id, id, itemIds)
  await audit(event, { companyId: company.id, userId: user.id, action: 'import.commit', entity: 'import_batch', entityId: id, data: { imported: result.imported, failed: result.failed.length } })
  return result
})
