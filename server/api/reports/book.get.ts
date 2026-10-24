import { z } from 'zod'

const schema = reportQuerySchema.extend({ type: z.enum(['issued', 'received']).default('issued') })

/** Libro registro de facturas emitidas o recibidas del periodo */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const q = readQueryInput(event, schema)
  const p = resolveReportPeriod(q.year, q.quarter, q.month)
  return q.type === 'issued'
    ? { type: 'issued' as const, issued: await issuedBook(company.id, p.from, p.to), received: null }
    : { type: 'received' as const, issued: null, received: await receivedBook(company.id, p.from, p.to) }
})
