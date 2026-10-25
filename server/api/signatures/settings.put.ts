import { eq } from 'drizzle-orm'

/** Activa o cambia la firma por defecto de las facturas y los presupuestos */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  const input = await readInput(event, signingSettingsSchema)
  if (input.signatureId) await findSignature(company.id, input.signatureId)
  const settings = { ...(company.settings ?? {}), signing: input }
  await useDb().update(tables.companies).set({ settings }).where(eq(tables.companies.id, company.id))
  await audit(event, { companyId: company.id, userId: user.id, action: 'signature.settings', data: { invoices: input.invoices, quotes: input.quotes, signatureId: input.signatureId } })
  return input
})
