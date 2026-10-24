import { and, eq, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const id = idParam(event)
  const db = useDb()
  const [item] = await db.select().from(tables.items)
    .where(and(eq(tables.items.id, id), eq(tables.items.companyId, company.id)))
  if (!item) throw createError({ statusCode: 404, statusMessage: 'Producto no encontrado' })

  // Facturas y presupuestos (de cualquier fecha) con alguna línea de este producto
  const l = tables.salesDocumentLines
  const s = tables.salesDocuments
  const [used] = await db.select({ count: sql<number>`COUNT(DISTINCT ${l.documentId})`.mapWith(Number) })
    .from(l).innerJoin(s, eq(s.id, l.documentId))
    .where(and(eq(l.itemId, id), eq(s.companyId, company.id)))
  return { ...itemView(item), documentsCount: used?.count ?? 0 }
})
