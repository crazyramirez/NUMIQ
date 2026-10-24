import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const id = idParam(event)
  const db = useDb()
  const [expense] = await db.select().from(tables.expenses)
    .where(and(eq(tables.expenses.id, id), eq(tables.expenses.companyId, company.id)))
  if (!expense) throw createError({ statusCode: 404, statusMessage: 'Gasto no encontrado' })
  const [taxLines, [file]] = await Promise.all([
    db.select().from(tables.expenseTaxLines).where(eq(tables.expenseTaxLines.expenseId, id)),
    expense.fileId
      ? db.select({ id: tables.files.id, name: tables.files.originalName, mime: tables.files.mime, size: tables.files.size }).from(tables.files)
          .where(and(eq(tables.files.id, expense.fileId), eq(tables.files.companyId, company.id)))
      : Promise.resolve([]),
  ])
  return { ...expense, taxLines, file: file ?? null }
})
