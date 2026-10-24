import { and, desc, eq, isNull, like, or, sql } from 'drizzle-orm'
import { z } from 'zod'

/** Búsqueda global de la paleta de comandos (⌘K) */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const { q } = readQueryInput(event, z.object({ q: z.string().trim().min(1).max(100) }))
  const term = `%${q}%`
  const db = useDb()
  const c = tables.contacts
  const s = tables.salesDocuments
  const e = tables.expenses

  const [contacts, documents, expenses] = await Promise.all([
    db.select({ id: c.id, name: c.name, nif: c.nif, isClient: c.isClient, isSupplier: c.isSupplier }).from(c)
      .where(and(eq(c.companyId, company.id), isNull(c.archivedAt), or(like(c.name, term), like(c.tradeName, term), like(c.nif, term), like(c.email, term))))
      .orderBy(c.name).limit(5),
    db.select({
      id: s.id, kind: s.kind, number: s.number, status: s.status, total: s.total, issueDate: s.issueDate,
      contactName: sql<string | null>`COALESCE(${c.name}, JSON_UNQUOTE(JSON_EXTRACT(${s.customer}, '$.name')))`,
    }).from(s).leftJoin(c, eq(c.id, s.contactId))
      .where(and(eq(s.companyId, company.id), or(like(s.number, term), like(c.name, term))))
      .orderBy(desc(s.issueDate)).limit(6),
    db.select({ id: e.id, number: e.number, description: e.description, total: e.total, issueDate: e.issueDate, supplierName: c.name }).from(e).leftJoin(c, eq(c.id, e.supplierId))
      .where(and(eq(e.companyId, company.id), or(like(e.number, term), like(e.description, term), like(c.name, term))))
      .orderBy(desc(e.issueDate)).limit(5),
  ])
  return { contacts, documents, expenses }
})
