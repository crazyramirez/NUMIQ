import { z } from 'zod'

const schema = reportQuerySchema.extend({
  format: z.enum(['xlsx', 'csv', 'pdf']).default('xlsx'),
  /** Solo CSV: qué tabla (el Excel y el PDF llevan todo) */
  book: z.enum(['issued', 'received', 'summary']).default('issued'),
})

const MIME = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv; charset=utf-8', pdf: 'application/pdf' } as const

/** Descarga del informe en Excel, CSV (libros registro o resumen) o PDF con la marca de la empresa */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'advisor')
  const q = readQueryInput(event, schema)
  const period = resolveReportPeriod(q.year, q.quarter, q.month)
  const [report, issued, received] = await Promise.all([
    buildReport(company, period),
    issuedBook(company.id, period.from, period.to),
    receivedBook(company.id, period.from, period.to),
  ])

  let body: Buffer | string
  let filename: string
  if (q.format === 'xlsx') {
    body = reportWorkbook(report, issued, received)
    filename = reportFilename('report', period, 'xlsx')
  }
  else if (q.format === 'csv') {
    body = reportCsv(q.book, report, issued, received)
    filename = reportFilename(q.book, period, 'csv')
  }
  else {
    body = await reportPdf(company, report, issued, received)
    filename = reportFilename('report', period, 'pdf')
  }

  await audit(event, { companyId: company.id, userId: user.id, action: 'report.export', data: { format: q.format, book: q.book, period: period.slug } })
  setResponseHeaders(event, {
    'content-type': MIME[q.format],
    'content-disposition': `${q.format === 'pdf' && getQuery(event).download === undefined ? 'inline' : 'attachment'}; filename="${filename}"`,
    'cache-control': 'no-store',
  })
  return body
})
