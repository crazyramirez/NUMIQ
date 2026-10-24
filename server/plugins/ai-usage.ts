/**
 * Consumo de IA: al arrancar, reconstruye una vez el gasto anterior al registro (estimado) y completa
 * el cambio euro/dólar de las llamadas que se guardaron sin él. Después, cada 6 horas.
 */
export default defineNitroPlugin(() => {
  if (import.meta.prerender) return
  async function run() {
    try {
      await ensureDbReady()
      await backfillAiUsage()
      await fillMissingRates()
    }
    catch (err) {
      console.error('[ai] consumo', err)
    }
  }
  setTimeout(run, 15_000)
  setInterval(run, 6 * 3600_000)
})
