import { eq } from 'drizzle-orm'

/**
 * Envío automático a la AEAT: cada 2 minutos, las empresas con VeriFactu y envío automático activos
 * remiten sus registros pendientes (respetando la espera que pide la AEAT entre envíos).
 * Se desactiva con NUXT_VERIFACTU_SENDER_DISABLED=true.
 */
export default defineNitroPlugin(() => {
  // Desactivado por ahora (VeriFactu pospuesto como mínimo a 2028)
  const VERIFACTU_ACTIVE = false
  if (!VERIFACTU_ACTIVE || process.env.NUXT_VERIFACTU_SENDER_DISABLED === 'true' || import.meta.prerender) return
  let running = false
  async function tick() {
    if (running) return
    running = true
    try {
      const companies = await useDb().select().from(tables.companies).where(eq(tables.companies.verifactuEnabled, true))
      for (const company of companies) {
        if (!verifactuSettings(company).autoSend) continue
        try {
          const r = await sendPendingRecords(company)
          if (r.sent) console.info(`[verifactu] empresa ${company.id}: ${r.message}`)
        }
        catch (err) {
          const e = err as { statusCode?: number, statusMessage?: string }
          // 429: aún no toca enviar; 409: sin certificado. No es un fallo del programador.
          if (e.statusCode !== 429) console.warn(`[verifactu] empresa ${company.id}:`, e.statusMessage ?? err)
        }
      }
    }
    catch (err) {
      console.error('[verifactu] programador', err)
    }
    finally {
      running = false
    }
  }
  setTimeout(tick, 45_000)
  setInterval(tick, 120_000)
})
