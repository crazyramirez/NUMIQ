import { and, eq, inArray, notInArray } from 'drizzle-orm'

/**
 * Elimina gastos (facturas recibidas, tickets, cuotas) con lo que es suyo: desglose de IVA, pagos y
 * archivos. Lo relacionado no se borra, se desvincula: los movimientos del banco vuelven a pendientes y
 * el documento de origen se conserva si otro gasto sacado del mismo archivo sigue existiendo.
 */
export async function deleteExpenses(companyId: number, ids: number[]) {
  const db = useDb()
  const e = tables.expenses
  const found = await db.select().from(e).where(and(eq(e.companyId, companyId), inArray(e.id, ids)))
  if (!found.length) return { deleted: [] as typeof found }
  const foundIds = found.map(x => x.id)
  const storedPaths: string[] = []

  await db.transaction(async (tx) => {
    // 1. Movimientos del banco unidos a los gastos o a sus pagos: vuelven a pendientes
    const paymentIds = (await tx.select({ id: tables.payments.id }).from(tables.payments)
      .where(inArray(tables.payments.expenseId, foundIds))).map(p => p.id)
    const bt = tables.bankTransactions
    const unmatch = { status: 'pending' as const, expenseId: null, paymentId: null, ownsPayment: false, ignoreReason: null, matchedAt: null, matchedBy: null }
    await tx.update(bt).set(unmatch).where(and(eq(bt.companyId, companyId), inArray(bt.expenseId, foundIds)))
    if (paymentIds.length) await tx.update(bt).set(unmatch).where(and(eq(bt.companyId, companyId), inArray(bt.paymentId, paymentIds)))

    // 2. Desglose de IVA y pagos
    await tx.delete(tables.expenseTaxLines).where(inArray(tables.expenseTaxLines.expenseId, foundIds))
    await tx.delete(tables.payments).where(inArray(tables.payments.expenseId, foundIds))

    // 3. Adjuntos y documento de origen (este, solo si ningún otro gasto lo usa)
    const f = tables.files
    const attached = await tx.select({ id: f.id, path: f.path }).from(f)
      .where(and(eq(f.companyId, companyId), eq(f.linkedType, 'expense'), inArray(f.linkedId, foundIds)))
    const sourceIds = [...new Set(found.map(x => x.fileId).filter((x): x is number => x != null))]
    let sources: typeof attached = []
    if (sourceIds.length) {
      const shared = new Set((await tx.select({ fileId: e.fileId }).from(e)
        .where(and(eq(e.companyId, companyId), inArray(e.fileId, sourceIds), notInArray(e.id, foundIds)))).map(r => r.fileId))
      const free = sourceIds.filter(id => !shared.has(id))
      if (free.length) sources = await tx.select({ id: f.id, path: f.path }).from(f).where(and(eq(f.companyId, companyId), inArray(f.id, free)))
    }
    const files = [...new Map([...attached, ...sources].map(x => [x.id, x])).values()]
    if (files.length) await tx.delete(f).where(inArray(f.id, files.map(x => x.id)))
    storedPaths.push(...files.map(x => x.path))

    // 4. Los gastos
    await tx.delete(e).where(and(eq(e.companyId, companyId), inArray(e.id, foundIds)))
  })

  for (const p of storedPaths) await deleteStoredFile(p)
  return { deleted: found }
}
