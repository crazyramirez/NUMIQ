/**
 * Vista pública de un documento emitido (página /p/:token): la hoja con el diseño de la empresa,
 * el estado del cobro y los datos para pagar (un presupuesto solo se ve y se descarga). Sin datos internos (cobros, envíos, notas privadas).
 */
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token') ?? ''
  const { doc, company } = await findPublicDoc(token)
  const [full, design] = await Promise.all([loadSalesDocument(company.id, doc.id), getCompanyDesign(company)])
  await trackPublicView(event, doc)
  setResponseHeaders(event, { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' })

  const isInvoice = doc.kind === 'invoice' || doc.kind === 'rectifying'
  const pending = round2(doc.total - doc.paidTotal)
  const base = `/api/public/doc/${token}`
  return {
    doc: {
      kind: doc.kind,
      status: doc.status,
      number: doc.number,
      issueDate: doc.issueDate,
      dueDate: doc.dueDate,
      operationDate: doc.operationDate,
      paymentMethod: doc.paymentMethod,
      description: doc.description,
      notes: doc.notes,
      terms: doc.terms,
      irpfRate: doc.irpfRate,
      rectificationCode: doc.rectificationCode,
      rectificationReason: doc.rectificationReason,
      customerReference: doc.customerReference,
      issuer: doc.issuer,
      customer: doc.customer,
      contact: null,
      total: doc.total,
      lines: full.lines.map(l => ({
        id: l.id, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct,
        vatRate: l.vatRate, surchargeRate: l.surchargeRate, irpfApplies: l.irpfApplies, base: l.base,
      })),
      verifactu: full.verifactu && { hash: full.verifactu.hash, qrUrl: full.verifactu.qrUrl },
    },
    company: {
      legalName: company.legalName,
      tradeName: company.tradeName,
      nif: company.nif,
      address: company.address,
      postalCode: company.postalCode,
      city: company.city,
      province: company.province,
      iban: company.iban,
      brandColor: company.brandColor,
      invoiceFooter: company.invoiceFooter,
      email: company.email,
      phone: company.phone,
      website: company.website,
    },
    design,
    logoUrl: company.logoPath ? `${base}/logo` : null,
    pdfUrl: base,
    payment: isInvoice
      ? {
          paid: doc.status === 'paid' || pending <= 0,
          pending: Math.max(0, pending),
          paidTotal: doc.paidTotal,
          dueDate: doc.dueDate,
          method: doc.paymentMethod,
          iban: doc.paymentMethod === 'transfer' ? company.iban : null,
          cancelled: doc.status === 'cancelled',
          // Pago online del propio negocio (enlace de pago, Bizum): siempre que quede algo por pagar
          online: onlinePaymentsOf(company),
        }
      : null,
  }
})
