import { z } from 'zod'

const schema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
})

/** Elimina varias facturas o presupuestos seleccionados; las registradas en VeriFactu se saltan */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const { ids } = await readInput(event, schema)

  const { deleted, blocked } = await deleteSalesDocuments(company.id, [...new Set(ids)])
  if (deleted.length) {
    await audit(event, {
      companyId: company.id,
      userId: user.id,
      action: 'sales.bulk_delete',
      entity: 'sales_document',
      data: { documents: deleted.map(d => ({ id: d.id, number: d.number, kind: d.kind, total: d.total })) },
    })
  }
  return {
    ok: true,
    deleted: deleted.length,
    blocked: blocked.map(d => ({ id: d.id, number: d.number })),
  }
})
