import { z } from 'zod'

/**
 * Facturas que podrían salir de este presupuesto (o presupuestos de los que podría salir esta factura).
 * `ai=1` pide además la revisión de la IA; `q` busca por número, cliente o concepto; `auto=1` devuelve solo
 * una sugerencia muy probable, sin IA, para avisar al abrir el documento.
 */
const query = z.object({
  q: z.string().max(80).optional(),
  ai: z.stringbool().optional(),
  auto: z.stringbool().optional(),
})

export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event)
  const id = idParam(event)
  const input = readQueryInput(event, query)
  if (input.auto) {
    const { candidates } = await linkCandidates(company.id, id, { limit: 3 })
    const best = candidates.find(c => !c.linked && !c.linkedTo && c.score >= 75)
    return { candidates: best && !candidates.some(c => c.linked) ? [best] : [], reviewed: false, aiError: null }
  }
  return linkCandidates(company.id, id, { q: input.q, ai: input.ai && !input.q })
})
