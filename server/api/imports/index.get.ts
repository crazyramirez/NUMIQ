import { desc, eq } from 'drizzle-orm'

/** Historial de importaciones de la empresa */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const b = tables.importBatches
  const rows = await useDb().select().from(b).where(eq(b.companyId, company.id)).orderBy(desc(b.id)).limit(40)
  return rows.map(r => ({ ...r, running: isBatchRunning(r.id) }))
})
