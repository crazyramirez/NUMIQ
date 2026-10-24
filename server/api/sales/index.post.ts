import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = salesInputSchema.extend({ issue: z.boolean().default(false) })

/** Crea un borrador y, si se pide, lo emite en el mismo paso */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const { issue, ...input } = await readInput(event, schema)
  const id = await saveSalesDraft(company.id, user.id, input)
  let number: string | null = null
  if (issue) {
    try {
      number = await issueSalesDocument(company.id, id)
    }
    catch (err) {
      // Si no se puede emitir, no dejar un borrador huérfano: el editor reintentará con los mismos datos
      const db = useDb()
      await db.delete(tables.salesDocumentLines).where(eq(tables.salesDocumentLines.documentId, id))
      await db.delete(tables.salesDocuments).where(and(eq(tables.salesDocuments.id, id), eq(tables.salesDocuments.status, 'draft')))
      throw err
    }
  }
  await audit(event, { companyId: company.id, userId: user.id, action: issue ? 'sales.issue' : 'sales.create', entity: 'sales_document', entityId: id, data: { number } })
  return { id, number }
})
