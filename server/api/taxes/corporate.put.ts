import { eq } from 'drizzle-orm'

/** Datos del Impuesto sobre Sociedades: tamaño, nueva creación, modalidad del 202, última cuota y bases negativas */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  if (company.kind !== 'sociedad') throw createError({ statusCode: 400, statusMessage: 'El Impuesto sobre Sociedades es para sociedades' })
  const input = await readInput(event, corporateSettingsSchema)
  const settings = { ...(company.settings ?? {}), corporateTax: input }
  await useDb().update(tables.companies).set({ settings }).where(eq(tables.companies.id, company.id))
  await audit(event, { companyId: company.id, userId: user.id, action: 'taxes.corporate_settings', data: input })
  return { settings: input }
})
