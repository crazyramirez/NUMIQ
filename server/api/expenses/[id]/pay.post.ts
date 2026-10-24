import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

/** Marca un gasto como pagado (registra el pago por lo pendiente) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const input = await readInput(event, z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    method: z.enum(['transfer', 'card', 'cash', 'direct_debit', 'bizum', 'other']).default('transfer'),
  }))
  const db = useDb()
  const [e] = await db.select().from(tables.expenses).where(and(eq(tables.expenses.id, id), eq(tables.expenses.companyId, company.id)))
  if (!e) throw createError({ statusCode: 404, statusMessage: 'Gasto no encontrado' })
  if (e.status === 'paid') return { ok: true }
  await db.transaction(async (tx) => {
    await tx.insert(tables.payments).values({
      companyId: company.id, direction: 'out', expenseId: id, amount: round2(e.total - e.paidTotal),
      date: input.date ?? toISODate(new Date()), method: input.method,
    })
    await tx.update(tables.expenses).set({ status: 'paid', paidTotal: e.total, paidAt: new Date(), paymentMethod: input.method }).where(eq(tables.expenses.id, id))
  })
  await audit(event, { companyId: company.id, userId: user.id, action: 'expense.pay', entity: 'expense', entityId: id })
  return { ok: true }
})
