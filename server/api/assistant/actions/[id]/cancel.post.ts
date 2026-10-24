/** Descarta una propuesta del asistente sin cambiar nada */
export default defineEventHandler(async (event) => {
  const { company, user, role } = await requireCompany(event, 'advisor')
  const ctx = { company, actor: { id: user.id, name: user.name, role } }
  return { action: await cancelAction(ctx, idParam(event)) }
})
