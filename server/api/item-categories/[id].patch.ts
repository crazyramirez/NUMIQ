import { and, eq } from 'drizzle-orm'

/** Cambia el nombre o el color de una categoría del catálogo */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const input = await readInput(event, itemCategoryInputSchema.partial())
  if (input.name) await assertItemCategoryName(company.id, input.name, id)

  const res = await useDb().update(tables.itemCategories)
    .set({ ...(input.name ? { name: input.name } : {}), ...(input.color !== undefined ? { color: input.color } : {}) })
    .where(and(eq(tables.itemCategories.id, id), eq(tables.itemCategories.companyId, company.id)))
  if (!res[0].affectedRows) throw createError({ statusCode: 404, statusMessage: 'Categoría no encontrada' })
  await audit(event, { companyId: company.id, userId: user.id, action: 'item_category.update', entity: 'item_category', entityId: id, data: input })
  return { ok: true }
})
