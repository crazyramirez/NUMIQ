import { z } from 'zod'

const schema = salesInputSchema.extend({ issue: z.boolean().default(false) })

export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const { issue, ...input } = await readInput(event, schema)
  await saveSalesDraft(company.id, user.id, input, id)
  let number: string | null = null
  if (issue) number = await issueSalesDocument(company.id, id)
  await audit(event, { companyId: company.id, userId: user.id, action: issue ? 'sales.issue' : 'sales.update', entity: 'sales_document', entityId: id, data: { number } })
  return { id, number }
})
