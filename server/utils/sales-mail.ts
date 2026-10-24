import { and, eq, inArray } from 'drizzle-orm'

type Company = typeof tables.companies.$inferSelect

export interface SalesEmailInput {
  to: string[]
  cc: string[]
  subject: string
  message: string
  kind: 'document' | 'reminder'
  attachPdf: boolean
  /** Adjuntos del documento que viajan también en el correo (orden de pedido, albarán…) */
  attachmentIds: number[]
}

const KIND_TITLES: Record<string, string> = { invoice: 'Factura', rectifying: 'Factura rectificativa', quote: 'Presupuesto', proforma: 'Proforma' }

/**
 * Envía una factura o presupuesto (o un recordatorio de pago) desde el Gmail de la app y lo anota
 * en el historial. Lo usan el botón "Enviar" y las facturas recurrentes con envío automático.
 */
export async function sendSalesEmail(company: Company, userId: number | null, id: number, input: SalesEmailInput, site: string) {
  if (!mailEnabled()) throw createError({ statusCode: 503, statusMessage: 'El correo no está configurado: añade GOOGLE_APP_EMAIL y GOOGLE_APP_PASSWORD' })

  const { buffer, filename, doc } = await salesPdf(company, id)
  if (doc.status === 'draft') throw createError({ statusCode: 409, statusMessage: 'Emite el documento antes de enviarlo' })

  const brand = company.tradeName || company.legalName
  const design = await getCompanyDesign(company)
  const isQuote = doc.kind === 'quote' || doc.kind === 'proforma'
  const label = KIND_TITLES[doc.kind] ?? 'Documento'
  const pending = round2(doc.total - doc.paidTotal)
  const details: Array<[string, string]> = [
    [label, doc.number ?? ''],
    [input.kind === 'reminder' ? 'Pendiente' : 'Importe', eurText(input.kind === 'reminder' ? pending : doc.total)],
    ...(doc.dueDate ? [[isQuote ? 'Válido hasta' : 'Vencimiento', doc.dueDate.split('-').reverse().join('/')] as [string, string]] : []),
  ]
  const { text, html } = mailLayout({
    brand,
    accent: design.accentColor,
    title: input.subject,
    lines: input.message.split(/\n{2,}/),
    details,
    // Página pública: ver y descargar, aceptar el presupuesto o consultar cómo pagar
    action: doc.publicToken && site
      ? { label: isQuote && input.kind === 'document' ? 'Ver y aceptar el presupuesto' : `Ver ${label.toLowerCase()}`, url: `${site.replace(/\/+$/, '')}/p/${doc.publicToken}` }
      : null,
    footer: [company.legalName, `NIF ${company.nif}`, company.email].filter(Boolean).join(' · '),
  })

  const db = useDb()
  const extra = input.attachmentIds.length
    ? await db.select().from(tables.files).where(and(
        eq(tables.files.companyId, company.id), eq(tables.files.linkedType, 'sales_document'), eq(tables.files.linkedId, id), inArray(tables.files.id, input.attachmentIds),
      ))
    : []
  const extraFiles = await Promise.all(extra.map(async f => ({ filename: f.originalName, content: await readStoredFile(f.path), contentType: f.mime })))
  const totalBytes = extraFiles.reduce((s, f) => s + f.content.length, input.attachPdf ? buffer.length : 0)
  if (totalBytes > 20 * 1024 * 1024) throw createError({ statusCode: 413, statusMessage: 'Los adjuntos superan 20 MB: Gmail no los aceptaría' })
  const record = {
    companyId: company.id,
    salesDocumentId: id,
    kind: input.kind,
    to: input.to.join(', '),
    cc: input.cc.length ? input.cc.join(', ') : null,
    subject: input.subject,
    withPdf: input.attachPdf,
    sentBy: userId,
  }
  try {
    const info = await sendMail({
      to: input.to.join(', '),
      cc: input.cc.length ? input.cc.join(', ') : undefined,
      subject: input.subject,
      text,
      html,
      fromName: brand,
      replyTo: company.email ?? undefined,
      attachments: [...(input.attachPdf ? [{ filename, content: buffer, contentType: 'application/pdf' }] : []), ...extraFiles],
    })
    if ('skipped' in info) throw new Error('Omitido: dirección de pruebas o fuera de NUXT_MAIL_ONLY_TO')
    await db.insert(tables.sentEmails).values({ ...record, status: 'sent', messageId: info.messageId?.slice(0, 255) ?? null })
  }
  catch (err) {
    const message = (err as Error).message?.slice(0, 500) ?? 'Error desconocido'
    await db.insert(tables.sentEmails).values({ ...record, status: 'failed', error: message })
    throw createError({ statusCode: 502, statusMessage: `Gmail no aceptó el envío: ${message}` })
  }

  // Emitido → enviado (los cobrados o parciales conservan su estado)
  if (doc.status === 'issued') {
    await db.update(tables.salesDocuments).set({ status: 'sent', sentAt: new Date() })
      .where(and(eq(tables.salesDocuments.id, id), eq(tables.salesDocuments.status, 'issued')))
  }
  else {
    await db.update(tables.salesDocuments).set({ sentAt: new Date() }).where(eq(tables.salesDocuments.id, id))
  }
  return record
}
