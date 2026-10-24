/** Qué se borraría al eliminar la importación con todo lo que creó (para confirmarlo) */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event)
  return previewUndo(company.id, idParam(event))
})
