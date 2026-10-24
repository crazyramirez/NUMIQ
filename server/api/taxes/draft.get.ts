import { z } from 'zod'

const query = z.object({
  model: z.enum(['303', '130', '111', '115', '390', '190', '180', '347', '200', '202']),
  year: z.coerce.number().int().min(2000).max(2100),
  /** Trimestrales: el trimestre. 202: el número de pago (1 abril, 2 octubre, 3 diciembre) */
  quarter: z.coerce.number().int().min(1).max(4).optional(),
})

const ANNUAL = new Set(['390', '190', '180', '347'])

/** Borrador de un modelo (trimestral o anual) con sus casillas para presentarlo en la Sede de la AEAT */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const q = readQueryInput(event, query)
  if (ANNUAL.has(q.model)) return annualDraft(company, q.model as AnnualModel, q.year)
  if (q.model === '200') return corporateDraft(company, '200', q.year)
  if (q.model === '202') {
    if (!q.quarter || q.quarter > 3) throw createError({ statusCode: 400, statusMessage: 'Indica el pago fraccionado (1, 2 o 3)' })
    return corporateDraft(company, '202', q.year, q.quarter as 1 | 2 | 3)
  }
  if (!q.quarter) throw createError({ statusCode: 400, statusMessage: 'Indica el trimestre' })
  if (q.model === '130' && (company.kind !== 'autonomo' || company.taxRegime === 'modulos')) {
    throw createError({ statusCode: 400, statusMessage: 'El modelo 130 es para autónomos en estimación directa' })
  }
  return modelDraft(company, q.model as TaxModel, q.year, q.quarter as Quarter)
})
