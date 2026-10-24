import { z } from 'zod'

const schema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
})

/** Elimina varios gastos seleccionados de una vez */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const input = await readInput(event, schema)
  const { deleted } = await deleteExpenses(company.id, [...new Set(input.ids)])
  if (!deleted.length) return { ok: true, deleted: 0 }

  const foundIds = deleted.map(e => e.id)
  await audit(event, {
    companyId: company.id,
    userId: user.id,
    action: 'expense.bulk_delete',
    entity: 'expense',
    data: { ids: foundIds, count: foundIds.length },
  })

  return { ok: true, deleted: foundIds.length }
})
