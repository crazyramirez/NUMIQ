import { asc, eq } from 'drizzle-orm'

/** Borra una firma guardada (los documentos ya firmados con ella no cambian) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const row = await findSignature(company.id, id)
  const db = useDb()
  const s = tables.signatures
  await db.delete(s).where(eq(s.id, id))
  await deleteStoredFile(row.path)
  // Si era la predeterminada, pasa a serlo la más antigua que quede
  if (row.isDefault) {
    const [next] = await db.select({ id: s.id }).from(s).where(eq(s.companyId, company.id)).orderBy(asc(s.createdAt), asc(s.id)).limit(1)
    if (next) await db.update(s).set({ isDefault: true }).where(eq(s.id, next.id))
  }
  await audit(event, { companyId: company.id, userId: user.id, action: 'signature.delete', entity: 'signature', entityId: id, data: { name: row.name } })
  return { ok: true }
})
