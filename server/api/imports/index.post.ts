import { z } from 'zod'

const schema = z.object({
  name: z.string().trim().max(200).nullish(),
  direction: z.enum(['issued', 'received', 'auto']).default('auto'),
  options: z.object({ createItems: z.boolean().default(true), markPaid: z.boolean().default(true) }).default({ createItems: true, markPaid: true }),
})

/** Abre una importación por lotes; los archivos se suben después en tandas */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  if (!aiEnabled()) throw createError({ statusCode: 503, statusMessage: 'La IA no está configurada: añade NUXT_OPENAI_API_KEY en el .env' })
  const input = await readInput(event, schema)
  const id = await createBatch(company.id, user.id, { source: 'upload', ...input })
  await audit(event, { companyId: company.id, userId: user.id, action: 'import.create', entity: 'import_batch', entityId: id })
  return { id }
})
