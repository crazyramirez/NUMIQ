import { and, eq, inArray, isNull, sql } from 'drizzle-orm'

/**
 * Elimina contactos (clientes o proveedores). Sus facturas, presupuestos, gastos, importaciones y
 * plantillas recurrentes no se tocan: solo se desvinculan. Antes, los documentos que aún no guardaban
 * los datos del cliente o proveedor (borradores, sobre todo) se quedan con una copia, para no perderlos.
 */
export async function deleteContacts(companyId: number, ids: number[]) {
  const db = useDb()
  const c = tables.contacts
  const found = await db.select().from(c).where(and(eq(c.companyId, companyId), inArray(c.id, ids)))
  if (!found.length) return { deleted: [], unassignedSales: 0, unassignedExpenses: 0 }
  const foundIds = found.map(x => x.id)
  const gone = new Set(foundIds)

  const s = tables.salesDocuments
  const e = tables.expenses
  const [sales] = await db.select({ n: sql<number>`COUNT(*)`.mapWith(Number) }).from(s)
    .where(and(eq(s.companyId, companyId), inArray(s.contactId, foundIds)))
  const [expenses] = await db.select({ n: sql<number>`COUNT(*)`.mapWith(Number) }).from(e)
    .where(and(eq(e.companyId, companyId), inArray(e.supplierId, foundIds)))
  const unassignedSales = sales?.n ?? 0
  const unassignedExpenses = expenses?.n ?? 0

  await db.transaction(async (tx) => {
    // 1. Copia de los datos en los documentos que no la tenían
    for (const contact of found) {
      const snapshot = contactSnapshot(contact)
      await tx.update(s).set({ customer: snapshot })
        .where(and(eq(s.companyId, companyId), eq(s.contactId, contact.id), isNull(s.customer)))
      await tx.update(e).set({ supplier: snapshot })
        .where(and(eq(e.companyId, companyId), eq(e.supplierId, contact.id), isNull(e.supplier)))
    }

    // 2. Desvincular ventas, gastos e importaciones pendientes
    await tx.update(s).set({ contactId: null }).where(and(eq(s.companyId, companyId), inArray(s.contactId, foundIds)))
    await tx.update(e).set({ supplierId: null }).where(and(eq(e.companyId, companyId), inArray(e.supplierId, foundIds)))
    await tx.update(tables.importItems).set({ contactId: null }).where(inArray(tables.importItems.contactId, foundIds))

    // 3. Plantillas recurrentes
    const recurrings = await tx.select().from(tables.recurrings).where(eq(tables.recurrings.companyId, companyId))
    for (const rec of recurrings) {
      if (rec.template?.contactId != null && gone.has(rec.template.contactId)) {
        await tx.update(tables.recurrings).set({ template: { ...rec.template, contactId: null } }).where(eq(tables.recurrings.id, rec.id))
      }
    }

    // 4. Los contactos
    await tx.delete(c).where(and(eq(c.companyId, companyId), inArray(c.id, foundIds)))
  })

  for (const contact of found) await deleteStoredFile(contact.logoPath)
  return { deleted: found, unassignedSales, unassignedExpenses }
}
