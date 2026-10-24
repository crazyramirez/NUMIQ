import { and, eq, inArray } from 'drizzle-orm'

/**
 * Elimina completamente un gasto (factura recibida, ticket o cuota)
 * junto con sus líneas de IVA, pagos, archivos y desvincula los movimientos bancarios.
 */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const db = useDb()

  const [expense] = await db.select().from(tables.expenses)
    .where(and(eq(tables.expenses.id, id), eq(tables.expenses.companyId, company.id)))
  if (!expense) throw createError({ statusCode: 404, statusMessage: 'Gasto no encontrado' })

  await db.transaction(async (tx) => {
    // 1. Pagos asociados a este gasto
    const expPayments = await tx.select({ id: tables.payments.id }).from(tables.payments)
      .where(eq(tables.payments.expenseId, id))
    const paymentIds = expPayments.map(p => p.id)

    // 2. Desvincular movimientos bancarios asociados directamente al gasto
    await tx.update(tables.bankTransactions).set({
      status: 'pending',
      expenseId: null,
      paymentId: null,
      ownsPayment: false,
      ignoreReason: null,
      matchedAt: null,
      matchedBy: null,
    }).where(and(eq(tables.bankTransactions.companyId, company.id), eq(tables.bankTransactions.expenseId, id)))

    // 3. Desvincular movimientos bancarios asociados a los pagos que se van a borrar
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

    // 4. Eliminar líneas de IVA y pagos
    await tx.delete(tables.expenseTaxLines).where(eq(tables.expenseTaxLines.expenseId, id))
    await tx.delete(tables.payments).where(eq(tables.payments.expenseId, id))

    // 5. Eliminar archivos adjuntos (escaneos, PDFs)
    const files = await tx.select().from(tables.files)
      .where(and(eq(tables.files.companyId, company.id), eq(tables.files.linkedType, 'expense'), eq(tables.files.linkedId, id)))
    for (const f of files) {
      await tx.delete(tables.files).where(eq(tables.files.id, f.id))
      try { await deleteStoredFile(f.path) } catch {}
    }
    if (expense.fileId) {
      const [f] = await tx.select().from(tables.files).where(eq(tables.files.id, expense.fileId))
      if (f) {
        await tx.delete(tables.files).where(eq(tables.files.id, f.id))
        try { await deleteStoredFile(f.path) } catch {}
      }
    }

    // 6. Eliminar el gasto
    await tx.delete(tables.expenses).where(and(eq(tables.expenses.id, id), eq(tables.expenses.companyId, company.id)))
  })

  await audit(event, {
    companyId: company.id,
    userId: user.id,
    action: 'expense.delete',
    entity: 'expense',
    entityId: id,
    data: { description: expense.description, number: expense.number, total: expense.total },
  })

  return { ok: true }
})
