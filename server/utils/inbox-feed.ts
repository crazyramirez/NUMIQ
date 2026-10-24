import { and, count, eq } from 'drizzle-orm'

type Company = typeof tables.companies.$inferSelect

/**
 * Lo que espera una decisión: importaciones leídas por la IA sin confirmar (contador de Documentos
 * en el menú) y gastos que la IA dejó por revisar (tarea de «Hoy»).
 */
export async function inboxCount(company: Company) {
  const db = useDb()
  await ensureReviewNotes(company.id)
  const [[imports], [expenses]] = await Promise.all([
    db.select({ n: count() }).from(tables.importBatches).where(and(eq(tables.importBatches.companyId, company.id), eq(tables.importBatches.status, 'review'))),
    db.select({ n: count() }).from(tables.expenses).where(and(eq(tables.expenses.companyId, company.id), eq(tables.expenses.reviewed, false))),
  ])
  const n = (x?: { n: number | string }) => Number(x?.n ?? 0)
  return { imports: n(imports), expenses: n(expenses), total: n(imports) }
}
