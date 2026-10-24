import { and, eq, inArray } from 'drizzle-orm'

/**
 * Aviso de plazos de impuestos: a 5 días y el último día, si queda algún modelo sin presentar.
 * Cada hora en horario laboral; cada aviso sale una sola vez por empresa (se apunta en sus ajustes).
 * Desactivable con NUXT_PUSH_DEADLINES_DISABLED=true.
 */
const EVERY_MS = 60 * 60_000
const FIRST_RUN_MS = 90_000

export default defineNitroPlugin((nitro) => {
  if (import.meta.prerender || process.env.NUXT_PUSH_DEADLINES_DISABLED === 'true') return
  let busy = false

  async function tick() {
    if (busy || !businessHours()) return
    busy = true
    try {
      await ensureDbReady()
      const db = useDb()
      // Solo empresas con alguien que tenga los avisos activados
      const subscribed = await db.selectDistinct({ companyId: tables.companyMembers.companyId }).from(tables.companyMembers)
        .innerJoin(tables.pushSubscriptions, eq(tables.pushSubscriptions.userId, tables.companyMembers.userId))
        .where(inArray(tables.companyMembers.role, ['owner', 'admin']))
      if (!subscribed.length) return
      const companies = await db.select().from(tables.companies).where(inArray(tables.companies.id, subscribed.map(s => s.companyId)))
      const now = new Date()
      const today = toISODate(now)
      for (const company of companies) {
        const kind = company.kind === 'sociedad' ? 'sociedad' : 'autonomo'
        const settings = (company.settings ?? {}) as { pushSent?: Record<string, string> }
        const sent = { ...(settings.pushSent ?? {}) }
        let changed = false
        for (const d of upcomingDeadlines(now, kind, 3)) {
          const days = Math.round((Date.parse(`${d.end}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000)
          if (days < 0 || days > 5 || d.start > today) continue
          const step = days <= 1 ? 'last' : 'soon'
          const key = `deadline:${d.period}:${d.title}:${step}`
          if (sent[key]) continue
          // ¿Queda algo por presentar de ese plazo?
          const m = /^([1-4])T (\d{4})$/.exec(d.period)
          const period = m ? `${m[1]}T` : d.period.length === 4 ? '0A' : d.period.slice(0, 2)
          const year = m ? Number(m[2]) : Number(d.period.slice(-4))
          const filed = await db.select({ model: tables.taxFilings.model }).from(tables.taxFilings)
            .where(and(eq(tables.taxFilings.companyId, company.id), eq(tables.taxFilings.year, year), eq(tables.taxFilings.period, period), inArray(tables.taxFilings.status, ['filed', 'paid'])))
          const pending = d.models.filter(x => !filed.some(f => f.model === x))
          if (!pending.length) continue
          await notifyCompany(company.id, {
            title: days <= 0 ? `Hoy acaba el plazo: ${d.title}` : days === 1 ? `Mañana acaba el plazo: ${d.title}` : `Quedan ${days} días: ${d.title}`,
            body: `Modelos ${pending.join(', ')} · ${d.period}. Ciérralo paso a paso en NUMIQ.`,
            url: m ? `/impuestos/cerrar?anio=${year}&t=${m[1]}` : '/impuestos',
            tag: `deadline-${d.period}`,
          })
          sent[key] = new Date().toISOString()
          changed = true
        }
        if (changed) await db.update(tables.companies).set({ settings: { ...settings, pushSent: sent } }).where(eq(tables.companies.id, company.id))
      }
    }
    catch (err) {
      console.error('[push] plazos', err)
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
