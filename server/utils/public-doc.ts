import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'

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
  // Primera vez que abre una factura: un aviso (las siguientes visitas solo suman; los presupuestos no avisan)
  if (!doc.viewedAt && (doc.kind === 'invoice' || doc.kind === 'rectifying')) {
    void notifyCompany(doc.companyId, {
      title: `${doc.customer?.name ?? 'Tu cliente'} ha abierto tu factura ${doc.number ?? ''}`.trim(),
      body: 'Ya sabe cuánto te debe y cómo pagarte.',
      url: `/facturas/${doc.id}`,
      tag: `view-${doc.id}`,
    }, { alsoUserId: doc.createdBy })
  }
}
