/**
 * Programador de recurrentes: cada 15 minutos genera las facturas y gastos que tocan (el primero,
 * medio minuto después de arrancar). Cada documento se reserva con un UPDATE condicionado, así que
 * dos procesos a la vez nunca generan el mismo. Desactivable con NUXT_RECURRING_DISABLED=true.
 */
const FIRST_RUN_MS = 30_000
const EVERY_MS = 15 * 60_000 // cada 15 minutos

export default defineNitroPlugin((nitro) => {
  if (import.meta.prerender || process.env.NUXT_RECURRING_DISABLED === 'true') return
  let busy = false

  async function tick() {
    if (busy) return
    busy = true
    try {
      await ensureDbReady()
      const r = await runDueRecurrings()
      if (r.generated || r.failed) console.info(`[recurring] ${r.generated} generados, ${r.failed} con error`)
    }
    catch (err) {
      console.error('[recurring] programador', err)
    }
    finally {
      busy = false
    }
  }

  const first = setTimeout(tick, FIRST_RUN_MS)
  const timer = setInterval(tick, EVERY_MS)
  nitro.hooks.hook('close', () => {
    clearTimeout(first)
    clearInterval(timer)
  })
})
