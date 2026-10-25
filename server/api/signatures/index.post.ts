import { z } from 'zod'

const fields = z.object({
  name: z.string().trim().min(1, 'Ponle un nombre').max(60),
  kind: z.enum(['drawn', 'typed', 'image']),
})

/** Guarda una firma nueva: PNG con fondo transparente preparado en el navegador (dibujada, escrita o subida) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const parts = await readMultipartFormData(event) ?? []
  const text = (n: string) => parts.find(p => p.name === n)?.data.toString('utf8')
  const file = parts.find(p => p.name === 'file' && p.data?.length)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'Falta la imagen de la firma' })
  const parsed = fields.safeParse({ name: text('name'), kind: text('kind') })
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'Datos no válidos' })
  const signature = await createSignature(company.id, user.id, { ...parsed.data, data: file.data })
  await audit(event, { companyId: company.id, userId: user.id, action: 'signature.create', entity: 'signature', entityId: signature.id, data: { name: signature.name, kind: signature.kind } })
  return signature
})
