import { z } from 'zod'

/** Concilia el movimiento con una factura (o varias del mismo cliente), un gasto o un cobro/pago ya anotado */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const target = await readInput(event, z.object({ kind: z.enum(['invoice', 'expense', 'payment']), id: z.number().int().positive(), ids: z.array(z.number().int().positive()).max(30).nullish() }))
  await confirmMatch(company, user.id, id, target)
  await audit(event, { companyId: company.id, userId: user.id, action: 'bank.match', entity: 'bank_transaction', entityId: id, data: target })
  return { ok: true }
})
