import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  categoryId: z.number().int().positive().nullable(),
})

/** Mueve varios productos o servicios a una categoría (o los deja sin categoría) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const { ids, categoryId } = await readInput(event, schema)
  await assertItemCategory(company.id, categoryId)

  const res = await useDb().update(tables.items).set({ categoryId })
    .where(and(eq(tables.items.companyId, company.id), inArray(tables.items.id, [...new Set(ids)])))
  const updated = res[0].affectedRows

  await audit(event, {
    companyId: company.id,
    userId: user.id,
    action: 'item.bulk_category',
    entity: 'item',
    data: { ids, categoryId, updated },
  })
  return { ok: true, updated }
})
