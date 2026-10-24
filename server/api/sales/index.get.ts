import { and, desc, eq, gte, inArray, like, lt, lte, or, sql } from 'drizzle-orm'
import { z } from 'zod'

const query = z.object({
  kind: z.enum(['invoice', 'quote', 'proforma']).default('invoice'),
  status: z.enum(['all', 'draft', 'open', 'overdue', 'paid', 'cancelled', 'accepted', 'rejected']).default('all'),
  q: z.string().trim().max(100).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  contactId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(300),
})

export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const p = readQueryInput(event, query)
  const s = tables.salesDocuments
  const c = tables.contacts
  const today = toISODate(new Date())
  const term = p.q ? `%${p.q}%` : null
  // Las rectificativas se listan junto a las facturas
  const kinds = p.kind === 'invoice' ? ['invoice', 'rectifying'] as const : [p.kind] as const

  const statusWhere = {
    all: undefined,
    draft: eq(s.status, 'draft'),
    open: inArray(s.status, [...OPEN_STATUSES]),
    overdue: and(inArray(s.status, [...OPEN_STATUSES]), lt(s.dueDate, today)),
    paid: eq(s.status, 'paid'),
    cancelled: eq(s.status, 'cancelled'),
    accepted: inArray(s.status, ['accepted', 'invoiced']),
    rejected: inArray(s.status, ['rejected', 'expired']),
  }[p.status]

  let lineDocIds: number[] = []
  if (term) {
    const lineMatches = await useDb().select({ documentId: tables.salesDocumentLines.documentId })
      .from(tables.salesDocumentLines)
      .where(like(tables.salesDocumentLines.description, term))
      .limit(100)
    lineDocIds = lineMatches.map(l => l.documentId)
  }

  const rows = await useDb().select({
    id: s.id,
    kind: s.kind,
    status: s.status,
    number: s.number,
    issueDate: s.issueDate,
    dueDate: s.dueDate,
    contactId: s.contactId,
    contactName: sql<string | null>`COALESCE(${c.name}, JSON_UNQUOTE(JSON_EXTRACT(${s.customer}, '$.name')))`,
    contactLogo: c.logoPath,
    taxBase: s.taxBase,
    vatTotal: s.vatTotal,
    irpfTotal: s.irpfTotal,
    total: s.total,
    paidTotal: s.paidTotal,
    description: s.description,
  })
    .from(s)
    .leftJoin(c, eq(c.id, s.contactId))
    .where(and(
      eq(s.companyId, company.id),
      inArray(s.kind, [...kinds]),
      statusWhere,
      p.from ? gte(s.issueDate, p.from) : undefined,
      p.to ? lte(s.issueDate, p.to) : undefined,
      p.contactId ? eq(s.contactId, p.contactId) : undefined,
      term ? or(
        like(s.number, term),
        like(c.name, term),
        like(c.nif, term),
        // Documentos de clientes eliminados: su copia de datos
        sql`JSON_UNQUOTE(JSON_EXTRACT(${s.customer}, '$.name')) LIKE ${term}`,
        sql`JSON_UNQUOTE(JSON_EXTRACT(${s.customer}, '$.nif')) LIKE ${term}`,
        like(s.notes, term),
        lineDocIds.length ? inArray(s.id, lineDocIds) : undefined,
      ) : undefined,
    ))
    .orderBy(sql`${s.status} = 'draft' DESC`, desc(s.issueDate), desc(s.sequence), desc(s.id))
    .limit(p.limit)

  const [invoiceLinks, concepts] = await Promise.all([
    loadQuoteInvoices(company.id, rows.filter(r => r.kind === 'quote' || r.kind === 'proforma').map(r => r.id)),
    salesConcepts(rows),
  ])

  return rows.map(({ contactLogo, description: _description, ...r }) => {
    const { conceptPreview, descriptionText, linesSummary } = concepts.get(r.id)!

    return {
      ...r,
      conceptPreview,
      descriptionText,
      linesSummary,
      invoices: invoiceLinks.get(r.id) ?? [],
      contactLogoUrl: contactLogoUrl(r.contactId, contactLogo),
      overdue: isOpenStatus(r.status) && !!r.dueDate && r.dueDate < today,
    }
  })
})
