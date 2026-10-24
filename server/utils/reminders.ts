import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm'
import { z } from 'zod'

type Company = typeof tables.companies.$inferSelect

/** Recordatorios automáticos de cobro: a cuántos días del vencimiento y con qué mensaje */
export const reminderSettingsSchema = z.object({
  enabled: z.boolean(),
  days: z.array(z.number().int().min(1).max(180)).min(1, 'Elige al menos un aviso').max(4, 'Como mucho 4 avisos por factura')
    .transform(d => [...new Set(d)].sort((a, b) => a - b)),
  message: z.string().trim().max(3000, 'El mensaje es demasiado largo').nullish().transform(v => v || null),
  attachPdf: z.boolean().default(true),
})
export type ReminderSettings = z.infer<typeof reminderSettingsSchema>

export const DEFAULT_REMINDER_DAYS = Object.freeze([3, 15, 30])
/** Días mínimos entre dos recordatorios de la misma factura (también si el anterior fue manual) */
const MIN_GAP_DAYS = 4
const MAX_PER_RUN = 25

export function reminderSettings(company: Pick<Company, 'settings'>): ReminderSettings {
  const r = (company.settings?.reminders ?? {}) as Partial<ReminderSettings>
  return {
    enabled: !!r.enabled,
    days: Array.isArray(r.days) && r.days.length ? r.days : [...DEFAULT_REMINDER_DAYS],
    message: r.message ?? null,
    attachPdf: r.attachPdf ?? true,
  }
}

const DAY = 86_400_000
const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY)
const addDays = (iso: string, n: number) => toISODate(new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY))
const esDate = (iso: string) => iso.split('-').reverse().join('/')

export interface ReminderItem {
  id: number
  number: string | null
  customer: string
  contactId: number | null
  email: string | null
  pending: number
  dueDate: string
  overdueDays: number
  sent: number
  /** Fecha del próximo aviso (null si ya se enviaron todos) */
  nextDate: string | null
  /** Último intento de aviso (enviado o fallido) */
  lastAt: string | null
  ready: boolean
  problem: 'no_email' | null
}

/** Facturas vencidas sin cobrar y en qué punto de la secuencia de avisos está cada una */
export async function reminderQueue(company: Company, today = toISODate(new Date())): Promise<ReminderItem[]> {
  const s = reminderSettings(company)
  const db = useDb()
  const d = tables.salesDocuments
  const docs = await db.select({
    id: d.id, number: d.number, customer: d.customer, contactId: d.contactId, dueDate: d.dueDate, total: d.total, paidTotal: d.paidTotal,
  }).from(d).where(and(
    eq(d.companyId, company.id), eq(d.kind, 'invoice'), inArray(d.status, ['issued', 'sent', 'partial']),
    isNotNull(d.dueDate), lt(d.dueDate, today),
  ))
  if (!docs.length) return []
  const ids = docs.map(x => x.id)
  const contactIds = [...new Set(docs.map(x => x.contactId).filter((x): x is number => !!x))]
  const [contacts, emails] = await Promise.all([
    contactIds.length ? db.select({ id: tables.contacts.id, email: tables.contacts.email }).from(tables.contacts).where(inArray(tables.contacts.id, contactIds)) : [],
    db.select({ docId: tables.sentEmails.salesDocumentId, status: tables.sentEmails.status, createdAt: tables.sentEmails.createdAt }).from(tables.sentEmails)
      .where(and(eq(tables.sentEmails.companyId, company.id), eq(tables.sentEmails.kind, 'reminder'), inArray(tables.sentEmails.salesDocumentId, ids))),
  ])
  const emailOf = new Map(contacts.map(c => [c.id, c.email]))

  const items = docs.map((doc): ReminderItem => {
    const due = doc.dueDate!
    const mine = emails.filter(e => e.docId === doc.id)
    const sent = mine.filter(e => e.status === 'sent').length
    // El último intento (también fallido) marca la espera: un fallo no se reintenta cada pocos minutos
    const last = mine.reduce<Date | null>((m, e) => (!m || e.createdAt > m ? e.createdAt : m), null)
    let nextDate: string | null = null
    if (sent < s.days.length) {
      nextDate = addDays(due, s.days[sent]!)
      if (last) {
        // Mantiene el ritmo del calendario aunque el primer aviso saliera tarde (3 → 15 días: 12 días después)
        const step = sent ? s.days[sent]! - s.days[sent - 1]! : 0
        const gap = addDays(toISODate(last), Math.max(MIN_GAP_DAYS, step))
        if (gap > nextDate) nextDate = gap
      }
    }
    const email = (doc.contactId ? emailOf.get(doc.contactId) : null) || doc.customer?.email || null
    return {
      id: doc.id,
      number: doc.number,
      customer: doc.customer?.name ?? 'Cliente',
      contactId: doc.contactId,
      email,
      pending: round2(doc.total - doc.paidTotal),
      dueDate: due,
      overdueDays: dayDiff(due, today),
      sent,
      nextDate,
      lastAt: last ? toISODate(last) : null,
      ready: !!nextDate && nextDate <= today && !!email,
      problem: email ? null : 'no_email',
    }
  }).filter(i => i.pending > 0)
  return items.sort((a, b) => Number(b.ready) - Number(a.ready) || (a.nextDate ?? '9999').localeCompare(b.nextDate ?? '9999') || b.overdueDays - a.overdueDays)
}

/** Texto del recordatorio: el de la empresa (con {cliente}, {numero}…) o el de NUMIQ */
export function reminderMessage(company: Company, item: ReminderItem, firstName: string | null) {
  const brand = company.tradeName || company.legalName
  const custom = reminderSettings(company).message
  const values: Record<string, string> = {
    cliente: item.customer,
    numero: item.number ?? '',
    importe: eurText(item.pending),
    vencimiento: esDate(item.dueDate),
    dias: String(item.overdueDays),
    empresa: brand,
  }
  if (custom) return custom.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m)
  const n = item.sent
  return [
    `Hola${firstName ? `, ${firstName}` : ''}:`,
    n === 0
      ? `Te escribimos para recordarte que la factura ${values.numero} venció el ${values.vencimiento} y tiene ${values.importe} pendientes de pago.`
      : `Volvemos a escribirte porque la factura ${values.numero} sigue con ${values.importe} pendientes de pago desde el ${values.vencimiento} (hace ${values.dias} días).`,
    'Si ya la has abonado, ignora este mensaje. Te adjuntamos de nuevo la factura por si la necesitas.',
    `Un saludo,\n${brand}`,
  ].join('\n\n')
}

/** ¿Es horario laboral en España? Los avisos automáticos solo salen de lunes a viernes, de 9 a 19 h */
export function businessHours(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(now)
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? 0)
  const weekday = parts.find(p => p.type === 'weekday')?.value ?? ''
  return !['Sat', 'Sun'].includes(weekday) && hour >= 9 && hour < 19
}

/** Envía los recordatorios que tocan hoy (como mucho 25 por pasada) */
export async function sendDueReminders(company: Company, site: string, opts: { userId?: number | null, limit?: number } = {}) {
  const ready = (await reminderQueue(company)).filter(i => i.ready).slice(0, opts.limit ?? MAX_PER_RUN)
  return sendReminders(company, ready, site, opts.userId ?? null)
}

/**
 * «Recordar a todos los vencidos»: a quién se puede escribir ya, sin esperar al calendario de avisos.
 * Se salta las facturas sin email y las que ya recibieron un aviso hace menos de 4 días.
 */
export async function overdueReminderPlan(company: Company, today = toISODate(new Date())) {
  const queue = await reminderQueue(company, today)
  const recentCut = addDays(today, -MIN_GAP_DAYS)
  const noEmail = queue.filter(i => !i.email)
  const recent = queue.filter(i => i.email && i.lastAt && i.lastAt > recentCut)
  const ready = queue.filter(i => i.email && !(i.lastAt && i.lastAt > recentCut)).slice(0, MAX_PER_RUN)
  return {
    ready,
    amount: round2(ready.reduce((sum, i) => sum + i.pending, 0)),
    noEmail: noEmail.length,
    recent: recent.length,
  }
}

/** Envía un recordatorio a cada factura de la lista (con el mensaje de la empresa o el de NUMIQ) */
export async function sendReminders(company: Company, ready: ReminderItem[], site: string, userId: number | null) {
  const s = reminderSettings(company)
  if (!ready.length) return { sent: 0, failed: 0 }
  const db = useDb()
  const contactIds = ready.map(i => i.contactId).filter((x): x is number => !!x)
  const people = contactIds.length
    ? await db.select({ id: tables.contacts.id, name: tables.contacts.name, kind: tables.contacts.kind }).from(tables.contacts).where(inArray(tables.contacts.id, contactIds))
    : []
  let sent = 0
  let failed = 0
  for (const item of ready) {
    const person = people.find(p => p.id === item.contactId)
    const firstName = person?.kind === 'person' ? person.name.split(' ')[0] ?? null : null
    try {
      await sendSalesEmail(company, userId, item.id, {
        to: [item.email!],
        cc: [],
        subject: `Recordatorio de pago · factura ${item.number ?? ''}`.trim(),
        message: reminderMessage(company, item, firstName),
        kind: 'reminder',
        attachPdf: s.attachPdf,
        attachmentIds: [],
      }, site)
      sent++
    }
    catch (err) {
      failed++
      console.warn(`[recordatorios] factura ${item.number}:`, (err as { statusMessage?: string }).statusMessage ?? err)
    }
  }
  return { sent, failed }
}
