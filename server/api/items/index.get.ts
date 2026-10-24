import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'

/** Catálogo con uso de los últimos 12 meses (veces facturado e importe total, con impuestos) */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const db = useDb()
  const rows = await db.select().from(tables.items)
    .where(and(eq(tables.items.companyId, company.id), isNull(tables.items.archivedAt)))
    .orderBy(tables.items.name)
  if (!rows.length) return []

  const since = new Date()
  since.setFullYear(since.getFullYear() - 1)
  const l = tables.salesDocumentLines
  const s = tables.salesDocuments
  const usage = await db.select({
    itemId: l.itemId,
    uses: sql<number>`COUNT(*)`.mapWith(Number),
    // Lo que suma la línea a la factura: base + IVA + recargo − IRPF (si la línea lleva retención)
    revenue: sql<number>`SUM(${l.base} * (1 + (COALESCE(${l.vatRate}, 0) + COALESCE(${l.surchargeRate}, 0)) / 100) - CASE WHEN ${l.irpfApplies} THEN ${l.base} * COALESCE(${s.irpfRate}, 0) / 100 ELSE 0 END)`.mapWith(Number),
    lastUsed: sql<string>`MAX(${s.issueDate})`,
  }).from(l).innerJoin(s, eq(s.id, l.documentId))
    .where(and(
      eq(s.companyId, company.id),
      inArray(l.itemId, rows.map(r => r.id)),
      inArray(s.kind, ['invoice', 'rectifying']),
      notInArray(s.status, ['draft', 'cancelled']),
      sql`${s.issueDate} >= ${toISODate(since)}`,
    ))
    .groupBy(l.itemId)
  const by = new Map(usage.map(u => [u.itemId, u]))
  // Nombre de la categoría para buscar por ella al facturar
  const cats = await db.select({ id: tables.itemCategories.id, name: tables.itemCategories.name }).from(tables.itemCategories)
    .where(eq(tables.itemCategories.companyId, company.id))
  const catName = new Map(cats.map(c => [c.id, c.name]))
  return rows.map(r => ({
    ...itemView(r),
    categoryName: r.categoryId ? catName.get(r.categoryId) ?? null : null,
    uses: by.get(r.id)?.uses ?? 0,
    revenue: round2(by.get(r.id)?.revenue ?? 0),
    lastUsed: by.get(r.id)?.lastUsed ?? null,
  }))
})
