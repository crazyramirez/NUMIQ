/** Ajustes de los recordatorios de cobro y facturas vencidas en la cola de avisos */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const queue = await reminderQueue(company)
  return {
    settings: reminderSettings(company),
    queue: queue.slice(0, 60),
    total: queue.length,
    mail: mailEnabled(),
    businessHours: businessHours(),
  }
})
