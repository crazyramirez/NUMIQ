import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const input = await readInput(event, itemInputSchema)
  await assertItemCategory(company.id, input.categoryId)
  const res = await useDb().update(tables.items).set(input)
    .where(and(eq(tables.items.id, id), eq(tables.items.companyId, company.id)))
  if (!res[0].affectedRows) throw createError({ statusCode: 404, statusMessage: 'Producto no encontrado' })
  await audit(event, { companyId: company.id, userId: user.id, action: 'item.update', entity: 'item', entityId: id })
  return { ok: true }
})
