/** Ejecuta una propuesta del asistente: solo quien la pidió, en su empresa y mientras siga vigente */
export default defineEventHandler(async (event) => {
  const { company, user, role } = await requireCompany(event)
  const ctx = { company, actor: { id: user.id, name: user.name, role }, ip: getRequestIP(event, { xForwardedFor: true }) ?? null }
  return { action: await confirmAction(ctx, idParam(event)) }
})
