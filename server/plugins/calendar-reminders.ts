import { and, eq, gte, isNotNull, isNull, lte, ne, or } from 'drizzle-orm'

/**
 * Avisos de los eventos del calendario: al móvil o al ordenador de quien lo creó, a la hora pedida
 * (los de todo el día cuentan desde las 9:00 de Madrid). Cada repetición avisa una sola vez y nunca
 * con más de 2 horas de retraso (si el servidor estuvo parado, no llegan avisos viejos).
 * Desactivable con NUXT_CALENDAR_REMINDERS_DISABLED=true.
 */
const EVERY_MS = 60_000
const FIRST_RUN_MS = 45_000
const LATE_MS = 2 * 60 * 60_000

export default defineNitroPlugin((nitro) => {
  if (import.meta.prerender || process.env.NUXT_CALENDAR_REMINDERS_DISABLED === 'true') return
  let busy = false

  async function tick() {
    if (busy) return
    busy = true
    try {
      await ensureDbReady()
      const db = useDb()
      const e = tables.calendarEvents
      const now = Date.now()
      const today = madridToday()
      // Ventana: repeticiones de ayer a dentro de 31 días (el aviso más largo es de 30 días antes)
      const horizon = shiftDays(today, 31)
      const rows = await db.select().from(e).where(and(
        isNotNull(e.remindMinutes),
        isNotNull(e.createdBy),
        lte(e.startDate, horizon),
        or(ne(e.repeat, 'none'), gte(e.startDate, shiftDays(today, -1))),
        or(isNull(e.repeatUntil), gte(e.repeatUntil, shiftDays(today, -1))),
      ))
      for (const ev of rows) {
        const occurrences = eventOccurrences({ ...ev, endDate: null, repeat: ev.repeat }, shiftDays(today, -1), horizon)
        for (const date of occurrences) {
          if (ev.remindedFor && ev.remindedFor >= date) continue
          if (ev.kind === 'task' && (ev.doneDates ?? []).includes(date)) continue
          const at = zonedToDate(date, ev.startTime ?? '09:00').getTime() - (ev.remindMinutes ?? 0) * 60_000
          if (at > now) break
          // Un aviso cuya hora ya había pasado al guardar el evento no sale
          if (now - at <= LATE_MS && at >= new Date(ev.updatedAt).getTime() - 60_000) {
            await sendPush([ev.createdBy!], {
              title: ev.kind === 'task' ? `Tarea: ${ev.title}` : ev.title,
              body: reminderBody(date, ev.startTime, today, ev.location),
              url: `/calendario?fecha=${date}&evento=${ev.id}`,
              tag: `cal-${ev.id}-${date}`,
            }).catch(err => console.warn('[calendario] aviso', (err as Error).message))
          }
          await db.update(e).set({ remindedFor: date }).where(eq(e.id, ev.id))
        }
      }
    }
    catch (err) {
      console.error('[calendario] avisos', err)
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

function reminderBody(date: string, time: string | null, today: string, location: string | null) {
  const when = date === today ? 'Hoy' : date === shiftDays(today, 1) ? 'Mañana' : new Date(`${date}T12:00:00Z`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
  return [`${when.charAt(0).toUpperCase()}${when.slice(1)}${time ? ` a las ${time}` : ''}`, location].filter(Boolean).join(' · ')
}
