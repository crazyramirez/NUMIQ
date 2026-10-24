import { and, eq, inArray } from 'drizzle-orm'

type PayMethod = 'transfer' | 'card' | 'cash' | 'direct_debit' | 'bizum' | 'other'

/** Marca un gasto como pagado: registra el pago por lo pendiente */
export async function payExpense(companyId: number, id: number, input: { date: string, method: PayMethod }) {
  const db = useDb()
  const e = tables.expenses
  const [row] = await db.select().from(e).where(and(eq(e.id, id), eq(e.companyId, companyId)))
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Gasto no encontrado' })
  if (row.status === 'paid') return false
  await db.transaction(async (tx) => {
    await tx.insert(tables.payments).values({
      companyId, direction: 'out', expenseId: id, amount: round2(row.total - row.paidTotal), date: input.date, method: input.method,
    })
    await tx.update(e).set({ status: 'paid', paidTotal: row.total, paidAt: new Date(), paymentMethod: input.method }).where(eq(e.id, id))
  })
  return true
}

/**
 * Vuelve a dejar gastos pendientes de pago: se borran sus pagos y los movimientos del banco
 * conciliados con ellos quedan otra vez pendientes de conciliar (el gasto se conserva siempre).
 */
export async function unpayExpenses(companyId: number, ids: number[]) {
  if (!ids.length) return
  const db = useDb()
  await db.transaction(async (tx) => {
    const paymentIds = (await tx.select({ id: tables.payments.id }).from(tables.payments)
      .where(and(eq(tables.payments.companyId, companyId), inArray(tables.payments.expenseId, ids)))).map(p => p.id)
    const bt = tables.bankTransactions
    const unmatch = { status: 'pending' as const, expenseId: null, paymentId: null, ownsPayment: false, ignoreReason: null, matchedAt: null, matchedBy: null, suggestion: null }
    await tx.update(bt).set(unmatch).where(and(eq(bt.companyId, companyId), inArray(bt.expenseId, ids)))
    if (paymentIds.length) {
      await tx.update(bt).set(unmatch).where(and(eq(bt.companyId, companyId), inArray(bt.paymentId, paymentIds)))
      await tx.delete(tables.payments).where(inArray(tables.payments.id, paymentIds))
    }
    await tx.update(tables.expenses).set({ status: 'pending', paidTotal: 0, paidAt: null })
      .where(and(eq(tables.expenses.companyId, companyId), inArray(tables.expenses.id, ids)))
  })
}

export type ExpenseBulkAction =
  | { action: 'paid', date: 'today' | 'issue' | 'due' | string, method: PayMethod }
  | { action: 'pending' }
  | { action: 'due', dueDate?: string | null, dueDays?: number }

/** Pagados, pendientes o con otro vencimiento, de una vez; lo que ya estaba así vuelve en `skipped` */
export async function bulkExpenseStatus(companyId: number, ids: number[], change: ExpenseBulkAction) {
  const db = useDb()
  const e = tables.expenses
  const rows = await db.select({ id: e.id, status: e.status, number: e.number, issueDate: e.issueDate, dueDate: e.dueDate })
    .from(e).where(and(eq(e.companyId, companyId), inArray(e.id, ids)))
  const done: number[] = []
  const skipped: Array<{ id: number, number: string | null, reason: string }> = []
  const today = toISODate(new Date())

  if (change.action === 'pending') {
    const target = rows.filter(r => r.status !== 'pending')
    for (const r of rows) if (r.status === 'pending') skipped.push({ id: r.id, number: r.number, reason: 'Ya estaba pendiente' })
    await unpayExpenses(companyId, target.map(r => r.id))
    done.push(...target.map(r => r.id))
    return { done, skipped }
  }

  for (const r of rows) {
    const skip = (reason: string) => skipped.push({ id: r.id, number: r.number, reason })
    try {
      if (change.action === 'paid') {
        const date = change.date === 'today' ? today : change.date === 'issue' ? r.issueDate : change.date === 'due' ? r.dueDate ?? r.issueDate : change.date
        if (await payExpense(companyId, r.id, { date, method: change.method })) done.push(r.id)
        else skip('Ya estaba pagado')
      }
      else {
        const dueDate = change.dueDays != null ? addDaysISO(r.issueDate, change.dueDays) : change.dueDate ?? null
        if (dueDate && dueDate < r.issueDate) { skip('El vencimiento quedaría antes de la fecha del gasto'); continue }
        await db.update(e).set({ dueDate }).where(and(eq(e.id, r.id), eq(e.companyId, companyId)))
        done.push(r.id)
      }
    }
    catch (err) {
      skip((err as { statusMessage?: string }).statusMessage || 'No se pudo cambiar')
    }
  }
  return { done, skipped }
}
