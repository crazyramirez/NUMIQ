import { and, desc, eq, inArray, ne } from 'drizzle-orm'

type Company = typeof tables.companies.$inferSelect

const TITLE_SLUG: Record<string, string> = { invoice: 'Factura', rectifying: 'Factura-rectificativa', quote: 'Presupuesto', proforma: 'Proforma' }

const pdfCompany = (c: Company): PdfCompany => ({
  legalName: c.legalName, tradeName: c.tradeName, nif: c.nif, email: c.email, phone: c.phone, website: c.website, iban: c.iban, invoiceFooter: c.invoiceFooter,
})

export function pdfFilename(kind: string, number: string | null) {
  return `${TITLE_SLUG[kind] ?? 'Documento'}-${(number ?? 'borrador').replace(/[^\w.-]+/g, '_')}.pdf`
}

/** PDF de una factura o presupuesto de la empresa con su diseño y su logo */
export async function salesPdf(company: Company, id: number, designOverride?: InvoiceDesign, opts: { verifactu?: boolean, defaultTexts?: boolean, forcePaymentMethod?: string } = {}) {
  const db = useDb()
  const doc = await loadSalesDocument(company.id, id)
  const design = designOverride ?? await getCompanyDesign(company)

  let skus = new Map<number, string | null>()
  const itemIds = [...new Set(doc.lines.map(l => l.itemId).filter((x): x is number => !!x))]
  if (design.showItemCodes && itemIds.length) {
    const rows = await db.select({ id: tables.items.id, sku: tables.items.sku }).from(tables.items).where(inArray(tables.items.id, itemIds))
    skus = new Map(rows.map(r => [r.id, r.sku]))
  }
  const rectified = doc.rectifiesId
    ? (await db.select({ number: tables.salesDocuments.number }).from(tables.salesDocuments).where(eq(tables.salesDocuments.id, doc.rectifiesId)))[0]?.number ?? null
    : null

  const data: PdfDocument = {
    kind: doc.kind,
    status: doc.status,
    number: doc.number,
    issueDate: doc.issueDate,
    dueDate: doc.dueDate,
    operationDate: doc.operationDate,
    paymentMethod: opts.forcePaymentMethod ?? doc.paymentMethod,
    description: doc.description,
    // En la vista previa del diseño, los textos por defecto (si los hay) en lugar de los del documento
    notes: opts.defaultTexts && design.defaultNotes.trim() ? design.defaultNotes : doc.notes,
    terms: opts.defaultTexts && design.defaultTerms.trim() ? design.defaultTerms : doc.terms,
    irpfRate: doc.irpfRate,
    rectificationCode: doc.rectificationCode,
    rectificationReason: doc.rectificationReason,
    rectifiedNumber: rectified,
    customerReference: doc.customerReference,
    issuer: doc.issuer ?? companySnapshot(company),
    customer: doc.customer ?? (doc.contact ? contactSnapshot(doc.contact) : null),
    lines: doc.lines.map(l => ({ ...l, sku: l.itemId ? skus.get(l.itemId) ?? null : null })),
    verifactu: doc.verifactu && opts.verifactu !== false ? { qrUrl: doc.verifactu.qrUrl, hash: doc.verifactu.hash } : null,
  }
  const logo = await companyLogo(company.logoPath)
  const comp = pdfCompany(company)
  if (opts.defaultTexts && !comp.iban) {
    comp.iban = 'ES91 2100 0418 4502 0005 1332'
  }
  const buffer = await renderPdf(buildInvoicePdf(data, comp, design, logo))
  return { buffer, filename: pdfFilename(doc.kind, doc.number), doc }
}

/** Vista previa del diseño: el último documento emitido del tipo solicitado (por defecto factura) o, si no hay, un ejemplo representativo */
export async function designPreviewPdf(company: Company, design: InvoiceDesign, docKind: 'invoice' | 'quote' = 'invoice') {
  const db = useDb()
  const isQuote = docKind === 'quote'
  const allowedKinds: Array<'quote' | 'proforma' | 'invoice' | 'rectifying'> = isQuote
    ? ['quote', 'proforma']
    : ['invoice', 'rectifying']

  const [last] = await db.select({ id: tables.salesDocuments.id }).from(tables.salesDocuments)
    .where(and(
      eq(tables.salesDocuments.companyId, company.id),
      inArray(tables.salesDocuments.kind, allowedKinds),
      ne(tables.salesDocuments.status, 'draft'),
    ))
    .orderBy(desc(tables.salesDocuments.issueDate), desc(tables.salesDocuments.id))
    .limit(1)

  if (last) {
    return (await salesPdf(company, last.id, design, {
      verifactu: company.verifactuEnabled && !isQuote,
      defaultTexts: true,
      forcePaymentMethod: isQuote ? undefined : 'transfer',
    })).buffer
  }

  const today = toISODate(new Date())
  const dueDate = toISODate(new Date(Date.now() + 30 * 86_400_000))
  const sample: PdfDocument = {
    kind: isQuote ? 'quote' : 'invoice',
    status: 'issued',
    number: isQuote ? 'P2026-0001' : 'F2026-0001',
    issueDate: today,
    dueDate,
    operationDate: null,
    paymentMethod: isQuote ? null : 'transfer',
    notes: isQuote ? null : (design.defaultNotes.trim() || 'Gracias por confiar en nosotros.'),
    terms: isQuote ? (design.defaultTerms.trim() || 'Presupuesto válido durante 30 días. Pago 50% al inicio y 50% a la entrega.') : null,
    irpfRate: company.kind === 'autonomo' ? 15 : 0,
    rectificationCode: null,
    rectificationReason: null,
    customerReference: 'ORD-2026-9812',
    issuer: companySnapshot(company),
    customer: {
      name: 'Cliente de ejemplo SL',
      nif: 'B12345674',
      address: 'Calle Mayor 1',
      postalCode: '28013',
      city: 'Madrid',
      province: 'Madrid',
      country: 'ES',
    },
    lines: [
      {
        description: 'Servicio profesional\nDescripción detallada del trabajo realizado',
        quantity: 1,
        unitPrice: 1200,
        discountPct: 0,
        vatRate: 21,
        surchargeRate: 0,
        irpfApplies: true,
        base: 1200,
        sku: 'SRV-01',
      },
      {
        description: 'Horas de consultoría',
        quantity: 6,
        unitPrice: 65,
        discountPct: 10,
        vatRate: 21,
        surchargeRate: 0,
        irpfApplies: true,
        base: 351,
        sku: 'CON-H',
      },
    ],
    verifactu: (!isQuote && company.verifactuEnabled)
      ? { qrUrl: verifactuQrUrl({ issuerNif: company.nif, invoiceNumber: 'F2026-0001', invoiceDate: today, total: 1500 }), hash: '0'.repeat(64) }
      : null,
  }

  const comp = pdfCompany(company)
  if (!isQuote && !comp.iban) {
    comp.iban = 'ES91 2100 0418 4502 0005 1332'
  }

  return renderPdf(buildInvoicePdf(sample, comp, design, await companyLogo(company.logoPath)))
}

