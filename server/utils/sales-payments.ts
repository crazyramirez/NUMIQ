import { and, eq, inArray, or } from 'drizzle-orm'
import { z } from 'zod'

export const salesPaymentSchema = z.object({
  amount: z.number().finite().positive().max(999999999999).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
    const d = new Date(`${v}T12:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
  }, 'Fecha no válida').optional(),
  method: z.enum(['transfer', 'card', 'cash', 'direct_debit', 'bizum', 'other']).default('transfer'),
  notes: z.string().max(255).nullish(),
})

type Change = { action: 'save', paymentId?: number, input: z.infer<typeof salesPaymentSchema> }
  | { action: 'remove', paymentId: number }
  | { action: 'clear' }

/** Corrige cobros, conciliación y estado juntos; devuelve el antes para la auditoría. */
export async function changeSalesPayments(companyId: number, documentId: number, change: Change) {
  return useDb().transaction(async (tx) => {
    const s = tables.salesDocuments, p = tables.payments, b = tables.bankTransactions
    const [doc] = await tx.select().from(s).where(and(eq(s.id, documentId), eq(s.companyId, companyId))).for('update')
    if (!doc) throw createError({ statusCode: 404, statusMessage: 'Factura no encontrada' })
    if (!['invoice', 'rectifying'].includes(doc.kind) || !['issued', 'sent', 'partial', 'paid'].includes(doc.status)) {
      throw createError({ statusCode: 409, statusMessage: 'Solo se corrigen cobros de facturas emitidas' })
    }
    const payments = await tx.select().from(p).where(and(eq(p.companyId, companyId), eq(p.salesDocumentId, documentId))).for('update')
    const paymentId = change.action !== 'clear' ? change.paymentId : undefined
    const original = paymentId ? payments.find(payment => payment.id === paymentId) : undefined
    if (paymentId && !original) throw createError({ statusCode: 404, statusMessage: 'Cobro no encontrado en esta factura' })
    const affected = change.action === 'clear' ? payments : original ? [original] : []
    let detach = change.action !== 'save'
    let savedId: number | undefined
    if (change.action === 'save') {
      const otherPaid = round2(payments.filter(payment => payment.id !== paymentId).reduce((sum, payment) => sum + payment.amount, 0))
      const remaining = round2(doc.total - otherPaid)
      const amount = round2(change.input.amount ?? remaining)
      if (amount <= 0 || amount > remaining + 0.005) throw createError({ statusCode: 400, statusMessage: 'El cobro debe ser positivo y no superar el importe pendiente de la factura' })
      const values = { amount, date: change.input.date ?? toISODate(new Date()), method: change.input.method, notes: change.input.notes ?? null }
      detach = !!original && (original.amount !== amount || original.date !== values.date || original.method !== values.method)
      if (original) {
        await tx.update(p).set({ ...values, ...(detach ? { bankAccountId: null } : {}) }).where(eq(p.id, original.id))
        savedId = original.id
      }
      else {
        const [saved] = await tx.insert(p).values({ ...values, companyId, direction: 'in', salesDocumentId: documentId }).$returningId()
        savedId = saved!.id
      }
    }
    else if (affected.length) {
      await tx.delete(p).where(and(eq(p.companyId, companyId), inArray(p.id, affected.map(payment => payment.id))))
    }
    let unmatched: number[] = []
    if (detach) {
      const paymentIds = affected.map(payment => payment.id)
      // Un pago de varias facturas pierde este cobro: vuelve a pendiente y las demás, a por cobrar
      unmatched = await releaseBankGroups(tx, companyId, paymentIds)
      const predicate = and(eq(b.companyId, companyId), or(
        change.action === 'clear' ? eq(b.salesDocumentId, documentId) : undefined,
        paymentIds.length ? inArray(b.paymentId, paymentIds) : undefined,
      ))
      if (change.action === 'clear' || paymentIds.length) {
        const rows = (await tx.select({ id: b.id }).from(b).where(predicate)).map(row => row.id)
        if (rows.length) await tx.update(b).set({ status: 'pending', paymentId: null, salesDocumentId: null, expenseId: null, groupPaymentIds: null, ownsPayment: false, matchedAt: null, matchedBy: null, ignoreReason: null, suggestion: null }).where(and(eq(b.companyId, companyId), inArray(b.id, rows)))
        unmatched = [...new Set([...unmatched, ...rows])]
      }
    }
    await refreshPaidStatus(documentId, tx)
    const [after] = await tx.select({ status: s.status, paidTotal: s.paidTotal, paidAt: s.paidAt }).from(s).where(eq(s.id, documentId))
    return { before: { status: doc.status, paidTotal: doc.paidTotal, paidAt: doc.paidAt }, after: after!, paymentsBefore: affected, paymentId: savedId, unmatched }
  })
}
