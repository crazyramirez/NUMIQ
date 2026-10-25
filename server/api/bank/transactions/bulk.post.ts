import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  action: z.enum(['accept', 'ignore', 'unmatch', 'delete']),
  /** Motivo al ignorar (traspaso, impuestos, personal…) */
  reason: z.string().trim().max(120).nullish(),
})

/**
 * Acciones sobre varios movimientos a la vez. Cada uno se trata como si se hiciera a mano y los que
 * no admiten la acción se saltan (p. ej. ignorar uno ya conciliado). Eliminar quita solo el movimiento:
 * los cobros, pagos y gastos a los que estaba unido se conservan.
 */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const { ids, action, reason } = await readInput(event, schema)
  const db = useDb()
  const t = tables.bankTransactions
  const rows = await db.select().from(t).where(and(eq(t.companyId, company.id), inArray(t.id, [...new Set(ids)])))

  let done = 0
  let skipped = 0
  let failed = 0
  const undone: number[] = []

  if (action === 'delete') {
    if (rows.length) await db.delete(t).where(and(eq(t.companyId, company.id), inArray(t.id, rows.map(r => r.id))))
    done = rows.length
  }
  else {
    for (const tx of rows) {
      try {
        if (action === 'accept') {
          const s = tx.suggestion
          if (tx.status !== 'pending' || !s) {
            skipped++
            continue
          }
          if (s.kind === 'invoice' || s.kind === 'expense' || s.kind === 'payment') await confirmMatch(company, user.id, tx.id, suggestionTarget(s))
          else if (s.kind === 'new_expense') await expenseFromTx(company, user.id, tx.id, { kind: s.expenseKind ?? 'other', categoryId: s.categoryId ?? null, supplier: s.supplier ?? null, vatRate: s.vatRate ?? 0, description: null, deductiblePct: s.deductiblePct, vatDeductiblePct: s.vatDeductiblePct, contactId: s.contactId })
          else await db.update(t).set({ status: 'ignored', ignoreReason: s.label, matchedAt: new Date(), matchedBy: user.id }).where(eq(t.id, tx.id))
        }
        else if (action === 'ignore') {
          if (tx.status !== 'pending') {
            skipped++
            continue
          }
          await db.update(t).set({ status: 'ignored', ignoreReason: reason || null, matchedAt: new Date(), matchedBy: user.id }).where(eq(t.id, tx.id))
        }
        else {
          if (tx.status === 'pending') {
            skipped++
            continue
          }
          await unmatch(company, tx.id, { suggest: false })
          undone.push(tx.id)
        }
        done++
      }
      catch {
        failed++
      }
    }
    // Propuestas nuevas para los que vuelven a estar por revisar, de una vez
    if (undone.length) await suggestMatches(company, undone).catch(() => {})
  }

  await audit(event, { companyId: company.id, userId: user.id, action: `bank.bulk_${action}`, entity: 'bank_transaction', data: { ids: rows.map(r => r.id), done, skipped, failed } })
  return { done, skipped, failed }
})
