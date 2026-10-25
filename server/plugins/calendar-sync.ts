/**
 * Calendarios conectados (Google, iCloud, CalDAV): cada 5 minutos se sincronizan los que llevan
 * más de 10 sin hacerlo (plazos de Hacienda, vencimientos…; los eventos propios ya van al momento).
 * Desactivable con NUXT_CALENDAR_SYNC_DISABLED=true.
 */
const EVERY_MS = 5 * 60_000
const FIRST_RUN_MS = 60_000

export default defineNitroPlugin((nitro) => {
  if (import.meta.prerender || process.env.NUXT_CALENDAR_SYNC_DISABLED === 'true') return
  let busy = false

  async function tick() {
    if (busy) return
    busy = true
    try {
      await ensureDbReady()
      for (const a of await dueAccounts(10)) {
        const r = await syncAccount(a.id)
        if (!r.ok) console.warn('[calendario] sincronización', a.id, r.error)
      }
    }
    catch (err) {
      console.error('[calendario] sincronización', err)
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
