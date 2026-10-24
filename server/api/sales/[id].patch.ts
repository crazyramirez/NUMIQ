import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = salesInputSchema.extend({ issue: z.boolean().default(false), status: z.enum(QUOTE_STATUSES).optional() })

/** Guarda los cambios y, si se pide, emite. Los presupuestos se emiten siempre y aceptan su estado */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const { issue: asked, status, ...input } = await readInput(event, schema)
  const [before] = await useDb().select({ status: tables.salesDocuments.status }).from(tables.salesDocuments)
    .where(and(eq(tables.salesDocuments.id, id), eq(tables.salesDocuments.companyId, company.id)))
  const quote = isQuoteKind(input.kind)
  const issue = before?.status === 'draft' && (asked || quote)
  await saveSalesDraft(company.id, user.id, input, id)
  let number: string | null = null
  if (issue) number = await issueSalesDocument(company.id, id)
  const current = issue ? 'issued' : before?.status
  if (quote && status && current !== status && current !== 'invoiced') await setSalesStatus(company.id, id, status)
  await audit(event, { companyId: company.id, userId: user.id, action: issue ? 'sales.issue' : 'sales.update', entity: 'sales_document', entityId: id, data: { number } })
  return { id, number }
})
