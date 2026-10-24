/** Empieza a leer con IA los archivos subidos (en segundo plano) */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event)
  const id = idParam(event)
  const batch = await getBatch(company.id, id)
  if (!batch.totalFiles) throw createError({ statusCode: 400, statusMessage: 'No hay archivos que importar' })
  void startBatch(company.id, id)
  return { ok: true }
})
