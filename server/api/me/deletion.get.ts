/** Qué pasaría al eliminar la cuenta: empresas que se borran (con lo que tienen) y de las que solo sale */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return accountDeletionPlan(user.id)
})
