import { z } from 'zod'

const query = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  quarter: z.coerce.number().int().min(1).max(4).optional(),
})

/**
 * «Cerrar el trimestre»: comprobaciones, modelos y envío a la gestoría. Por defecto, el trimestre
 * que toca presentar ahora (el anterior durante su plazo; si no, el que está en curso).
 */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const p = readQueryInput(event, query)
  const now = new Date()
  let year = p.year ?? now.getFullYear()
  let q = (p.quarter ?? quarterOf(now)) as Quarter
  if (!p.year && !p.quarter) {
    // Del 1 al 20 del mes siguiente al trimestre (30 de enero para el 4T) se presenta el anterior
    const prevQ = (q === 1 ? 4 : q - 1) as Quarter
    const prevYear = q === 1 ? year - 1 : year
    const kind = company.kind === 'sociedad' ? 'sociedad' : 'autonomo'
    const due = deadlinesForYear(prevQ === 4 ? prevYear + 1 : prevYear, kind).find(d => d.period === `${prevQ}T ${prevYear}`)?.end
    if (due && toISODate(now) <= due) {
      q = prevQ
      year = prevYear
    }
  }
  return quarterClose(company, year, q)
})
