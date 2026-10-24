import { z } from 'zod'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const schema = z.object({ ids: z.array(z.number().int().positive()).min(1).max(1000) }).and(z.discriminatedUnion('action', [
  z.object({ action: z.literal('paid'), date: z.union([z.enum(['today', 'issue', 'due']), isoDate]).default('today'), method: z.enum(['transfer', 'card', 'cash', 'direct_debit', 'bizum', 'other']).default('transfer') }),
  z.object({ action: z.enum(['pending', 'sent', 'accepted', 'rejected', 'draft']) }),
  z.object({ action: z.literal('due'), dueDate: isoDate.nullish(), dueDays: z.number().int().min(0).max(3650).optional() }),
]))

/** Cambia el estado de varias facturas o presupuestos seleccionados: cobradas, pendientes, enviadas, borrador, vencimiento… */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const { ids, ...change } = await readInput(event, schema)
  const result = await bulkSalesStatus(company.id, [...new Set(ids)], change)
  if (result.done.length) {
    await audit(event, { companyId: company.id, userId: user.id, action: `sales.bulk_status.${change.action}`, entity: 'sales_document', data: { ids: result.done, change } })
  }
  return { ok: true, done: result.done.length, skipped: result.skipped }
})
