import { z } from 'zod'

const schema = z.object({
  /** Buscar en todo el buzón (solo su titular) o solo en lo enviado al alias de la empresa */
  whole: z.boolean().default(false),
  days: z.number().int().min(7).max(365).default(120),
})

/** Comprueba el buzón y añade a la bandeja los correos con facturas adjuntas */
export default defineEventHandler(async (event) => {
  const { company, user, role } = await requireCompany(event)
  const input = await readInput(event, schema)
  const whole = input.whole && canReadWholeInbox(user, role)
  const result = await syncInbox(company, whole, input.days)
  await audit(event, { companyId: company.id, userId: user.id, action: 'mail.sync', data: { ...result, whole } })
  return result
})
