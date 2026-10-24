import { eq } from 'drizzle-orm'

/** Guarda el enlace de pago y el Bizum que verán los clientes en sus facturas */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  const input = await readInput(event, onlinePaymentsSchema)
  const settings = { ...(company.settings ?? {}), payments: input }
  await useDb().update(tables.companies).set({ settings }).where(eq(tables.companies.id, company.id))
  await audit(event, { companyId: company.id, userId: user.id, action: 'payments.settings', data: { link: !!input.link, bizum: !!input.bizum } })
  return onlinePaymentsOf({ settings })
})
