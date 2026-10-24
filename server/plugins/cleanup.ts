import { and, eq, isNull, lt } from 'drizzle-orm'

/**
 * Limpieza periódica: escaneos que nunca llegaron a guardarse (se cerró el formulario) y ZIP de
 * envíos al gestor caducados. Cada hora; la primera pasada, a los 2 minutos del arranque.
 */
export default defineNitroPlugin(() => {
  if (import.meta.prerender) return
  async function sweep() {
    try {
      const db = useDb()
      const f = tables.files
      const orphans = await db.select({ id: f.id, path: f.path, companyId: f.companyId }).from(f)
        .where(and(eq(f.kind, 'scan'), isNull(f.linkedId), lt(f.createdAt, new Date(Date.now() - 48 * 3600_000))))
        .limit(500)
      for (const o of orphans) {
        await db.delete(f).where(eq(f.id, o.id))
        await deleteStoredFile(o.path)
      }
      const companies = [...new Set((await db.select({ id: tables.advisorPacks.companyId }).from(tables.advisorPacks)).map(r => r.id))]
      for (const id of companies) await purgeOldPacks(id)
      if (orphans.length) console.info(`[limpieza] ${orphans.length} escaneos sin guardar eliminados`)
    }
    catch (err) {
      console.error('[limpieza]', err)
    }
  }
  setTimeout(sweep, 120_000)
  setInterval(sweep, 3600_000)
})
