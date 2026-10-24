/**
 * Recordatorios automáticos de cobro: cada 20 minutos, en horario laboral, las empresas que los tienen
 * activos escriben a los clientes con facturas vencidas según su calendario de avisos.
 * Se desactiva con NUXT_REMINDERS_DISABLED=true.
 */
export default defineNitroPlugin(() => {
  if (process.env.NUXT_REMINDERS_DISABLED === 'true' || import.meta.prerender) return
  let running = false
  async function tick() {
    if (running || !businessHours() || !mailEnabled()) return
    running = true
    try {
      const site = useRuntimeConfig().siteUrl || ''
      const companies = await useDb().select().from(tables.companies)
      for (const company of companies) {
        if (!reminderSettings(company).enabled) continue
        try {
          const r = await sendDueReminders(company, site)
          if (r.sent || r.failed) console.info(`[recordatorios] empresa ${company.id}: ${r.sent} enviados, ${r.failed} fallidos`)
        }
        catch (err) {
          console.warn(`[recordatorios] empresa ${company.id}:`, err)
        }
      }
    }
    catch (err) {
      console.error('[recordatorios] programador', err)
    }
    finally {
      running = false
    }
  }
  setTimeout(tick, 90_000)
  setInterval(tick, 20 * 60_000)
})
