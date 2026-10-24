import { and, eq, gte, inArray, isNull, like, lte, notInArray, or, sql, sum } from 'drizzle-orm'
import { z } from 'zod'

const query = z.object({
  role: z.enum(['client', 'supplier']).optional(),
  q: z.string().trim().max(100).optional(),
  /** Periodo de las cifras (facturado, gastado); sin él, todos los años */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(10_000).default(5000),
})

export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const { role, q, from, to, limit } = readQueryInput(event, query)
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

  // Facturado (clientes) / gastado (proveedores) en el periodo, por importe total de cada factura (con impuestos).
  // Lo pendiente de cobro y la última actividad son de siempre: una deuda de otro año sigue siendo deuda.
  const s = tables.salesDocuments
  const e = tables.expenses
  const inPeriod = (col: typeof s.issueDate | typeof e.issueDate) => [from ? gte(col, from) : undefined, to ? lte(col, to) : undefined]
  const salesBase = and(eq(s.companyId, company.id), inArray(s.contactId, ids), inArray(s.kind, ['invoice', 'rectifying']), notInArray(s.status, ['draft', 'cancelled']))
  const [sales, salesEver, spent, spentEver] = await Promise.all([
    db.select({ contactId: s.contactId, billed: sum(s.total).mapWith(Number) }).from(s)
      .where(and(salesBase, ...inPeriod(s.issueDate)))
      .groupBy(s.contactId),
    db.select({
      contactId: s.contactId,
      pending: sql<number>`SUM(CASE WHEN ${s.status} IN ('issued','sent','partial') THEN ${s.total} - ${s.paidTotal} ELSE 0 END)`.mapWith(Number),
      last: sql<string>`MAX(${s.issueDate})`,
    }).from(s).where(salesBase).groupBy(s.contactId),
    db.select({ supplierId: e.supplierId, spent: sum(e.total).mapWith(Number) }).from(e)
      .where(and(eq(e.companyId, company.id), inArray(e.supplierId, ids), ...inPeriod(e.issueDate)))
      .groupBy(e.supplierId),
    db.select({ supplierId: e.supplierId, last: sql<string>`MAX(${e.issueDate})` }).from(e)
      .where(and(eq(e.companyId, company.id), inArray(e.supplierId, ids)))
      .groupBy(e.supplierId),
  ])

  const billedBy = new Map(sales.map(r => [r.contactId, r.billed]))
  const salesEverBy = new Map(salesEver.map(r => [r.contactId, r]))
  const spentBy = new Map(spent.map(r => [r.supplierId, r.spent]))
  const spentEverBy = new Map(spentEver.map(r => [r.supplierId, r.last]))
  return rows.map(r => ({
    ...contactView(r),
    billed: billedBy.get(r.id) ?? 0,
    pending: salesEverBy.get(r.id)?.pending ?? 0,
    spent: spentBy.get(r.id) ?? 0,
    lastActivity: [salesEverBy.get(r.id)?.last, spentEverBy.get(r.id)].filter(Boolean).sort().at(-1) ?? null,
  }))
    .sort((a, b) => (role === 'supplier' ? b.spent - a.spent : b.billed - a.billed) || a.name.localeCompare(b.name))
})
