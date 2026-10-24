import { z } from 'zod'

const schema = z.object({ importId: z.number().int().positive() })

/** Deshace una importación de contactos: quita las fichas creadas sin usar y restaura lo completado */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const { importId } = await readInput(event, schema)
  const result = await undoContactImport(company.id, importId)
  await audit(event, { companyId: company.id, userId: user.id, action: 'contact.import_undo', entity: 'contact', data: { importId, ...result } })
  return result
})
