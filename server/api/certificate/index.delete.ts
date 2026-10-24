import { eq } from 'drizzle-orm'

/** Retira el certificado: se borra cifrado incluido */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  const db = useDb()
  const rows = await db.select({ id: tables.certificates.id, path: tables.certificates.path }).from(tables.certificates).where(eq(tables.certificates.companyId, company.id))
  for (const r of rows) {
    await db.delete(tables.certificates).where(eq(tables.certificates.id, r.id))
    await deleteStoredFile(r.path)
  }
  await audit(event, { companyId: company.id, userId: user.id, action: 'certificate.delete' })
  return { ok: true }
})
