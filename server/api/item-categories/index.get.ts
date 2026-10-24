import { and, asc, eq, isNull, sql } from 'drizzle-orm'

/** Categorías del catálogo con cuántos productos y servicios tiene cada una */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const db = useDb()
  const c = tables.itemCategories
  const i = tables.items
  const counts = db.select({ categoryId: i.categoryId, n: sql<number>`COUNT(*)`.as('n') }).from(i)
    .where(and(eq(i.companyId, company.id), isNull(i.archivedAt)))
    .groupBy(i.categoryId)
    .as('counts')
  return db.select({ id: c.id, name: c.name, color: c.color, items: sql<number>`COALESCE(${counts.n}, 0)`.mapWith(Number) })
    .from(c)
    .leftJoin(counts, eq(counts.categoryId, c.id))
    .where(eq(c.companyId, company.id))
    .orderBy(asc(c.name))
})
