import { z } from 'zod'

const query = z.object({
  supplierId: z.coerce.number().int().positive().optional(),
  supplier: z.string().trim().max(200).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
})

/** Deducibilidad que se propone para un gasto nuevo (la última vez con ese proveedor o la de la categoría) */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event)
  const p = readQueryInput(event, query)
  const guess = await deductibleGuesser(company.id)
  return guess({ supplierId: p.supplierId, supplierName: p.supplier, categoryId: p.categoryId })
})
