import { and, eq, inArray, isNull } from 'drizzle-orm'

/** Descarta lo que no se importó: registros pendientes y archivos sin usar. Lo ya importado se conserva. */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const batch = await getBatch(company.id, id)
  if (isBatchRunning(id)) throw createError({ statusCode: 409, statusMessage: 'Espera a que termine la lectura de los archivos' })
  const db = useDb()
  await db.delete(tables.importItems).where(and(eq(tables.importItems.batchId, id), inArray(tables.importItems.status, ['ready', 'warning', 'duplicate', 'error', 'excluded'])))
  const unused = await db.select({ id: tables.files.id, path: tables.files.path }).from(tables.files)
    .where(and(eq(tables.files.batchId, id), eq(tables.files.companyId, company.id), eq(tables.files.kind, 'import'), isNull(tables.files.linkedId)))
  if (unused.length) await db.delete(tables.files).where(inArray(tables.files.id, unused.map(f => f.id)))
  for (const f of unused) await deleteStoredFile(f.path)
  const [left] = await db.select({ id: tables.importItems.id }).from(tables.importItems).where(eq(tables.importItems.batchId, id)).limit(1)
  if (left) await db.update(tables.importBatches).set({ status: 'done', finishedAt: batch.finishedAt ?? new Date() }).where(eq(tables.importBatches.id, id))
  else await db.delete(tables.importBatches).where(eq(tables.importBatches.id, id))
  await audit(event, { companyId: company.id, userId: user.id, action: 'import.discard', entity: 'import_batch', entityId: id, data: { files: unused.length } })
  return { ok: true }
})
