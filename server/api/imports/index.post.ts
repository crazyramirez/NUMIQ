import { z } from 'zod'

const schema = z.object({
  name: z.string().trim().max(200).nullish(),
  direction: z.enum(['issued', 'received', 'auto']).default('auto'),
  options: z.object({ createItems: z.boolean().default(true), markPaid: z.boolean().default(true) }).default({ createItems: true, markPaid: true }),
})

/** Abre una importación por lotes; los archivos se suben después en tandas */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  await requireAi()
  const input = await readInput(event, schema)
  const id = await createBatch(company.id, user.id, { source: 'upload', ...input })
  await audit(event, { companyId: company.id, userId: user.id, action: 'import.create', entity: 'import_batch', entityId: id })
  return { id }
})
