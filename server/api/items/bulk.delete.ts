import { z } from 'zod'

const schema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
})

/** Elimina varios productos o servicios seleccionados de una vez */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const { ids } = await readInput(event, schema)

  const { deleted, unlinkedDocuments } = await deleteItems(company.id, [...new Set(ids)])
  if (deleted.length) {
    await audit(event, {
      companyId: company.id,
      userId: user.id,
      action: 'item.bulk_delete',
      entity: 'item',
      data: { ids: deleted.map(i => i.id), names: deleted.map(i => i.name), unlinkedDocuments },
    })
  }
  return { ok: true, deleted: deleted.length, unlinkedDocuments }
})
