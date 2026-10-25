import { and, eq, inArray, isNotNull, notInArray } from 'drizzle-orm'

/** Registros que la AEAT ya tiene o está procesando: esa factura solo se corrige con una rectificativa */
const REGISTERED_AT_AEAT = ['sent', 'accepted', 'accepted_with_errors'] as const

/**
 * Elimina documentos de venta (facturas, presupuestos, proformas, rectificativas) con lo que es suyo:
 * líneas, cobros, correos enviados y adjuntos. Lo relacionado no se borra, se desvincula: los movimientos
 * del banco vuelven a pendientes, las rectificativas y documentos derivados pierden el enlace y el PDF
 * importado se conserva si otro documento sacado del mismo archivo sigue existiendo.
 * Las facturas ya registradas ante la AEAT (VeriFactu) no se borran: vuelven en `blocked`.
 */
export async function deleteSalesDocuments(companyId: number, ids: number[]) {
  const db = useDb()
  const s = tables.salesDocuments
  const docs = await db.select({ id: s.id, number: s.number, kind: s.kind, status: s.status, total: s.total, fileId: s.fileId })
    .from(s)
    .where(and(eq(s.companyId, companyId), inArray(s.id, ids)))
  if (!docs.length) return { deleted: [], blocked: [] }

  const vf = tables.verifactuRecords
  const registered = await db.selectDistinct({ id: vf.salesDocumentId }).from(vf)
    .where(and(eq(vf.companyId, companyId), inArray(vf.salesDocumentId, docs.map(d => d.id)), inArray(vf.status, [...REGISTERED_AT_AEAT])))
  const blockedIds = new Set(registered.map(r => r.id))
  const blocked = docs.filter(d => blockedIds.has(d.id))
  const deleted = docs.filter(d => !blockedIds.has(d.id))
  if (!deleted.length) return { deleted, blocked }

  const docIds = deleted.map(d => d.id)
  const gone = new Set(docIds)
  const storedPaths: string[] = []

  await db.transaction(async (tx) => {
    // 1. Movimientos del banco conciliados con los documentos o con sus cobros: vuelven a pendientes
    const paymentIds = (await tx.select({ id: tables.payments.id }).from(tables.payments)
      .where(inArray(tables.payments.salesDocumentId, docIds))).map(p => p.id)
    const bt = tables.bankTransactions
    // Un pago de varias facturas pierde una: vuelve a pendiente y las demás, a por cobrar
    await releaseBankGroups(tx, companyId, paymentIds)
    const unmatch = { status: 'pending' as const, salesDocumentId: null, paymentId: null, ownsPayment: false, ignoreReason: null, matchedAt: null, matchedBy: null }
    await tx.update(bt).set(unmatch).where(and(eq(bt.companyId, companyId), inArray(bt.salesDocumentId, docIds)))
    if (paymentIds.length) await tx.update(bt).set(unmatch).where(and(eq(bt.companyId, companyId), inArray(bt.paymentId, paymentIds)))

    // 2. Propuestas de conciliación que señalaban a estos documentos o a sus cobros
    const paid = new Set(paymentIds)
    const suggested = await tx.select({ id: bt.id, suggestion: bt.suggestion }).from(bt)
      .where(and(eq(bt.companyId, companyId), eq(bt.status, 'pending'), isNotNull(bt.suggestion)))
    for (const t of suggested) {
      const sg = t.suggestion
      if (sg?.id != null && ((sg.kind === 'invoice' && [sg.id, ...(sg.ids ?? [])].some(id => gone.has(id))) || (sg.kind === 'payment' && paid.has(sg.id)))) {
        await tx.update(bt).set({ suggestion: null }).where(eq(bt.id, t.id))
      }
    }

    // 3. Lo propio del documento: cobros, registros VeriFactu sin enviar, correos y líneas
    await tx.delete(tables.payments).where(inArray(tables.payments.salesDocumentId, docIds))
    await tx.delete(vf).where(and(eq(vf.companyId, companyId), inArray(vf.salesDocumentId, docIds)))
    await tx.delete(tables.sentEmails).where(inArray(tables.sentEmails.salesDocumentId, docIds))
    await tx.delete(tables.salesDocumentLines).where(inArray(tables.salesDocumentLines.documentId, docIds))

    // 4. Rectificativas y documentos derivados (presupuesto → factura) pierden el enlace
    await tx.update(s).set({ rectifiesId: null }).where(and(eq(s.companyId, companyId), inArray(s.rectifiesId, docIds)))
    await tx.update(s).set({ sourceId: null }).where(and(eq(s.companyId, companyId), inArray(s.sourceId, docIds)))

    // 5. Adjuntos y PDF de origen (este, solo si ningún otro documento lo usa)
    const f = tables.files
    const attached = await tx.select({ id: f.id, path: f.path }).from(f)
      .where(and(eq(f.companyId, companyId), eq(f.linkedType, 'sales_document'), inArray(f.linkedId, docIds)))
    const sourceIds = [...new Set(deleted.map(d => d.fileId).filter((x): x is number => x != null))]
    let sources: typeof attached = []
    if (sourceIds.length) {
      const shared = new Set((await tx.select({ fileId: s.fileId }).from(s)
        .where(and(eq(s.companyId, companyId), inArray(s.fileId, sourceIds), notInArray(s.id, docIds)))).map(r => r.fileId))
      const free = sourceIds.filter(id => !shared.has(id))
      if (free.length) sources = await tx.select({ id: f.id, path: f.path }).from(f).where(and(eq(f.companyId, companyId), inArray(f.id, free)))
    }
    const files = [...new Map([...attached, ...sources].map(x => [x.id, x])).values()]
    if (files.length) await tx.delete(f).where(inArray(f.id, files.map(x => x.id)))
    storedPaths.push(...files.map(x => x.path))

    // 6. Los documentos
    await tx.delete(s).where(and(eq(s.companyId, companyId), inArray(s.id, docIds)))
  })

  for (const p of storedPaths) await deleteStoredFile(p)
  return { deleted, blocked }
}
