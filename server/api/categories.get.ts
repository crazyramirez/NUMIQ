import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  return useDb().select().from(tables.categories)
    .where(eq(tables.categories.companyId, company.id))
    .orderBy(tables.categories.kind, tables.categories.name)
})
