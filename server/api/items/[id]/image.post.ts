import { and, eq } from 'drizzle-orm'

const MAX_BYTES = 3 * 1024 * 1024

/** Imagen del producto: PNG o JPG de hasta 3 MB (el navegador ya la envía reducida) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const db = useDb()
  const [item] = await db.select({ id: tables.items.id, imagePath: tables.items.imagePath }).from(tables.items)
    .where(and(eq(tables.items.id, id), eq(tables.items.companyId, company.id)))
  if (!item) throw createError({ statusCode: 404, statusMessage: 'Producto no encontrado' })
  const parts = await readMultipartFormData(event)
  const file = parts?.find(p => p.name === 'file' && p.data?.length)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'Elige una imagen' })
  if (file.data.length > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: 'La imagen supera 3 MB' })
  const kind = detectImage(file.data)
  if (!kind || kind.ext === 'svg') throw createError({ statusCode: 415, statusMessage: 'Formato no admitido: usa una foto JPG o PNG' })

  const rel = await saveCompanyFile(company.id, 'items', file.data, kind.ext)
  await db.update(tables.items).set({ imagePath: rel }).where(eq(tables.items.id, id))
  await deleteStoredFile(item.imagePath)
  await audit(event, { companyId: company.id, userId: user.id, action: 'item.image', entity: 'item', entityId: id })
  return { imageUrl: itemView({ id, imagePath: rel }).imageUrl }
})
