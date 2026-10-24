import { and, eq, inArray, isNull, like, notInArray, or, sql, sum } from 'drizzle-orm'
import { z } from 'zod'

const query = z.object({
  role: z.enum(['client', 'supplier']).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const { role, q, limit } = readQueryInput(event, query)
  const db = useDb()
  const c = tables.contacts
  const term = q ? `%${q}%` : null

  const rows = await db.select().from(c)
    .where(and(
      eq(c.companyId, company.id),
      isNull(c.archivedAt),
      role === 'client' ? eq(c.isClient, true) : role === 'supplier' ? eq(c.isSupplier, true) : undefined,
      term ? or(like(c.name, term), like(c.tradeName, term), like(c.nif, term), like(c.email, term), like(c.city, term)) : undefined,
    ))
    .orderBy(c.name)
    .limit(limit)

  const ids = rows.map(r => r.id)
  if (!ids.length) return []

  // Facturado y pendiente de cobro (clientes) / gastado (proveedores) en los últimos 12 meses
  const since = new Date()
  since.setFullYear(since.getFullYear() - 1)
  const sinceIso = toISODate(since)
  const s = tables.salesDocuments
  const sales = await db.select({
    contactId: s.contactId,
    billed: sum(s.taxBase).mapWith(Number),
    pending: sql<number>`SUM(CASE WHEN ${s.status} IN ('issued','sent','partial') THEN ${s.total} - ${s.paidTotal} ELSE 0 END)`.mapWith(Number),
    last: sql<string>`MAX(${s.issueDate})`,
  }).from(s)
    .where(and(eq(s.companyId, company.id), inArray(s.contactId, ids), inArray(s.kind, ['invoice', 'rectifying']), notInArray(s.status, ['draft', 'cancelled']), sql`${s.issueDate} >= ${sinceIso}`))
    .groupBy(s.contactId)
  const e = tables.expenses
  const spent = await db.select({ supplierId: e.supplierId, spent: sum(e.taxBase).mapWith(Number), last: sql<string>`MAX(${e.issueDate})` }).from(e)
    .where(and(eq(e.companyId, company.id), inArray(e.supplierId, ids), sql`${e.issueDate} >= ${sinceIso}`))
    .groupBy(e.supplierId)

  const salesBy = new Map(sales.map(r => [r.contactId, r]))
  const spentBy = new Map(spent.map(r => [r.supplierId, r]))
  return rows.map(r => ({
    ...contactView(r),
    billed12m: salesBy.get(r.id)?.billed ?? 0,
    pending: salesBy.get(r.id)?.pending ?? 0,
    spent12m: spentBy.get(r.id)?.spent ?? 0,
    lastActivity: [salesBy.get(r.id)?.last, spentBy.get(r.id)?.last].filter(Boolean).sort().at(-1) ?? null,
  }))
    .sort((a, b) => (role === 'supplier' ? b.spent12m - a.spent12m : b.billed12m - a.billed12m) || a.name.localeCompare(b.name))
})
