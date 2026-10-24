import { and, desc, eq, gte, like, lte, not, or, sql } from 'drizzle-orm'
import { z } from 'zod'

const query = z.object({
  status: z.enum(['all', 'pending', 'paid', 'review']).default('all'),
  q: z.string().trim().max(100).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  /** full: deducible al 100 % · partial: en parte · none: no deducible */
  deductible: z.enum(['all', 'full', 'partial', 'none']).default('all'),
  /** Aprobación del equipo: pendientes o rechazados */
  approval: z.enum(['pending', 'rejected']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(300),
})

export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const p = readQueryInput(event, query)
  const e = tables.expenses
  const c = tables.contacts
  const cat = tables.categories
  const term = p.q ? `%${p.q}%` : null
  // Sin IVA en la factura, el % de IVA deducible no cuenta
  const full = and(eq(e.deductiblePct, 100), or(eq(e.vatDeductiblePct, 100), eq(e.vatTotal, 0)))!
  const none = and(eq(e.deductiblePct, 0), or(eq(e.vatDeductiblePct, 0), eq(e.vatTotal, 0)))!
  await ensureReviewNotes(company.id)

  return useDb().select({
    id: e.id,
    kind: e.kind,
    status: e.status,
    number: e.number,
    issueDate: e.issueDate,
    dueDate: e.dueDate,
    description: e.description,
    supplierId: e.supplierId,
    supplierName: sql<string | null>`COALESCE(${c.name}, JSON_UNQUOTE(JSON_EXTRACT(${e.supplier}, '$.name')))`,
    categoryId: e.categoryId,
    categoryName: cat.name,
    categoryIcon: cat.icon,
    categoryColor: cat.color,
    taxBase: e.taxBase,
    vatTotal: e.vatTotal,
    irpfTotal: e.irpfTotal,
    total: e.total,
    deductiblePct: e.deductiblePct,
    vatDeductiblePct: e.vatDeductiblePct,
    isInvestment: e.isInvestment,
    paidTotal: e.paidTotal,
    reviewed: e.reviewed,
    reviewNotes: e.reviewNotes,
    aiConfidence: e.aiConfidence,
    fileId: e.fileId,
    approval: e.approval,
    rejectReason: e.rejectReason,
    createdBy: e.createdBy,
    createdByName: tables.users.name,
  })
    .from(e)
    .leftJoin(c, eq(c.id, e.supplierId))
    .leftJoin(cat, eq(cat.id, e.categoryId))
    .leftJoin(tables.users, eq(tables.users.id, e.createdBy))
    .where(and(
      eq(e.companyId, company.id),
      p.approval ? eq(e.approval, p.approval) : undefined,
      p.status === 'pending' ? eq(e.status, 'pending') : p.status === 'paid' ? eq(e.status, 'paid') : p.status === 'review' ? eq(e.reviewed, false) : undefined,
      p.from ? gte(e.issueDate, p.from) : undefined,
      p.to ? lte(e.issueDate, p.to) : undefined,
      p.categoryId ? eq(e.categoryId, p.categoryId) : undefined,
      p.deductible === 'full' ? full : p.deductible === 'none' ? none : p.deductible === 'partial' ? and(not(full), not(none)) : undefined,
      term ? or(like(e.number, term), like(e.description, term), like(c.name, term), like(c.nif, term)) : undefined,
    ))
    .orderBy(desc(e.issueDate), desc(e.id))
    .limit(p.limit)
})
