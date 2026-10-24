import { z } from 'zod'

const schema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
})

/** Elimina varios contactos seleccionados; sus documentos se conservan, desvinculados */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const { ids } = await readInput(event, schema)

  const { deleted, unassignedSales, unassignedExpenses } = await deleteContacts(company.id, [...new Set(ids)])
  if (deleted.length) {
    await audit(event, {
      companyId: company.id,
      userId: user.id,
      action: 'contact.bulk_delete',
      entity: 'contact',
      data: { contacts: deleted.map(c => ({ id: c.id, name: c.name })), unassignedSales, unassignedExpenses },
    })
  }
  return { ok: true, deleted: deleted.length, unassignedSales, unassignedExpenses }
})
