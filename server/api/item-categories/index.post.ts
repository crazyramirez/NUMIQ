import { eq, sql } from 'drizzle-orm'

/** Nueva categoría del catálogo; sin color, toma el siguiente de la paleta */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const input = await readInput(event, itemCategoryInputSchema)
  await assertItemCategoryName(company.id, input.name)

  const db = useDb()
  let color = input.color ?? null
  if (!color) {
    const [row] = await db.select({ n: sql<number>`COUNT(*)`.mapWith(Number) }).from(tables.itemCategories)
      .where(eq(tables.itemCategories.companyId, company.id))
    color = ITEM_CATEGORY_COLORS[(row?.n ?? 0) % ITEM_CATEGORY_COLORS.length]!
  }

  const [res] = await db.insert(tables.itemCategories).values({ companyId: company.id, name: input.name, color }).$returningId()
  await audit(event, { companyId: company.id, userId: user.id, action: 'item_category.create', entity: 'item_category', entityId: res!.id, data: { name: input.name } })
  return { id: res!.id, name: input.name, color }
})
