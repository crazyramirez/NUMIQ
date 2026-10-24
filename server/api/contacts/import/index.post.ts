/** Empieza a leer un listado de clientes o proveedores (archivos o texto pegado); devuelve el id para seguirlo */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event)
  const parts = (await readMultipartFormData(event)) ?? []
  const field = (name: string) => parts.find(p => p.name === name)?.data.toString('utf8').trim() || null
  const role = field('role')
  if (role !== 'client' && role !== 'supplier' && role !== 'both') throw createError({ statusCode: 400, statusMessage: 'Indica si son clientes, proveedores o ambos' })

  const files = parts.filter(p => p.name === 'file' && p.filename && p.data?.length).map(p => ({ name: p.filename!, data: p.data }))
  const text = field('text')
  if (text && text.length >= 3) files.push({ name: 'Texto pegado.txt', data: Buffer.from(text, 'utf8') })
  if (!files.length) throw createError({ statusCode: 400, statusMessage: 'Sube un archivo o pega el listado' })
  if (files.length > 20) throw createError({ statusCode: 413, statusMessage: 'Sube como máximo 20 archivos a la vez' })
  if (files.reduce((s, f) => s + f.data.length, 0) > 60 * 1024 * 1024) throw createError({ statusCode: 413, statusMessage: 'Los archivos superan 60 MB en total' })

  return { id: startContactImport({ company, role, files }) }
})
