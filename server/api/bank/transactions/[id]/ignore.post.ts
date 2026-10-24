import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

/** Marca el movimiento como revisado sin documento (traspaso, impuestos, personal…) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const { reason } = await readInput(event, z.object({ reason: z.string().trim().max(120).nullish() }))
  const t = tables.bankTransactions
  const [tx] = await useDb().select({ status: t.status }).from(t).where(and(eq(t.id, id), eq(t.companyId, company.id)))
  if (!tx) throw createError({ statusCode: 404, statusMessage: 'Movimiento no encontrado' })
  if (tx.status === 'matched') throw createError({ statusCode: 409, statusMessage: 'Deshaz antes la conciliación' })
  await useDb().update(t).set({ status: 'ignored', ignoreReason: reason || null, matchedAt: new Date(), matchedBy: user.id }).where(eq(t.id, id))
  return { ok: true }
})
