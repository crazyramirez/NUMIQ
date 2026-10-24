/** Deshace una operación ya ejecutada: los registros vuelven a como estaban */
export default defineEventHandler(async (event) => {
  const { company, user, role } = await requireCompany(event)
  const ctx = { company, actor: { id: user.id, name: user.name, role }, ip: getRequestIP(event, { xForwardedFor: true }) ?? null }
  return { action: await undoAction(ctx, idParam(event)) }
})
