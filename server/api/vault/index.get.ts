import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

const query = z.object({
  year: z.coerce.number().int().min(1990).max(2100),
  quarter: z.coerce.number().int().min(1).max(4).optional(),
})

/** Documentos del archivo de un año o trimestre, con recuentos por carpeta y por trimestre */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'advisor')
  const { year, quarter } = readQueryInput(event, query)
  const f = tables.files
  const db = useDb()
  const base = and(eq(f.companyId, company.id), eq(f.kind, 'vault'), eq(f.year, year))
  const [files, byQuarter] = await Promise.all([
    // mine: lo subió quien pregunta (el gestor solo cambia o borra lo suyo)
    db.select({ id: f.id, name: f.originalName, mime: f.mime, size: f.size, folder: f.folder, year: f.year, quarter: f.quarter, notes: f.notes, createdAt: f.createdAt, mine: sql<boolean>`${f.uploadedBy} <=> ${user.id}`.mapWith(v => Number(v) === 1) })
      .from(f).where(quarter ? and(base, eq(f.quarter, quarter)) : base).orderBy(desc(f.createdAt)),
    db.select({ quarter: f.quarter, n: sql<number>`count(*)`, bytes: sql<number>`coalesce(sum(${f.size}), 0)` }).from(f).where(base).groupBy(f.quarter),
  ])
  const folders: Record<string, { count: number, bytes: number }> = {}
  for (const file of files) {
    const k = file.folder ?? 'otros'
    folders[k] ??= { count: 0, bytes: 0 }
    folders[k].count++
    folders[k].bytes += file.size
  }
  return {
    files,
    folders,
    quarters: Object.fromEntries(byQuarter.map(q => [q.quarter, { count: Number(q.n), bytes: Number(q.bytes) }])),
  }
})
