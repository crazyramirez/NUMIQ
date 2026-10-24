import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const { year } = readQueryInput(event, z.object({ year: z.coerce.number().int().min(2000).max(2100).default(new Date().getFullYear()) }))
  const now = new Date()
  const currentQ = year === now.getFullYear() ? quarterOf(now) : year < now.getFullYear() ? 4 : 0

  const deadlines = deadlinesForYear(year + 1, company.kind).concat(deadlinesForYear(year, company.kind))
  const quarters = []
  for (const q of [1, 2, 3, 4] as Quarter[]) {
    const { from, to } = quarterRange(year, q)
    const started = q <= currentQ
    const [m303, m130, w] = started
      ? await Promise.all([estimate303(company.id, year, q), estimate130(company.id, year, q), withholdings(company.id, from, to)])
      : [null, null, null]
    const due = deadlines.find(d => d.period === `${q}T ${year}`)
    quarters.push({
      quarter: q, from, to, started, closed: started && toISODate(now) > to, dueDate: due?.end ?? null,
      models: started
        ? {
            '303': m303,
            ...(company.kind === 'autonomo' && company.taxRegime !== 'modulos' ? { '130': m130 } : {}),
            '111': w!.m111,
            '115': w!.m115,
          }
        : null,
    })
  }

  const filings = await useDb().select().from(tables.taxFilings)
    .where(and(eq(tables.taxFilings.companyId, company.id), eq(tables.taxFilings.year, year)))

  return {
    year,
    kind: company.kind,
    quarters,
    filings,
    annual: await periodSummary(company.id, `${year}-01-01`, `${year}-12-31`),
    // Sociedades: estimación del 200 y pagos fraccionados del 202
    corporate: company.kind === 'sociedad' ? await corporateEstimate(company, year) : null,
    upcoming: upcomingDeadlines(now, company.kind, 6),
  }
})
