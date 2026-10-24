import { and, count, eq, inArray, isNotNull, isNull, max } from 'drizzle-orm'

/** Series con el próximo número que se asignará (vista previa en el editor y configuración) */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const db = useDb()
  const rows = await db.select().from(tables.series)
    .where(and(eq(tables.series.companyId, company.id), isNull(tables.series.archivedAt)))
    .orderBy(tables.series.kind, tables.series.name)

  const year = new Date().getFullYear()
  const counters = rows.length
    ? await db.select().from(tables.seriesCounters).where(inArray(tables.seriesCounters.seriesId, rows.map(s => s.id)))
    : []
  const last = new Map(counters.map(c => [`${c.seriesId}|${c.year}`, c.lastNumber]))

  const issuedRows = rows.length
    ? await db.select({
      seriesId: tables.salesDocuments.seriesId,
      maxSequence: max(tables.salesDocuments.sequence),
      count: count(tables.salesDocuments.id),
    })
      .from(tables.salesDocuments)
      .where(and(
        eq(tables.salesDocuments.companyId, company.id),
        inArray(tables.salesDocuments.seriesId, rows.map(s => s.id)),
        isNotNull(tables.salesDocuments.number),
      ))
      .groupBy(tables.salesDocuments.seriesId)
    : []
  const issuedMap = new Map(issuedRows.map(r => [r.seriesId!, { maxSequence: r.maxSequence ?? 0, count: r.count }]))

  return rows.map(s => {
    const lastSeq = last.get(`${s.id}|${s.yearlyReset ? year : 0}`) ?? 0
    const nextSeq = lastSeq + 1
    const issued = issuedMap.get(s.id)
    return {
      ...s,
      nextSequence: nextSeq,
      nextNumber: formatNumber(s, year, nextSeq),
      maxIssuedSequence: issued?.maxSequence ?? 0,
      issuedCount: issued?.count ?? 0,
    }
  })
})
