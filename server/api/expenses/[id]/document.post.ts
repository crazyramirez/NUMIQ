import { z } from 'zod'

const schema = z.object({
  fileId: z.number().int().positive(),
  number: z.string().trim().max(60).nullish(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  party: importPartySchema.nullish(),
  /** Fecha y desglose de la factura: sustituyen a los estimados de un gasto creado desde el banco */
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  taxLines: expenseInputSchema.shape.taxLines.nullish(),
  irpfRate: z.number().min(0).max(100).nullish(),
})

/** Adjunta la factura o el ticket escaneado a un gasto que ya estaba registrado sin él, en vez de duplicarlo */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const input = await readInput(event, schema)
  const { fiscal } = await attachExpenseDocument(company.id, id, input)
  await audit(event, { companyId: company.id, userId: user.id, action: 'expense.document', entity: 'expense', entityId: id, data: { fileId: input.fileId, fiscal } })
  return { ok: true, fiscal }
})
