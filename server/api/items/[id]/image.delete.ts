import { and, eq } from 'drizzle-orm'

/** Quita la imagen del producto */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const db = useDb()
  const [item] = await db.select({ imagePath: tables.items.imagePath }).from(tables.items)
    .where(and(eq(tables.items.id, id), eq(tables.items.companyId, company.id)))
  if (!item) throw createError({ statusCode: 404, statusMessage: 'Producto no encontrado' })
  await db.update(tables.items).set({ imagePath: null }).where(eq(tables.items.id, id))
  await deleteStoredFile(item.imagePath)
  await audit(event, { companyId: company.id, userId: user.id, action: 'item.image.delete', entity: 'item', entityId: id })
  return { ok: true }
})
