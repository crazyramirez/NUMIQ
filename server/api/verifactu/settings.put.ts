import { eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  environment: z.enum(['test', 'production']),
  autoSend: z.boolean(),
})

/** Entorno de la AEAT (pruebas o real) y envío automático de los registros */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  const input = await readInput(event, schema)
  if (input.environment === 'production' && !(await currentCertificate(company.id))) {
    throw createError({ statusCode: 409, statusMessage: 'Sube primero tu certificado digital para enviar a la AEAT' })
  }
  const settings = { ...(company.settings ?? {}), verifactu: input }
  await useDb().update(tables.companies).set({ settings }).where(eq(tables.companies.id, company.id))
  await audit(event, { companyId: company.id, userId: user.id, action: 'verifactu.settings', data: input })
  return { settings: input }
})
