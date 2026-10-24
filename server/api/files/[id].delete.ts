import { and, eq } from 'drizzle-orm'

/** Borra un adjunto (los documentos fiscales en sí nunca se guardan como archivo) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const db = useDb()
  const [file] = await db.select().from(tables.files)
    .where(and(eq(tables.files.id, id), eq(tables.files.companyId, company.id), eq(tables.files.kind, 'attachment')))
  if (!file) throw createError({ statusCode: 404, statusMessage: 'Archivo no encontrado' })
  await db.delete(tables.files).where(eq(tables.files.id, id))
  await deleteStoredFile(file.path)
  await audit(event, { companyId: company.id, userId: user.id, action: 'file.delete', entity: file.linkedType ?? 'file', entityId: file.linkedId ?? id, data: { name: file.originalName } })
  return { ok: true }
})
