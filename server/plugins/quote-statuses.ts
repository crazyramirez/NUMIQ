/**
 * Presupuestos con los estados de ahora (pendiente, enviado, aceptado, rechazado): al arrancar, los
 * borradores que queden se emiten y los caducados pasan a rechazados. Sin nada que cambiar, no hace nada.
 */
export default defineNitroPlugin(() => {
  if (import.meta.prerender) return
  setTimeout(async () => {
    try {
      await ensureDbReady()
      await normalizeQuoteStatuses()
    }
    catch (err) {
      console.error('[presupuestos] estados', err)
    }
  }, 20_000)
})
