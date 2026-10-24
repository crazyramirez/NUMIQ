import { z } from 'zod'

const schema = z.object({
  kind: z.enum(['invoice', 'ticket', 'payroll', 'social_security', 'tax', 'other']).default('ticket'),
  categoryId: z.number().int().positive().nullish().transform(v => v ?? null),
  supplier: z.string().trim().max(200).nullish().transform(v => v || null),
  vatRate: z.number().min(0).max(21),
  description: z.string().trim().max(255).nullish().transform(v => v || null),
  /** Sin indicar: la que se marcó la última vez con ese proveedor o la de la categoría */
  deductiblePct: z.number().min(0).max(100).nullish(),
  vatDeductiblePct: z.number().min(0).max(100).nullish(),
})

/** Crea el gasto de un cargo del banco (ya pagado) y lo deja conciliado; si ya estaba anotado, lo enlaza (linked) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const input = await readInput(event, schema)
  const { expenseId, linked } = await expenseFromTx(company, user.id, id, input)
  await audit(event, { companyId: company.id, userId: user.id, action: linked ? 'bank.match' : 'bank.expense', entity: 'bank_transaction', entityId: id, data: { expenseId, linked } })
  return { ok: true, expenseId, linked }
})
