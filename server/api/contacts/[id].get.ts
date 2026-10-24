import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const id = idParam(event)
  const db = useDb()
  const [contact] = await db.select().from(tables.contacts)
    .where(and(eq(tables.contacts.id, id), eq(tables.contacts.companyId, company.id), isNull(tables.contacts.archivedAt)))
  if (!contact) throw createError({ statusCode: 404, statusMessage: 'Contacto no encontrado' })

  const s = tables.salesDocuments
  const e = tables.expenses
  const [documents, expenses, [salesCountRes], [invoicesCountRes], [quotesCountRes], [expensesCountRes]] = await Promise.all([
    db.select({
      id: s.id, kind: s.kind, status: s.status, number: s.number, issueDate: s.issueDate, dueDate: s.dueDate,
      taxBase: s.taxBase, total: s.total, paidTotal: s.paidTotal, description: s.description,
    }).from(s).where(and(eq(s.companyId, company.id), eq(s.contactId, id))).orderBy(desc(s.issueDate), desc(s.id)).limit(100),
    db.select({ id: e.id, number: e.number, issueDate: e.issueDate, description: e.description, total: e.total, status: e.status })
      .from(e).where(and(eq(e.companyId, company.id), eq(e.supplierId, id))).orderBy(desc(e.issueDate)).limit(100),
    db.select({ count: sql<number>`count(*)` }).from(s).where(and(eq(s.companyId, company.id), eq(s.contactId, id))),
    db.select({ count: sql<number>`count(*)` }).from(s).where(and(eq(s.companyId, company.id), eq(s.contactId, id), or(eq(s.kind, 'invoice'), eq(s.kind, 'rectifying')))),
    db.select({ count: sql<number>`count(*)` }).from(s).where(and(eq(s.companyId, company.id), eq(s.contactId, id), or(eq(s.kind, 'quote'), eq(s.kind, 'proforma')))),
    db.select({ count: sql<number>`count(*)` }).from(e).where(and(eq(e.companyId, company.id), eq(e.supplierId, id))),
  ])

  // Concepto de cada documento, como en el listado de facturas
  const concepts = await salesConcepts(documents)

  return {
    ...contactView(contact),
    documents: documents.map(({ description: _description, ...d }) => ({ ...d, conceptPreview: concepts.get(d.id)?.conceptPreview ?? null })),
    expenses,
    salesCount: Number(salesCountRes?.count ?? 0),
    invoicesCount: Number(invoicesCountRes?.count ?? 0),
    quotesCount: Number(quotesCountRes?.count ?? 0),
    expensesCount: Number(expensesCountRes?.count ?? 0),
  }
})
