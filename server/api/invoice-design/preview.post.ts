/** PDF de muestra con un diseño aún sin guardar (vista previa en vivo de Ajustes) */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const q = getQuery(event)
  const docKind = q.kind === 'quote' ? 'quote' : 'invoice'
  const design = await readInput(event, designInputSchema)
  const buffer = await designPreviewPdf(company, design, docKind)
  setResponseHeaders(event, { 'content-type': 'application/pdf', 'cache-control': 'no-store' })
  return buffer
})
