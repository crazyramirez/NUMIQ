import { and, eq } from 'drizzle-orm'

/** Borra una categoría del catálogo: sus productos y servicios se quedan, sin categoría */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const db = useDb()

  const [cat] = await db.select().from(tables.itemCategories)
    .where(and(eq(tables.itemCategories.id, id), eq(tables.itemCategories.companyId, company.id)))
  if (!cat) throw createError({ statusCode: 404, statusMessage: 'Categoría no encontrada' })

  let released = 0
  await db.transaction(async (tx) => {
    const res = await tx.update(tables.items).set({ categoryId: null })
      .where(and(eq(tables.items.companyId, company.id), eq(tables.items.categoryId, id)))
    released = res[0].affectedRows
    await tx.delete(tables.itemCategories).where(eq(tables.itemCategories.id, id))
  })

  await audit(event, { companyId: company.id, userId: user.id, action: 'item_category.delete', entity: 'item_category', entityId: id, data: { name: cat.name, released } })
  return { ok: true, released }
})
