import { z } from 'zod'

const schema = z.object({
  data: importInvoiceSchema,
  contactId: z.number().int().positive().nullish().transform(v => v ?? null),
  fileId: z.number().int().positive().nullish().transform(v => v ?? null),
  /** El usuario confirmó que no es un duplicado (solo frena una coincidencia segura) */
  allowDuplicate: z.boolean().optional(),
})

/** Registra una factura emitida escaneada (de otro programa o de papel): conserva su número */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const input = await readInput(event, schema)
  const id = await importSingleInvoice(company, user.id, input)
  await audit(event, { companyId: company.id, userId: user.id, action: 'sales.import', entity: 'sales_document', entityId: id })
  return { id }
})
