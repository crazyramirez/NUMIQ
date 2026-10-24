import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

/** Acepta de una vez las propuestas seguras: documentos que casan sin dudas y cargos típicos (cuota, comisiones) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const { account } = await readInput(event, z.object({ account: z.number().int().positive().nullish() }))
  const t = tables.bankTransactions
  const rows = await useDb().select().from(t).where(and(eq(t.companyId, company.id), eq(t.status, 'pending'), ...(account ? [eq(t.accountId, account)] : [])))
  let done = 0
  let failed = 0
  for (const tx of rows) {
    const s = tx.suggestion
    if (!s || !isSafeSuggestion(s)) continue
    try {
      if (s.kind === 'invoice' || s.kind === 'expense' || s.kind === 'payment') await confirmMatch(company, user.id, tx.id, { kind: s.kind, id: s.id! })
      else if (s.kind === 'new_expense') await expenseFromTx(company, user.id, tx.id, { kind: s.expenseKind ?? 'other', categoryId: s.categoryId ?? null, supplier: s.supplier ?? null, vatRate: s.vatRate ?? 0, description: null, deductiblePct: s.deductiblePct, vatDeductiblePct: s.vatDeductiblePct, contactId: s.contactId })
      else await useDb().update(t).set({ status: 'ignored', ignoreReason: s.label, matchedAt: new Date(), matchedBy: user.id }).where(eq(t.id, tx.id))
      done++
    }
    catch {
      failed++
    }
  }
  await audit(event, { companyId: company.id, userId: user.id, action: 'bank.auto', data: { done, failed } })
  return { done, failed }
})
