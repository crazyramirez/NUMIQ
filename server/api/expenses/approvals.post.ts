import { z } from 'zod'

const schema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(300),
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().max(300).nullish(),
})

/** Aprueba o rechaza gastos del equipo (dueños y administradores) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  const input = await readInput(event, schema)
  const r = await decideExpenses(company.id, user.id, input.ids, input.decision, input.reason)
  await audit(event, { companyId: company.id, userId: user.id, action: `expense.${input.decision}`, data: { ids: input.ids, done: r.done } })
  return r
})
