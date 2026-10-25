import { randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, notInArray, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { CalendarItem, CalendarLayer, EventRepeat } from '../../shared/utils/calendar'

/**
 * Calendario de una empresa: todo lo que tiene fecha (facturas, gastos, plazos de Hacienda,
 * recurrentes, festivos y eventos propios) en un rango. Lo usan la pantalla y la suscripción .ics.
 */

type Company = typeof tables.companies.$inferSelect
type CalendarEvent = typeof tables.calendarEvents.$inferSelect

export const MAX_RANGE_DAYS = 430

const ALL_LAYERS: CalendarLayer[] = ['income', 'expense', 'tax', 'quote', 'recurring', 'event', 'holiday', 'feed']

export const calendarRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inicial no válida'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha final no válida'),
}).refine(r => r.from <= r.to && daysBetween(r.from, r.to) <= MAX_RANGE_DAYS, 'El rango del calendario no es válido')

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora no válida (HH:MM)')
const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha no válida')

export const calendarEventSchema = z.object({
  kind: z.enum(['event', 'task']).default('event'),
  title: z.string().trim().min(1, 'Ponle un título').max(200, 'El título es demasiado largo'),
  notes: z.string().trim().max(5000).nullish().transform(v => v || null),
  location: z.string().trim().max(200).nullish().transform(v => v || null),
  startDate: ISO,
  endDate: ISO.nullish().transform(v => v ?? null),
  startTime: HHMM.nullish().transform(v => v ?? null),
  endTime: HHMM.nullish().transform(v => v ?? null),
  color: z.string().refine(isCalendarColor, 'Color no válido').default('green'),
  repeat: z.enum(['none', 'weekly', 'monthly', 'quarterly', 'yearly']).default('none'),
  repeatInterval: z.number().int().min(1).max(52).default(1),
  repeatUntil: ISO.nullish().transform(v => v ?? null),
  remindMinutes: z.number().int().min(0).max(60 * 24 * 30).nullish().transform(v => v ?? null),
  contactId: z.number().int().positive().nullish().transform(v => v ?? null),
}).superRefine((v, ctx) => {
  if (v.endDate && v.endDate < v.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'La fecha final es anterior a la de inicio' })
  if (v.endDate && daysBetween(v.startDate, v.endDate) > 366) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Un evento no puede durar más de un año' })
  if (v.endTime && !v.startTime) ctx.addIssue({ code: 'custom', path: ['startTime'], message: 'Indica la hora de inicio' })
  if (v.startTime && v.endTime && (!v.endDate || v.endDate === v.startDate) && v.endTime < v.startTime) ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'La hora final es anterior a la de inicio' })
  if (v.repeatUntil && v.repeatUntil < v.startDate) ctx.addIssue({ code: 'custom', path: ['repeatUntil'], message: 'La repetición acaba antes de empezar' })
})

export type CalendarEventInput = z.infer<typeof calendarEventSchema>

/** Fila de evento propio → datos para el formulario */
export function eventDto(e: CalendarEvent) {
  return {
    id: e.id,
    kind: e.kind,
    title: e.title,
    notes: e.notes,
    location: e.location,
    startDate: e.startDate,
    endDate: e.endDate,
    startTime: e.startTime,
    endTime: e.endTime,
    color: e.color,
    repeat: e.repeat,
    repeatInterval: e.repeatInterval,
    repeatUntil: e.repeatUntil,
    remindMinutes: e.remindMinutes,
    contactId: e.contactId,
    doneDates: e.doneDates ?? [],
  }
}

const name = (snap: { name?: string | null } | null | undefined, fallback: string | null | undefined, empty: string) => snap?.name || fallback || empty

/** Periodo de un plazo (3T 2026, 2025, 1P 2026) → clave de tax_filings */
export function filingKey(period: string) {
  const m = /^([1-4])T (\d{4})$/.exec(period)
  return {
    quarter: m ? Number(m[1]) : null,
    period: m ? `${m[1]}T` : period.length === 4 ? '0A' : period.slice(0, 2),
    year: m ? Number(m[2]) : Number(period.slice(-4)),
  }
}

export interface CalendarOptions {
  layers?: CalendarLayer[]
  /** Calendarios externos de este usuario */
  userId?: number | null
}

export async function calendarItems(company: Company, from: string, to: string, opts: CalendarOptions = {}): Promise<CalendarItem[]> {
  const layers = new Set(opts.layers ?? ALL_LAYERS)
  const today = madridToday()
  const db = useDb()
  const out: CalendarItem[] = []
  // Cobros y pagos con el documento al que pertenecen: si es del mismo día que el documento, sobran
  const paid: Array<{ item: CalendarItem, doc: string }> = []
  const tasks: Array<Promise<void>> = []

  // ─── Ingresos: emisión, vencimiento de lo pendiente y cobros ───
  if (layers.has('income') || layers.has('quote')) {
    tasks.push((async () => {
      const s = tables.salesDocuments
      const kinds = [...(layers.has('income') ? ['invoice', 'rectifying'] as const : []), ...(layers.has('quote') ? ['quote', 'proforma'] as const : [])]
      const rows = await db.select({
        id: s.id, kind: s.kind, status: s.status, number: s.number, issueDate: s.issueDate, dueDate: s.dueDate,
        total: s.total, taxBase: s.taxBase, paidTotal: s.paidTotal, customer: s.customer, contactName: tables.contacts.name,
      }).from(s).leftJoin(tables.contacts, eq(tables.contacts.id, s.contactId))
        .where(and(
          eq(s.companyId, company.id),
          inArray(s.kind, kinds),
          notInArray(s.status, ['draft', 'cancelled']),
          or(and(gte(s.issueDate, from), lte(s.issueDate, to)), and(isNotNull(s.dueDate), gte(s.dueDate, from), lte(s.dueDate, to))),
        ))
      for (const r of rows) {
        const who = name(r.customer, r.contactName, 'Sin cliente')
        if (r.kind === 'quote' || r.kind === 'proforma') {
          const label = r.kind === 'proforma' ? 'Proforma' : 'Presupuesto'
          const to_ = `/presupuestos/${r.id}`
          const open = ['issued', 'sent'].includes(r.status)
          if (r.issueDate >= from && r.issueDate <= to) {
            out.push({ id: `quo-${r.id}-issue`, layer: 'quote', type: 'issue', title: `${label} ${r.number ?? ''}`.trim(), subtitle: `${who} · base imponible`, date: r.issueDate, amount: r.taxBase, flow: null, status: r.status === 'accepted' || r.status === 'invoiced' ? 'done' : null, color: 'sky', icon: 'ph:file-text', to: to_ })
          }
          if (open && r.dueDate && r.dueDate >= from && r.dueDate <= to) {
            out.push({ id: `quo-${r.id}-due`, layer: 'quote', type: 'due', title: `Caduca ${label.toLowerCase()} ${r.number ?? ''}`.trim(), subtitle: `${who} · base imponible`, date: r.dueDate, amount: r.taxBase, flow: null, status: r.dueDate < today ? 'overdue' : 'pending', color: 'sky', icon: 'ph:hourglass-medium', to: to_ })
          }
          continue
        }
        const to_ = `/facturas/${r.id}`
        const pending = round2(r.total - r.paidTotal)
        const unpaid = ['issued', 'sent', 'partial'].includes(r.status) && pending > 0.004
        const sameDayDue = unpaid && r.dueDate === r.issueDate
        if (r.issueDate >= from && r.issueDate <= to && !sameDayDue) {
          out.push({ id: `inv-${r.id}-issue`, layer: 'income', type: 'issue', title: `Factura ${r.number ?? ''}`.trim(), subtitle: who, date: r.issueDate, amount: r.total, flow: 'in', status: r.status === 'paid' ? 'done' : null, color: 'brand', icon: 'ph:receipt', to: to_ })
        }
        if (unpaid && r.dueDate && r.dueDate >= from && r.dueDate <= to) {
          out.push({ id: `inv-${r.id}-due`, layer: 'income', type: 'due', title: `Vence cobro · ${who}`, subtitle: `Factura ${r.number ?? ''}${r.status === 'partial' ? ' · cobro parcial' : ''}`, date: r.dueDate, amount: pending, flow: 'in', status: r.dueDate < today ? 'overdue' : r.dueDate === today ? 'today' : 'pending', color: 'brand', icon: 'ph:hand-coins', to: to_ })
        }
      }
    })())
  }

  // ─── Gastos: fecha de la factura, vencimiento de lo pendiente ───
  if (layers.has('expense')) {
    tasks.push((async () => {
      const e = tables.expenses
      const rows = await db.select({
        id: e.id, status: e.status, number: e.number, issueDate: e.issueDate, dueDate: e.dueDate, description: e.description,
        total: e.total, paidTotal: e.paidTotal, supplier: e.supplier, supplierName: tables.contacts.name,
      }).from(e).leftJoin(tables.contacts, eq(tables.contacts.id, e.supplierId))
        .where(and(
          eq(e.companyId, company.id),
          approvedExpense(),
          or(and(gte(e.issueDate, from), lte(e.issueDate, to)), and(isNotNull(e.dueDate), gte(e.dueDate, from), lte(e.dueDate, to))),
        ))
      for (const r of rows) {
        const who = name(r.supplier, r.supplierName, r.description || 'Gasto')
        const to_ = `/gastos?ver=${r.id}`
        const pending = round2(r.total - r.paidTotal)
        const due = r.status !== 'paid' && pending > 0.004 && !!r.dueDate
        if (r.issueDate >= from && r.issueDate <= to && !(due && r.dueDate === r.issueDate)) {
          out.push({ id: `exp-${r.id}-issue`, layer: 'expense', type: 'issue', title: who, subtitle: [r.number ? `Nº ${r.number}` : null, r.description !== who ? r.description : null].filter(Boolean).join(' · ') || null, date: r.issueDate, amount: r.total, flow: 'out', status: r.status === 'paid' ? 'done' : null, color: 'amber', icon: 'ph:wallet', to: to_ })
        }
        if (due && r.dueDate! >= from && r.dueDate! <= to) {
          out.push({ id: `exp-${r.id}-due`, layer: 'expense', type: 'due', title: `Vence pago · ${who}`, subtitle: r.number ? `Factura ${r.number}` : r.description !== who ? r.description : null, date: r.dueDate!, amount: pending, flow: 'out', status: r.dueDate! < today ? 'overdue' : r.dueDate === today ? 'today' : 'pending', color: 'amber', icon: 'ph:credit-card', to: to_ })
        }
      }
    })())
  }

  // ─── Cobros y pagos registrados ───
  if (layers.has('income') || layers.has('expense')) {
    tasks.push((async () => {
      const p = tables.payments
      const dirs = [...(layers.has('income') ? ['in'] as const : []), ...(layers.has('expense') ? ['out'] as const : [])]
      const rows = await db.select({
        id: p.id, direction: p.direction, amount: p.amount, date: p.date, salesId: p.salesDocumentId, expenseId: p.expenseId,
        number: tables.salesDocuments.number, customer: tables.salesDocuments.customer, supplier: tables.expenses.supplier, description: tables.expenses.description,
      }).from(p)
        .leftJoin(tables.salesDocuments, eq(tables.salesDocuments.id, p.salesDocumentId))
        .leftJoin(tables.expenses, eq(tables.expenses.id, p.expenseId))
        .where(and(eq(p.companyId, company.id), inArray(p.direction, dirs), gte(p.date, from), lte(p.date, to), or(isNull(p.expenseId), approvedExpense())))
      for (const r of rows) {
        if (r.direction === 'in') {
          paid.push({ doc: `inv-${r.salesId}-issue|${r.date}`, item: { id: `pay-${r.id}`, layer: 'income', type: 'paid', title: `Cobrado · ${r.customer?.name ?? 'cliente'}`, subtitle: r.number ? `Factura ${r.number}` : null, date: r.date, amount: r.amount, flow: 'in', status: 'done', color: 'green', icon: 'ph:check-circle', to: r.salesId ? `/facturas/${r.salesId}` : null } })
        }
        else {
          paid.push({ doc: `exp-${r.expenseId}-issue|${r.date}`, item: { id: `pay-${r.id}`, layer: 'expense', type: 'paid', title: `Pagado · ${r.supplier?.name ?? r.description ?? 'gasto'}`, subtitle: null, date: r.date, amount: r.amount, flow: 'out', status: 'done', color: 'slate', icon: 'ph:check-circle', to: r.expenseId ? `/gastos?ver=${r.expenseId}` : null } })
        }
      }
    })())
  }

  // ─── Hacienda: plazo de presentación y último día ───
  if (layers.has('tax')) {
    tasks.push((async () => {
      const kind = company.kind === 'sociedad' ? 'sociedad' : 'autonomo'
      const years = new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4)), Number(to.slice(0, 4)) + 1])
      const list = [...years].flatMap(y => deadlinesForYear(y, kind)).filter(d => d.end >= from && d.start <= to)
      if (!list.length) return
      const filings = await db.select({ model: tables.taxFilings.model, year: tables.taxFilings.year, period: tables.taxFilings.period, status: tables.taxFilings.status, result: tables.taxFilings.result })
        .from(tables.taxFilings).where(eq(tables.taxFilings.companyId, company.id))
      for (const d of list) {
        const k = filingKey(d.period)
        const done = d.models.filter(m => filings.some(f => f.model === m && f.year === k.year && f.period === k.period && (f.status === 'filed' || f.status === 'paid')))
        const pending = d.models.filter(m => !done.includes(m))
        const result = round2(filings.filter(f => d.models.includes(f.model) && f.year === k.year && f.period === k.period).reduce((s, f) => s + Math.max(0, f.result), 0))
        const status = !pending.length ? 'done' : d.end < today ? 'overdue' : d.end === today ? 'today' : 'pending'
        const to_ = k.quarter ? `/impuestos/cerrar?anio=${k.year}&t=${k.quarter}` : '/impuestos'
        const models = d.models.map(m => (MODEL_NAMES[m] ? `${m} ${MODEL_NAMES[m]}` : m))
        const notes = [
          `Plazo: del ${fdateEs(d.start)} al ${fdateEs(d.end)}.`,
          `Modelos: ${models.join(' · ')}.`,
          done.length ? `Presentados: ${done.join(', ')}.` : '',
          pending.length && done.length ? `Por presentar: ${pending.join(', ')}.` : '',
        ].filter(Boolean).join('\n')
        if (d.end >= from && d.end <= to) {
          out.push({ id: `tax-${d.period}-${d.models.join('')}`, layer: 'tax', type: 'deadline', title: `Fin de plazo · ${d.title}`, subtitle: `Modelos ${d.models.join(', ')} · ${d.period}`, date: d.end, amount: result || null, flow: result ? 'out' : null, status, color: 'red', icon: 'ph:bank', to: to_, notes })
        }
        out.push({ id: `taxw-${d.period}-${d.models.join('')}`, layer: 'tax', type: 'window', title: `Plazo ${d.title}`, subtitle: `Modelos ${d.models.join(', ')} · ${d.period}`, date: d.start, endDate: d.end, status, color: 'red', icon: 'ph:calendar-dots', to: to_, notes })
      }
    })())
  }

  // ─── Recurrentes: lo que se generará solo ───
  if (layers.has('recurring')) {
    tasks.push((async () => {
      const r = tables.recurrings
      const rows = await db.select().from(r).where(and(eq(r.companyId, company.id), eq(r.active, true), lte(r.nextDate, to)))
      const start = from > today ? from : today
      for (const rec of rows) {
        const t = templateOf(rec)
        const end = rec.endDate && rec.endDate < to ? rec.endDate : to
        const dates = upcomingOccurrences(rec.startDate ?? rec.nextDate, rec.frequency, rec.interval, rec.nextDate, 400, end).filter(d => d >= start)
        const isInvoice = rec.kind === 'invoice'
        for (const date of dates) {
          out.push({
            id: `rec-${rec.id}-${date}`, layer: 'recurring', type: 'run', title: rec.name,
            subtitle: `${isInvoice ? 'Factura recurrente' : 'Gasto fijo'} · ${frequencyLabel(rec.frequency, rec.interval).toLowerCase()}`,
            date, amount: t.total ?? null, flow: isInvoice ? 'in' : 'out', status: 'pending', color: 'violet', icon: 'ph:arrows-clockwise',
            to: `${isInvoice ? '/recurrentes' : '/gastos/fijos'}?ver=${rec.id}`,
          })
        }
      }
    })())
  }

  // ─── Eventos propios ───
  if (layers.has('event')) {
    tasks.push((async () => {
      const e = tables.calendarEvents
      const rows = await db.select({ ev: e, contactName: tables.contacts.name, isClient: tables.contacts.isClient }).from(e).leftJoin(tables.contacts, eq(tables.contacts.id, e.contactId)).where(and(
        eq(e.companyId, company.id),
        lte(e.startDate, to),
        or(ne(e.repeat, 'none'), gte(sql`COALESCE(${e.endDate}, ${e.startDate})`, from)),
        or(isNull(e.repeatUntil), gte(e.repeatUntil, from)),
      ))
      for (const { ev, contactName, isClient } of rows) out.push(...expandEvent(ev, from, to, today, contactName, isClient))
    })())
  }

  // ─── Festivos nacionales ───
  if (layers.has('holiday')) {
    for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
      for (const h of nationalHolidays(y)) {
        if (h.date >= from && h.date <= to) out.push({ id: `hol-${h.date}`, layer: 'holiday', type: 'holiday', title: h.name, subtitle: 'Festivo nacional', date: h.date, color: 'pink', icon: 'ph:confetti' })
      }
    }
  }

  // ─── Calendarios externos (Google, Apple, Outlook) de quien mira ───
  if (layers.has('feed') && opts.userId) {
    tasks.push((async () => {
      for (const it of await feedItems(company.id, opts.userId!, from, to)) out.push(it)
    })())
  }

  await Promise.all(tasks)
  const docs = new Set(out.map(i => `${i.id}|${i.date}`))
  for (const p of paid) if (!docs.has(p.doc)) out.push(p.item)
  return out.sort(compareItems)
}

/** Orden dentro de un día: lo de todo el día y lo que dura varios días primero, luego por hora */
export function compareItems(a: CalendarItem, b: CalendarItem) {
  return a.date.localeCompare(b.date)
    || Number(!!b.endDate && b.endDate > b.date) - Number(!!a.endDate && a.endDate > a.date)
    || (a.time ?? '').localeCompare(b.time ?? '')
    || LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer)
    || a.title.localeCompare(b.title)
}
const LAYER_ORDER: CalendarLayer[] = ['holiday', 'tax', 'event', 'feed', 'income', 'expense', 'quote', 'recurring']

export function expandEvent(ev: CalendarEvent, from: string, to: string, today: string, contactName?: string | null, isClient?: boolean | null): CalendarItem[] {
  const span = ev.endDate && ev.endDate > ev.startDate ? daysBetween(ev.startDate, ev.endDate) : 0
  const done = new Set(ev.doneDates ?? [])
  return eventOccurrences({ ...ev, repeat: ev.repeat as EventRepeat }, from, to).map((date) => {
    const isDone = ev.kind === 'task' && done.has(date)
    return {
      id: `ev-${ev.id}-${date}`,
      layer: 'event' as const,
      type: ev.kind,
      title: ev.title,
      subtitle: [contactName, ev.location].filter(Boolean).join(' · ') || null,
      date,
      endDate: span ? shiftDays(date, span) : null,
      time: ev.startTime,
      endTime: ev.endTime,
      status: isDone ? 'done' as const : ev.kind === 'task' && date < today ? 'overdue' as const : null,
      color: isCalendarColor(ev.color) ? ev.color : 'green',
      icon: ev.kind === 'task' ? (isDone ? 'ph:check-square-fill' : 'ph:square') : 'ph:calendar-check',
      location: ev.location,
      notes: ev.notes,
      eventId: ev.id,
      occurrence: date,
      done: isDone,
      repeat: ev.repeat === 'none' ? null : ev.repeat,
      to: ev.contactId && contactName ? `${isClient === false ? '/proveedores' : '/clientes'}/${ev.contactId}` : null,
    }
  })
}

const fdateEs = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', timeZone: 'UTC' })

// ─── Hora de Madrid (el servidor puede estar en UTC) ───

const MADRID = 'Europe/Madrid'

/** Fecha y hora de pared en una zona horaria: { date: 'YYYY-MM-DD', time: 'HH:MM' } */
export function wallClock(at: Date, timeZone = MADRID) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(at).map(p => [p.type, p.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, seconds: Number(parts.second) }
}

export const madridToday = () => wallClock(new Date()).date

/** Instante (UTC) de una hora de pared en una zona: 2026-10-25 10:00 en Madrid → Date */
export function zonedToDate(date: string, time: string, timeZone = MADRID) {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm, ss] = time.split(':').map(Number)
  const guess = Date.UTC(y!, m! - 1, d!, hh!, mm!, ss ?? 0)
  const offsetAt = (t: number) => {
    const w = wallClock(new Date(t), timeZone)
    const [wy, wm, wd] = w.date.split('-').map(Number)
    const [wh, wmin] = w.time.split(':').map(Number)
    return Date.UTC(wy!, wm! - 1, wd!, wh!, wmin!, w.seconds) - t
  }
  let t = guess - offsetAt(guess)
  t = guess - offsetAt(t)
  return new Date(t)
}

// ─── Eventos propios: acceso y enlace de suscripción ───

export async function getCalendarEvent(companyId: number, id: number) {
  const [ev] = await useDb().select().from(tables.calendarEvents).where(and(eq(tables.calendarEvents.id, id), eq(tables.calendarEvents.companyId, companyId)))
  if (!ev) throw createError({ statusCode: 404, statusMessage: 'Evento no encontrado' })
  return ev
}

export async function assertEventRefs(companyId: number, input: Pick<CalendarEventInput, 'contactId'>) {
  if (!input.contactId) return
  const [c] = await useDb().select({ id: tables.contacts.id }).from(tables.contacts).where(and(eq(tables.contacts.id, input.contactId), eq(tables.contacts.companyId, companyId)))
  if (!c) throw createError({ statusCode: 400, statusMessage: 'Ese contacto no existe', data: { field: 'contactId' } })
}

/** Columnas a guardar: las tareas no llevan hora de fin ni duran varios días */
export function eventValues(input: CalendarEventInput) {
  const task = input.kind === 'task'
  return {
    kind: input.kind,
    title: input.title,
    notes: input.notes,
    location: task ? null : input.location,
    startDate: input.startDate,
    endDate: !task && input.endDate && input.endDate > input.startDate ? input.endDate : null,
    startTime: input.startTime,
    endTime: task ? null : input.endTime,
    color: input.color,
    repeat: input.repeat,
    repeatInterval: input.repeat === 'none' ? 1 : input.repeatInterval,
    repeatUntil: input.repeat === 'none' ? null : input.repeatUntil,
    remindMinutes: input.remindMinutes,
    contactId: input.contactId,
  }
}

export const newCalendarToken = () => randomBytes(24).toString('base64url')

/** Enlace de suscripción del usuario en la empresa (se crea la primera vez) */
export async function calendarLink(companyId: number, userId: number) {
  const db = useDb()
  const where = and(eq(tables.calendarLinks.companyId, companyId), eq(tables.calendarLinks.userId, userId))
  const [row] = await db.select().from(tables.calendarLinks).where(where)
  if (row) return row
  await db.insert(tables.calendarLinks).values({ companyId, userId, token: newCalendarToken(), layers: [...DEFAULT_FEED_LAYERS] })
  const [created] = await db.select().from(tables.calendarLinks).where(where)
  return created!
}

export function calendarLinkDto(event: H3Event, link: typeof tables.calendarLinks.$inferSelect, companyName: string) {
  const https = `${siteUrl(event)}/api/public/calendar/${link.token}.ics`
  const webcal = https.replace(/^https?:\/\//, 'webcal://')
  const name = `NUMIQ · ${companyName}`
  return {
    https,
    webcal,
    google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`,
    outlook: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=${encodeURIComponent(name)}`,
    office: `https://outlook.office.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=${encodeURIComponent(name)}`,
    name,
    layers: (link.layers?.length ? link.layers : DEFAULT_FEED_LAYERS) as CalendarLayer[],
    lastUsedAt: link.lastUsedAt,
    createdAt: link.createdAt,
    /** Google y Apple solo pueden leer direcciones públicas: en local no funcionará */
    local: /\/\/(localhost|127\.|192\.168\.|10\.|\[::1\])/.test(https),
  }
}
