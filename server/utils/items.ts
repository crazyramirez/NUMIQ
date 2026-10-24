import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

export const itemInputSchema = z.object({
  kind: z.enum(['service', 'product']).default('service'),
  name: z.string().trim().min(1, 'Escribe un nombre').max(200),
  description: z.string().max(2000).nullish().transform(v => v || null),
  sku: z.string().trim().max(60).nullish().transform(v => v || null),
  unit: z.string().trim().max(20).nullish().transform(v => v || null),
  unitPrice: z.number().finite().min(0, 'El precio no puede ser negativo'),
  vatRate: z.number().min(0).max(100),
  /** Sin el campo, la categoría no cambia; null la quita */
  categoryId: z.number().int().positive().nullable().optional(),
})

export const itemCategoryInputSchema = z.object({
  name: z.string().trim().min(1, 'Escribe un nombre').max(80),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, 'Color no válido').nullish(),
})

/** Comprueba que la categoría es de la empresa (null o sin indicar: nada que comprobar) */
export async function assertItemCategory(companyId: number, categoryId: number | null | undefined) {
  if (categoryId == null) return
  const [cat] = await useDb().select({ id: tables.itemCategories.id }).from(tables.itemCategories)
    .where(and(eq(tables.itemCategories.id, categoryId), eq(tables.itemCategories.companyId, companyId)))
  if (!cat) throw createError({ statusCode: 400, statusMessage: 'La categoría no existe', data: { field: 'categoryId' } })
}

/** Otra categoría con el mismo nombre (sin distinguir mayúsculas ni tildes, como hace la colación de MariaDB) */
export async function assertItemCategoryName(companyId: number, name: string, exceptId?: number) {
  const [dup] = await useDb().select({ id: tables.itemCategories.id }).from(tables.itemCategories)
    .where(and(eq(tables.itemCategories.companyId, companyId), eq(tables.itemCategories.name, name)))
  if (dup && dup.id !== exceptId) throw createError({ statusCode: 409, statusMessage: 'Ya tienes una categoría con ese nombre', data: { field: 'name' } })
}

/** Producto para la app: la ruta interna de la imagen se cambia por su URL (con versión para la caché) */
export function itemView<T extends { id: number, imagePath: string | null }>(item: T) {
  const { imagePath, ...rest } = item
  return { ...rest, imageUrl: imagePath ? `/api/items/${item.id}/image?v=${encodeURIComponent(imagePath.split('/').pop() ?? '')}` : null }
}

/**
 * Elimina productos o servicios del catálogo de la empresa.
 * Las líneas de facturas y presupuestos que los usan conservan concepto, precio e IVA,
 * pero dejan de estar vinculadas (itemId = null), igual que las plantillas recurrentes.
 */
export async function deleteItems(companyId: number, ids: number[]) {
  const db = useDb()
  const found = await db.select({ id: tables.items.id, name: tables.items.name, imagePath: tables.items.imagePath })
    .from(tables.items)
    .where(and(eq(tables.items.companyId, companyId), inArray(tables.items.id, ids)))
  if (!found.length) return { deleted: [], unlinkedDocuments: 0 }
  const foundIds = found.map(i => i.id)
  const gone = new Set(foundIds)

  const l = tables.salesDocumentLines
  const ownDocs = db.select({ id: tables.salesDocuments.id }).from(tables.salesDocuments)
    .where(eq(tables.salesDocuments.companyId, companyId))
  const [used] = await db.select({ count: sql<number>`COUNT(DISTINCT ${l.documentId})`.mapWith(Number) })
    .from(l).where(and(inArray(l.itemId, foundIds), inArray(l.documentId, ownDocs)))
  const unlinkedDocuments = used?.count ?? 0

  await db.transaction(async (tx) => {
    if (unlinkedDocuments) {
      await tx.update(l).set({ itemId: null })
        .where(and(inArray(l.itemId, foundIds), inArray(l.documentId, ownDocs)))
    }

    const recurrings = await tx.select().from(tables.recurrings)
      .where(eq(tables.recurrings.companyId, companyId))
    for (const rec of recurrings) {
      const lines = rec.template?.lines
      if (!rec.template || !lines?.some(x => x.itemId != null && gone.has(x.itemId))) continue
      await tx.update(tables.recurrings)
        .set({ template: { ...rec.template, lines: lines.map(x => (x.itemId != null && gone.has(x.itemId) ? { ...x, itemId: null } : x)) } })
        .where(eq(tables.recurrings.id, rec.id))
    }

    await tx.delete(tables.items)
      .where(and(eq(tables.items.companyId, companyId), inArray(tables.items.id, foundIds)))
  })

  for (const i of found) await deleteStoredFile(i.imagePath)
  return { deleted: found, unlinkedDocuments }
}
