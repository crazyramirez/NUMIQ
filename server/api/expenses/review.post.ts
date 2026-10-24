import { z } from 'zod'

const schema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(1000),
  /** confirm: darlos por buenos · convert: pasar a euros los que están en otra moneda */
  action: z.enum(['confirm', 'convert']),
})

/** Revisión de gastos de una vez, sin abrir cada uno */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const input = await readInput(event, schema)
  const ids = [...new Set(input.ids)]
  if (input.action === 'confirm') {
    const r = await confirmExpenseReviews(company.id, ids)
    await audit(event, { companyId: company.id, userId: user.id, action: 'expense.review', entity: 'expense', data: { ids, ...r } })
    return r
  }
  let converted = 0
  const failed: string[] = []
  for (const id of ids) {
    try {
      if ((await convertExpenseToEur(company.id, id)).converted) converted++
    }
    catch (err) {
      failed.push((err as { statusMessage?: string }).statusMessage ?? (err as Error).message)
    }
  }
  if (converted) await audit(event, { companyId: company.id, userId: user.id, action: 'expense.convert', entity: 'expense', data: { ids, converted } })
  return { converted, failed: failed.length, message: failed[0] ?? null }
})
