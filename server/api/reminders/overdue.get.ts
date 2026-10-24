/** Vista previa de «Recordar a todos los vencidos»: cuántos saldrían y cuántos se quedan fuera (sin enviar nada) */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const plan = await overdueReminderPlan(company)
  return {
    count: plan.ready.length,
    amount: plan.amount,
    noEmail: plan.noEmail,
    recent: plan.recent,
    mail: mailEnabled(),
  }
})
