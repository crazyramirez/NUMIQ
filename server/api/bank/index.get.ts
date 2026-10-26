import { and, count, desc, eq, inArray, like, or, sql } from 'drizzle-orm'
import { z } from 'zod'

const query = z.object({
  status: z.enum(['pending', 'matched', 'ignored', 'all']).default('pending'),
  account: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(5000).default(1),
  size: z.coerce.number().int().refine(n => PAGE_SIZES.some(s => s === n)).default(PAGE_SIZE),
})

/** Cuentas, resumen y movimientos del banco (filtrados por estado, cuenta y texto) */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const input = readQueryInput(event, query)
  const db = useDb()
  const t = tables.bankTransactions

  const [accounts, counts] = await Promise.all([
    db.select().from(tables.bankAccounts).where(eq(tables.bankAccounts.companyId, company.id)).orderBy(desc(tables.bankAccounts.isDefault), tables.bankAccounts.id),
    db.select({ status: t.status, accountId: t.accountId, n: count() }).from(t).where(eq(t.companyId, company.id)).groupBy(t.status, t.accountId),
  ])

  const where = and(
    eq(t.companyId, company.id),
    ...(input.status !== 'all' ? [eq(t.status, input.status)] : []),
    ...(input.account ? [eq(t.accountId, input.account)] : []),
    ...(input.q ? [or(like(t.description, `%${input.q}%`), like(t.counterparty, `%${input.q}%`), sql`cast(${t.amount} as char) like ${`%${input.q.replace(',', '.').replace(/[^\d.-]/g, '') || '§'}%`}`)] : []),
  )
  const [rows, [total]] = await Promise.all([
    db.select().from(t).where(where).orderBy(desc(t.date), desc(t.id)).limit(input.size).offset((input.page - 1) * input.size),
    db.select({ n: count() }).from(t).where(where),
  ])

  // Qué hay enlazado a cada movimiento conciliado
  // Un pago de varias facturas: las demás, por sus cobros
  const groupIds = rows.flatMap(r => r.groupPaymentIds ?? [])
  const grouped = groupIds.length
    ? await db.select({ id: tables.payments.id, doc: tables.payments.salesDocumentId }).from(tables.payments).where(and(eq(tables.payments.companyId, company.id), inArray(tables.payments.id, groupIds)))
    : []
  const docOfPayment = new Map(grouped.map(p => [p.id, p.doc]))
  const docIds = [...new Set([...rows.map(r => r.salesDocumentId), ...grouped.map(p => p.doc)].filter((x): x is number => !!x))]
  const expIds = [...new Set(rows.map(r => r.expenseId).filter((x): x is number => !!x))]
  const [docs, exps] = await Promise.all([
    docIds.length ? db.select({ id: tables.salesDocuments.id, number: tables.salesDocuments.number, customer: tables.salesDocuments.customer }).from(tables.salesDocuments).where(inArray(tables.salesDocuments.id, docIds)) : [],
    expIds.length ? db.select({ id: tables.expenses.id, number: tables.expenses.number, supplier: tables.expenses.supplier, description: tables.expenses.description }).from(tables.expenses).where(inArray(tables.expenses.id, expIds)) : [],
  ])

  const by = (status: string, accountId?: number) => counts.filter(c => c.status === status && (!accountId || c.accountId === accountId)).reduce((s, c) => s + c.n, 0)
  const ready = input.status === 'pending' || input.status === 'all'
    ? (await db.select({ suggestion: t.suggestion }).from(t).where(and(eq(t.companyId, company.id), eq(t.status, 'pending'), ...(input.account ? [eq(t.accountId, input.account)] : []))))
        .filter(r => isSafeSuggestion(r.suggestion)).length
    : 0

  return {
    accounts: accounts.map(a => ({ ...a, pending: by('pending', a.id), matched: by('matched', a.id), total: counts.filter(c => c.accountId === a.id).reduce((s, c) => s + c.n, 0) })),
    stats: { pending: by('pending', input.account), matched: by('matched', input.account), ignored: by('ignored', input.account), ready },
    total: total?.n ?? 0,
    page: input.page,
    pageSize: input.size,
    items: rows.map((r) => {
      const doc = r.salesDocumentId ? docs.find(d => d.id === r.salesDocumentId) : null
      const exp = r.expenseId ? exps.find(e => e.id === r.expenseId) : null
      const more = (r.groupPaymentIds ?? []).map(id => docs.find(d => d.id === docOfPayment.get(id))?.number).filter(Boolean)
      return {
        id: r.id,
        accountId: r.accountId,
        date: r.date,
        valueDate: r.valueDate,
        amount: r.amount,
        description: r.description,
        counterparty: r.counterparty,
        reference: r.reference,
        bankCode: r.bankCode,
        balance: r.balance,
        status: r.status,
        suggestion: r.status === 'pending' ? r.suggestion : null,
        ignoreReason: r.ignoreReason,
        matchedAt: r.matchedAt ? r.matchedAt.toISOString() : null,
        createdAt: r.createdAt ? r.createdAt.toISOString() : null,
        link: doc
          ? { kind: 'invoice' as const, id: doc.id, label: more.length ? `Facturas ${[doc.number, ...more].join(' + ')}` : `Factura ${doc.number}`, detail: doc.customer?.name ?? null }
          : exp
            ? { kind: 'expense' as const, id: exp.id, label: exp.supplier?.name ?? exp.description ?? 'Gasto', detail: exp.number ? `Factura ${exp.number}` : exp.supplier ? exp.description : null }
            : null,
      }
    }),
    ai: await aiEnabled(),
  }
})
