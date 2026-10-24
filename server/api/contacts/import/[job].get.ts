/** Cómo va la lectura de un listado y, al terminar, los contactos para revisar */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event)
  const job = contactImportJob(getRouterParam(event, 'job') ?? '', company.id)
  if (!job) throw createError({ statusCode: 404, statusMessage: 'Esta lectura ya no está disponible: vuelve a subir el archivo' })
  return job
})
