import { and, desc, eq, sql } from 'drizzle-orm'

/** Estado de VeriFactu: ajustes, certificado, recuento por estado y últimos registros */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const db = useDb()
  const v = tables.verifactuRecords
  const s = tables.salesDocuments
  const [counts, records, cert] = await Promise.all([
    db.select({ status: v.status, n: sql<number>`count(*)` }).from(v).where(eq(v.companyId, company.id)).groupBy(v.status),
    db.select({
      id: v.id, invoiceNumber: v.invoiceNumber, invoiceDate: v.invoiceDate, invoiceType: v.invoiceType, total: v.total, status: v.status,
      error: v.error, sentAt: v.sentAt, aeatCsv: v.aeatCsv, hash: v.hash, salesDocumentId: v.salesDocumentId,
      customer: sql<string | null>`JSON_UNQUOTE(JSON_EXTRACT(${s.customer}, '$.name'))`,
    }).from(v).leftJoin(s, and(eq(s.id, v.salesDocumentId), eq(s.companyId, company.id)))
      .where(eq(v.companyId, company.id)).orderBy(desc(v.id)).limit(100),
    currentCertificate(company.id),
  ])
  const settings = verifactuSettings(company)
  return {
    enabled: company.verifactuEnabled,
    settings,
    endpoint: verifactuEndpoint(settings.environment, cert?.kind === 'sello'),
    certificate: cert
      ? { holderName: cert.holderName, holderNif: cert.holderNif, validTo: cert.validTo, expired: cert.validTo < new Date(), matchesCompany: !!cert.holderNif && normalizeNif(cert.holderNif) === normalizeNif(company.nif) }
      : null,
    counts: Object.fromEntries(counts.map(c => [c.status, Number(c.n)])),
    records,
  }
})
