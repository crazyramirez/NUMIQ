import { and, eq } from 'drizzle-orm'

/** Vuelve a leer los archivos que fallaron (saturación de la IA, foto borrosa…) */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event)
  const id = idParam(event)
  await getBatch(company.id, id)
  const db = useDb()
  await db.update(tables.files).set({ aiStatus: 'pending', aiError: null })
    .where(and(eq(tables.files.batchId, id), eq(tables.files.companyId, company.id), eq(tables.files.aiStatus, 'failed')))
  void startBatch(company.id, id)
  return { ok: true }
})
