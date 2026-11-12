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
  /** Documento original importado o escaneado del que sale la factura */
  attachOriginal?: boolean
  /**
   * Copia para la propia empresa (su email o el del usuario): admite borradores, no cuenta como
   * enviada al cliente ni lleva el enlace a la página pública (abrirla la marcaría como vista)
   */
  internal?: boolean
}

const KIND_TITLES: Record<string, string> = { invoice: 'Factura', rectifying: 'Factura rectificativa', quote: 'Presupuesto', proforma: 'Proforma' }

const longDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })

/**
 * Asunto y mensaje por defecto de un envío, con las plantillas del diseño si las hay. Los mismos
 * textos que propone la ventana "Enviar"; la copia interna lleva un texto propio para revisarla.
 */
export function salesEmailTexts(
  company: Company,
  design: Pick<InvoiceDesign, 'defaultEmailSubject' | 'defaultEmailMessage' | 'defaultEmailSubjectQuote' | 'defaultEmailMessageQuote'>,
  doc: { kind: string, status: string, number: string | null, total: number, paidTotal: number, dueDate: string | null, client: string | null },
  contact: { name: string, kind: string } | null,
  opts: { reminder: boolean, internal: boolean },
) {
  return salesEmailDraft(design, {
    kind: doc.kind,
    number: doc.number,
    brand: company.tradeName || company.legalName,
    firstName: contact?.kind === 'person' ? contact.name.split(' ')[0] ?? '' : '',
    client: contact?.name || doc.client || '',
    amount: eurText(doc.total),
    pending: eurText(round2(doc.total - doc.paidTotal)),
    due: doc.dueDate ? longDate(doc.dueDate) : '',
    reminder: opts.reminder,
    internal: opts.internal,
    draft: doc.status === 'draft',
  })
}

type SalesDoc = Awaited<ReturnType<typeof loadSalesDocument>>

/**
 * El correo tal como lo recibe el cliente (texto y HTML): mensaje, datos del documento, botón a la página
 * pública y firma. Lo usan el envío y la vista previa de la ventana «Enviar».
 */
export async function salesEmailBody(company: Company, doc: SalesDoc, input: Pick<SalesEmailInput, 'subject' | 'message' | 'kind' | 'attachPdf' | 'internal'>, site: string) {
  const brand = company.tradeName || company.legalName
  const design = await getCompanyDesign(company)
  const isQuote = doc.kind === 'quote' || doc.kind === 'proforma'
  const label = KIND_TITLES[doc.kind] ?? 'Documento'
  const pending = round2(doc.total - doc.paidTotal)
  // El importe del documento va en el PDF, no en el correo; el recordatorio sí dice lo que queda por pagar
  const details: Array<[string, string]> = [
    [label, doc.number ?? ''],
    ...(input.kind === 'reminder' ? [['Pendiente', eurText(pending)] as [string, string]] : []),
    ...(doc.dueDate ? [[isQuote ? 'Válido hasta' : 'Vencimiento', doc.dueDate.split('-').reverse().join('/')] as [string, string]] : []),
  ]
  // Sin firma en Ajustes, el correo se despide igualmente con el nombre de la empresa
  const signature = await emailSignature(company, design) ?? { doc: [{ k: 'p', c: [{ t: 'Un saludo,' }] }, { k: 'p', c: [{ t: brand, b: true }] }], image: null, imageLeft: false } satisfies MailSignature
  const { text, html } = mailLayout({
    brand,
    accent: design.accentColor,
    title: input.subject,
    lines: input.message.split(/\n{2,}/),
    details,
    // Página pública: ver y descargar o consultar cómo pagar. El presupuesto va en el PDF adjunto (se responde por email)
    action: doc.publicToken && site && !input.internal && !(isQuote && input.attachPdf)
      ? { label: `Ver ${label.toLowerCase()}`, url: `${site.replace(/\/+$/, '')}/p/${doc.publicToken}` }
      : null,
    signature,
    footer: [company.legalName, `NIF ${company.nif}`, company.email].filter(Boolean).join(' · '),
  })
  return { text, html, signature }
}

/**
 * Envía una factura o presupuesto (o un recordatorio de pago) desde el Gmail de la app y lo anota
 * en el historial. Lo usan el botón "Enviar" y las facturas recurrentes con envío automático.
 */
export async function sendSalesEmail(company: Company, userId: number | null, id: number, input: SalesEmailInput, site: string) {
  if (!mailEnabled()) throw createError({ statusCode: 503, statusMessage: 'El correo no está configurado: añade GOOGLE_APP_EMAIL y GOOGLE_APP_PASSWORD' })

  const { buffer, filename, doc } = await salesPdf(company, id)
  if (doc.status === 'draft' && !input.internal) throw createError({ statusCode: 409, statusMessage: 'Emite el documento antes de enviarlo' })

  const brand = company.tradeName || company.legalName
  const { text, html, signature } = await salesEmailBody(company, doc, input, site)

  const db = useDb()
  const extra = input.attachmentIds.length
    ? await db.select().from(tables.files).where(and(
        eq(tables.files.companyId, company.id), eq(tables.files.linkedType, 'sales_document'), eq(tables.files.linkedId, id), inArray(tables.files.id, input.attachmentIds),
      ))
    : []
  if (input.attachOriginal && doc.original && !extra.some(f => f.id === doc.original!.id)) {
    const [file] = await db.select().from(tables.files).where(and(eq(tables.files.id, doc.original.id), eq(tables.files.companyId, company.id)))
    if (file) extra.unshift(file)
  }
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
      attachments: [...(input.attachPdf ? [{ filename, content: buffer, contentType: 'application/pdf' }] : []), ...extraFiles, ...signatureAttachment(signature)],
    })
    if ('skipped' in info) throw new Error('Omitido: dirección de pruebas o fuera de NUXT_MAIL_ONLY_TO')
    await db.insert(tables.sentEmails).values({ ...record, status: 'sent', messageId: info.messageId?.slice(0, 255) ?? null })
  }
  catch (err) {
    const message = (err as Error).message?.slice(0, 500) ?? 'Error desconocido'
    await db.insert(tables.sentEmails).values({ ...record, status: 'failed', error: message })
    throw createError({ statusCode: 502, statusMessage: `Gmail no aceptó el envío: ${message}` })
  }

  // Emitido → enviado (los cobrados o parciales conservan su estado). La copia interna no cuenta
  if (input.internal) return record
  if (doc.status === 'issued') {
    await db.update(tables.salesDocuments).set({ status: 'sent', sentAt: new Date() })
      .where(and(eq(tables.salesDocuments.id, id), eq(tables.salesDocuments.status, 'issued')))
  }
  else {
    await db.update(tables.salesDocuments).set({ sentAt: new Date() }).where(eq(tables.salesDocuments.id, id))
  }
  return record
}
