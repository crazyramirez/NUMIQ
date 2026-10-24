import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
})

/** Elimina varios gastos seleccionados de una vez */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const input = await readInput(event, schema)
  const db = useDb()
  const ids = [...new Set(input.ids)]

  const expenses = await db.select().from(tables.expenses)
    .where(and(eq(tables.expenses.companyId, company.id), inArray(tables.expenses.id, ids)))
  if (!expenses.length) return { ok: true, deleted: 0 }

  const foundIds = expenses.map(e => e.id)

  await db.transaction(async (tx) => {
    // 1. Pagos asociados
    const payments = await tx.select({ id: tables.payments.id }).from(tables.payments)
      .where(inArray(tables.payments.expenseId, foundIds))
    const paymentIds = payments.map(p => p.id)

    // 2. Desvincular movimientos bancarios de los gastos
    await tx.update(tables.bankTransactions).set({
      status: 'pending',
      expenseId: null,
      paymentId: null,
      ownsPayment: false,
      ignoreReason: null,
      matchedAt: null,
      matchedBy: null,
    }).where(and(eq(tables.bankTransactions.companyId, company.id), inArray(tables.bankTransactions.expenseId, foundIds)))

    // 3. Desvincular movimientos bancarios de los pagos
    if (paymentIds.length > 0) {
      await tx.update(tables.bankTransactions).set({
        status: 'pending',
        expenseId: null,
        paymentId: null,
        ownsPayment: false,
        ignoreReason: null,
        matchedAt: null,
        matchedBy: null,
      }).where(and(eq(tables.bankTransactions.companyId, company.id), inArray(tables.bankTransactions.paymentId, paymentIds)))
    }

    // 4. Borrar líneas de impuestos y pagos
    await tx.delete(tables.expenseTaxLines).where(inArray(tables.expenseTaxLines.expenseId, foundIds))
    await tx.delete(tables.payments).where(inArray(tables.payments.expenseId, foundIds))

    // 5. Borrar archivos adjuntos
    const files = await tx.select().from(tables.files)
      .where(and(eq(tables.files.companyId, company.id), eq(tables.files.linkedType, 'expense'), inArray(tables.files.linkedId, foundIds)))
    for (const f of files) {
      await tx.delete(tables.files).where(eq(tables.files.id, f.id))
      try { await deleteStoredFile(f.path) } catch {}
    }

    // 6. Borrar gastos
    await tx.delete(tables.expenses).where(and(eq(tables.expenses.companyId, company.id), inArray(tables.expenses.id, foundIds)))
  })

  await audit(event, {
    companyId: company.id,
    userId: user.id,
    action: 'expense.bulk_delete',
    entity: 'expense',
    data: { ids: foundIds, count: foundIds.length },
  })

  return { ok: true, deleted: foundIds.length }
})
