import { and, eq, inArray } from 'drizzle-orm'
import type { H3Event } from 'h3'

type Company = typeof tables.companies.$inferSelect
type SalesDoc = typeof tables.salesDocuments.$inferSelect

const notFound = () => createError({ statusCode: 404, statusMessage: 'Documento no encontrado' })

/**
 * Documento emitido por su enlace público (token aleatorio de 24 bytes). Los borradores nunca son
 * accesibles: el token existe desde que se crea, pero solo sirve una vez emitido.
 */
export async function findPublicDoc(token: string) {
  if (!/^[\w-]{20,64}$/.test(token)) throw notFound()
  const db = useDb()
  const [doc] = await db.select().from(tables.salesDocuments).where(eq(tables.salesDocuments.publicToken, token))
  if (!doc || doc.status === 'draft') throw notFound()
  const [company] = await db.select().from(tables.companies).where(eq(tables.companies.id, doc.companyId))
  if (!company) throw notFound()
  return { doc, company }
}

export type QuoteState = 'open' | 'accepted' | 'rejected' | 'invoiced' | 'cancelled'

/** Situación de un presupuesto para el cliente (no caduca: se puede aceptar pasada su validez); null si no es un presupuesto */
export function quoteState(doc: Pick<SalesDoc, 'kind' | 'status'>): QuoteState | null {
  if (doc.kind !== 'quote' && doc.kind !== 'proforma') return null
  if (doc.status === 'accepted' || doc.status === 'rejected' || doc.status === 'invoiced' || doc.status === 'cancelled') return doc.status
  if (doc.status === 'expired') return 'rejected'
  return 'open'
}

/** Cuenta la visita del cliente (no las de la propia empresa revisando su enlace) */
export async function trackPublicView(event: H3Event, doc: SalesDoc) {
  const session = await getUserSession(event).catch(() => null)
  const user: { id?: number } | undefined = session?.user
  const userId = user?.id
  if (userId) {
    const [member] = await useDb().select({ role: tables.companyMembers.role }).from(tables.companyMembers)
      .where(and(eq(tables.companyMembers.companyId, doc.companyId), eq(tables.companyMembers.userId, userId)))
    if (member) return
  }
  await useDb().update(tables.salesDocuments)
    .set({ viewCount: doc.viewCount + 1, viewedAt: doc.viewedAt ?? new Date() })
    .where(eq(tables.salesDocuments.id, doc.id))
    .catch(err => console.warn('[public-doc] visita', err))
  // Primera vez que lo abre: un aviso (las siguientes visitas solo suman)
  if (!doc.viewedAt) {
    const quote = doc.kind === 'quote' || doc.kind === 'proforma'
    const who = doc.customer?.name ?? 'Tu cliente'
    void notifyCompany(doc.companyId, {
      title: `${who} ha abierto tu ${quote ? 'presupuesto' : 'factura'} ${doc.number ?? ''}`.trim(),
      body: quote ? 'Buen momento para llamarle y resolver dudas.' : 'Ya sabe cuánto te debe y cómo pagarte.',
      url: quote ? `/presupuestos/${doc.id}` : `/facturas/${doc.id}`,
      tag: `view-${doc.id}`,
    }, { alsoUserId: doc.createdBy })
  }
}

/** Avisa a los responsables de la empresa de que el cliente ha aceptado o rechazado un presupuesto */
export async function notifyQuoteResponse(company: Company, doc: SalesDoc, accepted: boolean, name: string, note: string | null, site: string) {
  void notifyCompany(company.id, {
    title: `${doc.customer?.name ?? 'Tu cliente'} ha ${accepted ? 'aceptado' : 'rechazado'} el presupuesto ${doc.number ?? ''}`.trim(),
    body: note ? `«${note.slice(0, 140)}»` : accepted ? 'Conviértelo en factura con un toque.' : 'Puede ser buen momento para llamarle.',
    url: `/presupuestos/${doc.id}`,
    tag: `quote-${doc.id}`,
  }, { alsoUserId: doc.createdBy })
  if (!mailEnabled()) return
  const db = useDb()
  const admins = await db.select({ email: tables.users.email }).from(tables.companyMembers)
    .innerJoin(tables.users, eq(tables.users.id, tables.companyMembers.userId))
    .where(and(eq(tables.companyMembers.companyId, company.id), inArray(tables.companyMembers.role, ['owner', 'admin'])))
  const creator = doc.createdBy
    ? await db.select({ email: tables.users.email }).from(tables.users).where(eq(tables.users.id, doc.createdBy)).then(r => r[0] ?? null)
    : null
  const to = [...new Set([...admins.map(a => a.email), ...(creator ? [creator.email] : [])].map(e => e.toLowerCase()))]
  if (!to.length) return
  const customer = doc.customer?.name ?? 'Tu cliente'
  const title = `${customer} ha ${accepted ? 'aceptado' : 'rechazado'} el presupuesto ${doc.number ?? ''}`.trim()
  const { text, html } = mailLayout({
    brand: 'NUMIQ',
    accent: '#4f46e5',
    title,
    lines: [
      `${name} lo ha ${accepted ? 'aceptado' : 'rechazado'} desde el enlace del presupuesto.`,
      ...(note ? [`Su comentario: «${note}»`] : []),
      accepted ? 'Ya puedes convertirlo en factura con un clic.' : 'Puede ser buen momento para llamarle y conocer el motivo.',
    ],
    details: [
      ['Presupuesto', doc.number ?? ''],
      ['Cliente', customer],
      ['Importe', eurText(doc.total)],
    ],
    action: site ? { label: 'Abrir el presupuesto', url: `${site.replace(/\/+$/, '')}/presupuestos/${doc.id}` } : null,
    footer: `${company.tradeName || company.legalName} · Aviso automático de NUMIQ`,
  })
  await sendMail({ to: to.join(', '), subject: title, text, html, fromName: 'NUMIQ' })
}
