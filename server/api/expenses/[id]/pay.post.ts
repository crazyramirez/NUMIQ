import { z } from 'zod'

/** Marca un gasto como pagado (registra el pago por lo pendiente) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const input = await readInput(event, z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    method: z.enum(['transfer', 'card', 'cash', 'direct_debit', 'bizum', 'other']).default('transfer'),
  }))
  if (!await payExpense(company.id, id, { date: input.date ?? toISODate(new Date()), method: input.method })) return { ok: true }
  await audit(event, { companyId: company.id, userId: user.id, action: 'expense.pay', entity: 'expense', entityId: id })
  return { ok: true }
})
