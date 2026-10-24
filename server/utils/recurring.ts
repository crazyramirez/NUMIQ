import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { RecurringTemplate } from '../db/schema'

/**
 * Facturas y gastos recurrentes: cuotas, igualas, alquileres, suscripciones… Se programan una vez y
 * se generan solos en su fecha (borrador para revisar, o emitida y enviada si se pide).
 */

type Company = typeof tables.companies.$inferSelect
type Recurring = typeof tables.recurrings.$inferSelect

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha con formato AAAA-MM-DD')
const optionalText = (max: number) => z.string().trim().max(max).nullish().transform(v => v || null)

export const recurringInputSchema = z.object({
  kind: z.enum(['invoice', 'expense']),
  name: z.string().trim().min(1, 'Ponle un nombre para reconocerla').max(160),
  frequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']).default('monthly'),
  interval: z.number().int().min(1, 'Mínimo 1').max(24, 'Máximo 24').default(1),
  /** Próxima fecha (al crear, la primera): fija el día del mes de toda la serie */
  nextDate: isoDate,
  endDate: isoDate.nullish().transform(v => v ?? null),
  autoIssue: z.boolean().default(false),
  autoSend: z.boolean().default(false),
  contactId: z.number().int().positive().nullish().transform(v => v ?? null),
  categoryId: z.number().int().positive().nullish().transform(v => v ?? null),
  description: optionalText(255),
  irpfRate: z.number().min(0).max(100).default(0),
  // Factura
  seriesId: z.number().int().positive().nullish().transform(v => v ?? null),
  lines: z.array(salesLineSchema).max(100).default([]),
  paymentMethod: z.enum(['transfer', 'card', 'cash', 'direct_debit', 'bizum', 'other']).default('transfer'),
  dueDays: z.number().int().min(0).max(365).nullish().transform(v => v ?? null),
  notes: optionalText(5000),
  terms: optionalText(5000),
  customerReference: optionalText(80),
  // Gasto
  expenseKind: z.enum(['invoice', 'ticket', 'payroll', 'social_security', 'tax', 'other']).default('invoice'),
  taxLines: z.array(z.object({
    base: z.number().finite(),
    vatRate: z.number().min(0).max(100),
    vatAmount: z.number().finite().nullish().transform(v => v ?? null),
    surchargeRate: z.number().min(0).max(100).default(0),
  })).max(10).default([]),
  deductiblePct: z.number().min(0).max(100).default(100),
  vatDeductiblePct: z.number().min(0).max(100).default(100),
  paid: z.boolean().default(false),
}).superRefine((r, ctx) => {
  if (r.kind === 'invoice') {
    if (!r.contactId) ctx.addIssue({ code: 'custom', path: ['contactId'], message: 'Elige el cliente al que se factura' })
    if (!r.lines.length) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Añade al menos una línea' })
  }
  else if (!r.taxLines.length) ctx.addIssue({ code: 'custom', path: ['taxLines'], message: 'Indica la base imponible' })
  if (r.autoSend && !r.autoIssue) ctx.addIssue({ code: 'custom', path: ['autoSend'], message: 'Para enviarla sola, también tiene que emitirse sola' })
  if (r.endDate && r.endDate < r.nextDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'La fecha final es anterior a la primera' })
})

export type RecurringInput = z.infer<typeof recurringInputSchema>

/** Plantilla que se guarda: lo necesario para generar cada documento, con su importe calculado */
export function buildTemplate(r: RecurringInput): RecurringTemplate {
  if (r.kind === 'invoice') {
    const t = computeTotals(r.lines, r.irpfRate)
    return {
      contactId: r.contactId,
      seriesId: r.seriesId,
      lines: r.lines,
      irpfRate: r.irpfRate,
      paymentMethod: r.paymentMethod,
      dueDays: r.dueDays,
      notes: r.notes,
      terms: r.terms,
      customerReference: r.customerReference,
      description: r.description,
      base: t.taxBase,
      total: t.total,
    }
  }
  const t = expenseTotals({ taxLines: r.taxLines, irpfRate: r.irpfRate })
  return {
    contactId: r.contactId,
    categoryId: r.categoryId,
    description: r.description,
    expenseKind: r.expenseKind,
    taxLines: r.taxLines,
    irpfRate: r.irpfRate,
    deductiblePct: r.deductiblePct,
    vatDeductiblePct: r.vatDeductiblePct,
    paymentMethod: r.paymentMethod,
    paid: r.paid,
    base: t.taxBase,
    total: t.total,
  }
}

/**
 * Plantilla lista para usar: las antiguas (solo con el total del gasto, sin importes calculados)
 * se completan para que se puedan listar, editar y generar igual que las nuevas.
 */
export function templateOf(rec: Pick<Recurring, 'kind' | 'template'>): RecurringTemplate {
  const t: RecurringTemplate = { ...rec.template }
  if (rec.kind === 'expense' && !t.taxLines?.length && t.total) t.taxLines = [{ base: t.total, vatRate: 0 }]
  if (t.base == null || t.total == null) {
    const totals = rec.kind === 'invoice'
      ? computeTotals(t.lines ?? [], t.irpfRate ?? 0)
      : expenseTotals({ taxLines: (t.taxLines ?? []).map(l => ({ ...l, surchargeRate: l.surchargeRate ?? 0 })), irpfRate: t.irpfRate ?? 0 })
    t.base = totals.taxBase
    t.total = totals.total
  }
  return t
}

/** Comprueba que cliente/proveedor, serie y categoría son de la empresa */
export async function assertTemplateRefs(companyId: number, r: RecurringInput) {
  const db = useDb()
  if (r.contactId) {
    const [c] = await db.select({ id: tables.contacts.id }).from(tables.contacts).where(and(eq(tables.contacts.id, r.contactId), eq(tables.contacts.companyId, companyId)))
    if (!c) throw createError({ statusCode: 400, statusMessage: r.kind === 'invoice' ? 'Cliente no encontrado' : 'Proveedor no encontrado', data: { field: 'contactId' } })
  }
  if (r.seriesId) {
    const [s] = await db.select({ id: tables.series.id }).from(tables.series).where(and(eq(tables.series.id, r.seriesId), eq(tables.series.companyId, companyId)))
    if (!s) throw createError({ statusCode: 400, statusMessage: 'Serie no encontrada', data: { field: 'seriesId' } })
  }
  if (r.categoryId) {
    const [c] = await db.select({ id: tables.categories.id }).from(tables.categories).where(and(eq(tables.categories.id, r.categoryId), eq(tables.categories.companyId, companyId)))
    if (!c) throw createError({ statusCode: 400, statusMessage: 'Categoría no encontrada', data: { field: 'categoryId' } })
  }
}

export async function getRecurring(companyId: number, id: number) {
  const [rec] = await useDb().select().from(tables.recurrings)
    .where(and(eq(tables.recurrings.id, id), eq(tables.recurrings.companyId, companyId)))
  if (!rec) throw createError({ statusCode: 404, statusMessage: 'Recurrente no encontrado' })
  return rec
}

// ─── Generación de un documento ──────────────────────────────────────────────

export interface Generated {
  type: 'sales' | 'expense'
  id: number
  number: string | null
  /** Se generó, pero algo no salió del todo (no se pudo emitir o enviar) */
  warning: string | null
}

/** Usuario en cuyo nombre se generan los documentos: quien la creó o el titular de la empresa */
async function actorFor(rec: Recurring) {
  if (rec.createdBy) return rec.createdBy
  const [m] = await useDb().select({ userId: tables.companyMembers.userId }).from(tables.companyMembers)
    .where(and(eq(tables.companyMembers.companyId, rec.companyId), eq(tables.companyMembers.role, 'owner'))).limit(1)
  return m?.userId ?? 0
}

const longDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
const messageOf = (err: unknown) => (err as { statusMessage?: string }).statusMessage ?? (err as Error).message ?? 'Error desconocido'

async function generateInvoice(rec: Recurring, company: Company, issueDate: string, operationDate: string | null, userId: number, site: string): Promise<Generated> {
  const db = useDb()
  const t = templateOf(rec)
  const [contact] = t.contactId
    ? await db.select().from(tables.contacts).where(and(eq(tables.contacts.id, t.contactId), eq(tables.contacts.companyId, company.id)))
    : []
  if (!contact) throw createError({ statusCode: 400, statusMessage: 'El cliente de esta factura recurrente ya no existe' })
  const days = t.dueDays ?? contact.paymentTermsDays ?? company.paymentTermsDays
  const input = salesInputSchema.parse({
    kind: 'invoice',
    seriesId: t.seriesId ?? null,
    contactId: contact.id,
    customerReference: t.customerReference ?? null,
    issueDate,
    dueDate: days ? shiftDays(issueDate, days) : null,
    operationDate,
    irpfRate: t.irpfRate ?? 0,
    paymentMethod: t.paymentMethod ?? 'transfer',
    notes: t.notes ?? null,
    terms: t.terms ?? null,
    lines: t.lines ?? [],
  })
  const id = await saveSalesDraft(company.id, userId, input)
  await db.update(tables.salesDocuments).set({ recurringId: rec.id }).where(eq(tables.salesDocuments.id, id))
  if (!rec.autoIssue) return { type: 'sales', id, number: null, warning: null }

  let number: string
  try {
    number = await issueSalesDocument(company.id, id)
  }
  catch (err) {
    return { type: 'sales', id, number: null, warning: `Se creó el borrador, pero no se pudo emitir: ${messageOf(err)}` }
  }
  if (!rec.autoSend) return { type: 'sales', id, number, warning: null }
  if (!mailEnabled()) return { type: 'sales', id, number, warning: 'Emitida, pero no se envió: el correo no está configurado' }
  if (!contact.email) return { type: 'sales', id, number, warning: 'Emitida, pero no se envió: el cliente no tiene email' }

  const [doc] = await db.select({ total: tables.salesDocuments.total, dueDate: tables.salesDocuments.dueDate }).from(tables.salesDocuments).where(eq(tables.salesDocuments.id, id))
  const brand = company.tradeName || company.legalName
  const firstName = contact.kind === 'person' ? contact.name.split(' ')[0] ?? '' : ''
  const design = await getCompanyDesign(company)
  const tokens: Record<string, string> = {
    cliente: firstName || contact.name || '',
    numero: number,
    importe: eurText(doc?.total ?? 0),
    vencimiento: doc?.dueDate ? longDate(doc.dueDate) : '',
    empresa: brand,
    tipo: 'factura',
  }
  const subject = design.defaultEmailSubject
    ? renderEmailTemplate(design.defaultEmailSubject, tokens)
    : `Factura ${number} · ${brand}`
  const message = design.defaultEmailMessage
    ? renderEmailTemplate(design.defaultEmailMessage, tokens)
    : `Hola${firstName ? `, ${firstName}` : ''}:\n\nTe enviamos la factura ${number} por importe de ${eurText(doc?.total ?? 0)}${doc?.dueDate ? `, con vencimiento el ${longDate(doc.dueDate)}` : ''}.\n\nGracias por tu confianza.\n\nUn saludo,\n${brand}`

  try {
    await sendSalesEmail(company, userId || null, id, {
      to: [contact.email],
      cc: [],
      subject,
      message,
      kind: 'document',
      attachPdf: true,
      attachmentIds: [],
    }, site)
  }
  catch (err) {
    return { type: 'sales', id, number, warning: `Emitida, pero no se pudo enviar: ${messageOf(err)}` }
  }
  return { type: 'sales', id, number, warning: null }
}

async function generateExpense(rec: Recurring, company: Company, date: string, userId: number): Promise<Generated> {
  const t = templateOf(rec)
  const input = expenseInputSchema.parse({
    kind: t.expenseKind ?? 'invoice',
    supplierId: t.contactId ?? null,
    issueDate: date,
    categoryId: t.categoryId ?? null,
    description: t.description || rec.name,
    taxLines: t.taxLines ?? [],
    irpfRate: t.irpfRate ?? 0,
    deductiblePct: t.deductiblePct ?? 100,
    vatDeductiblePct: t.vatDeductiblePct ?? 100,
    paymentMethod: t.paymentMethod ?? null,
    paid: !!t.paid,
  })
  const id = await saveExpense(company.id, userId, input)
  // Modo revisión: queda marcado en Gastos para confirmarlo
  await useDb().update(tables.expenses).set({ recurringId: rec.id, reviewed: rec.autoIssue }).where(eq(tables.expenses.id, id))
  return { type: 'expense', id, number: null, warning: null }
}

async function log(rec: Recurring, userId: number | null, action: string, data: Record<string, unknown>) {
  await useDb().insert(tables.auditLog).values({ companyId: rec.companyId, userId, action, entity: 'recurring', entityId: rec.id, data })
    .catch(err => console.error('[recurring] audit', err))
}

/**
 * Genera la ocurrencia `occurrence` de un recurrente activo. Antes de generar "reserva" la fecha con
 * un UPDATE condicionado (nextDate = la esperada): si otro proceso ya la tomó, no hace nada. Si la
 * generación falla, devuelve la fecha para reintentarlo y anota el error.
 */
export async function runOccurrence(rec: Recurring, company: Company, opts: { issueDate: string, userId?: number | null, site?: string }): Promise<Generated | null> {
  const db = useDb()
  const occurrence = rec.nextDate
  const next = nextOccurrence(rec.startDate ?? rec.nextDate, rec.frequency, rec.interval, occurrence)
  const finished = !!rec.endDate && next > rec.endDate
  const [claim] = await db.update(tables.recurrings)
    .set({ nextDate: next, active: !finished, lastRunAt: new Date(), runCount: sql`${tables.recurrings.runCount} + 1` })
    .where(and(eq(tables.recurrings.id, rec.id), eq(tables.recurrings.nextDate, occurrence), eq(tables.recurrings.active, true)))
  if (!claim.affectedRows) return null

  const userId = opts.userId || await actorFor(rec)
  const site = opts.site ?? useRuntimeConfig().siteUrl ?? ''
  try {
    const result = rec.kind === 'invoice'
      ? await generateInvoice(rec, company, opts.issueDate, opts.issueDate !== occurrence ? occurrence : null, userId, site)
      : await generateExpense(rec, company, opts.issueDate, userId)
    await db.update(tables.recurrings).set({ lastError: result.warning }).where(eq(tables.recurrings.id, rec.id))
    await log(rec, opts.userId ?? null, result.warning ? 'recurring.warning' : 'recurring.run', { occurrence, type: result.type, id: result.id, number: result.number, warning: result.warning })
    return result
  }
  catch (err) {
    const message = messageOf(err).slice(0, 500)
    if (!(err as { statusCode?: number }).statusCode) console.error('[recurring]', rec.id, err)
    // Se deshace la reserva para reintentarlo en la próxima pasada
    await db.update(tables.recurrings)
      .set({ nextDate: occurrence, active: true, runCount: sql`GREATEST(${tables.recurrings.runCount} - 1, 0)`, lastError: message })
      .where(and(eq(tables.recurrings.id, rec.id), eq(tables.recurrings.nextDate, next)))
    if (rec.lastError !== message) await log(rec, opts.userId ?? null, 'recurring.error', { occurrence, message })
    throw createError({ statusCode: (err as { statusCode?: number }).statusCode ?? 500, statusMessage: message })
  }
}

/**
 * "Generar ahora" desde la pantalla: si está activa, adelanta la próxima (y la serie sigue desde
 * ahí); si está pausada o terminada, genera un documento suelto sin tocar la programación.
 */
export async function runNow(rec: Recurring, company: Company, userId: number, site: string): Promise<Generated> {
  const today = toISODate(new Date())
  if (rec.active) {
    const r = await runOccurrence(rec, company, { issueDate: today, userId, site })
    if (!r) throw createError({ statusCode: 409, statusMessage: 'Se acaba de generar en otro proceso: recarga la página' })
    return r
  }
  const result = rec.kind === 'invoice'
    ? await generateInvoice(rec, company, today, null, userId, site)
    : await generateExpense(rec, company, today, userId)
  await log(rec, userId, 'recurring.run', { manual: true, type: result.type, id: result.id, number: result.number, warning: result.warning })
  return result
}

/** Salta la próxima fecha sin generar nada */
export async function skipNext(rec: Recurring) {
  const next = nextOccurrence(rec.startDate ?? rec.nextDate, rec.frequency, rec.interval, rec.nextDate)
  const finished = !!rec.endDate && next > rec.endDate
  await useDb().update(tables.recurrings).set({ nextDate: next, active: rec.active && !finished, lastError: null })
    .where(and(eq(tables.recurrings.id, rec.id), eq(tables.recurrings.nextDate, rec.nextDate)))
  return { nextDate: next, finished }
}

// ─── Programador ─────────────────────────────────────────────────────────────

/** Máximo de periodos atrasados que se generan de una vez por recurrente (el resto, en la siguiente pasada) */
const CATCH_UP = 12

/**
 * Genera todo lo que toca hoy (y lo atrasado si el servidor estuvo parado). Las facturas atrasadas
 * se emiten con fecha de hoy y la del periodo como fecha de operación: la numeración tiene que ser
 * correlativa en el tiempo. Los gastos llevan la fecha que les corresponde.
 */
export async function runDueRecurrings() {
  const db = useDb()
  const today = toISODate(new Date())
  const due = await db.select().from(tables.recurrings)
    .where(and(eq(tables.recurrings.active, true), lte(tables.recurrings.nextDate, today)))
    .orderBy(asc(tables.recurrings.nextDate))
    .limit(500)
  if (!due.length) return { generated: 0, failed: 0 }
  const companyIds = [...new Set(due.map(r => r.companyId))]
  const companies = new Map((await db.select().from(tables.companies).where(inArray(tables.companies.id, companyIds))).map(c => [c.id, c]))
  let generated = 0
  let failed = 0
  for (const first of due) {
    const company = companies.get(first.companyId)
    if (!company) continue
    let rec: Recurring | undefined = first
    for (let n = 0; rec && rec.active && rec.nextDate <= today && n < CATCH_UP; n++) {
      try {
        const r = await runOccurrence(rec, company, { issueDate: rec.kind === 'invoice' ? today : rec.nextDate })
        if (!r) break
        generated++
      }
      catch {
        failed++
        break
      }
      ;[rec] = await db.select().from(tables.recurrings).where(eq(tables.recurrings.id, first.id))
    }
  }
  return { generated, failed }
}

// ─── Listado ─────────────────────────────────────────────────────────────────

export function recurringStatus(r: Pick<Recurring, 'active' | 'endDate' | 'nextDate'>) {
  if (r.active) return 'active' as const
  return r.endDate && r.nextDate > r.endDate ? 'finished' as const : 'paused' as const
}

export interface GeneratedDoc {
  type: 'sales' | 'expense'
  id: number
  number: string | null
  date: string
  status: string
}

/** Último documento generado por cada recurrente */
export async function lastGenerated(companyId: number, ids: number[]) {
  const out = new Map<number, GeneratedDoc>()
  if (!ids.length) return out
  const db = useDb()
  const s = tables.salesDocuments
  const e = tables.expenses
  const [salesMax, expenseMax] = await Promise.all([
    db.select({ id: sql<number>`MAX(${s.id})`.mapWith(Number) }).from(s).where(and(eq(s.companyId, companyId), inArray(s.recurringId, ids))).groupBy(s.recurringId),
    db.select({ id: sql<number>`MAX(${e.id})`.mapWith(Number) }).from(e).where(and(eq(e.companyId, companyId), inArray(e.recurringId, ids))).groupBy(e.recurringId),
  ])
  const [sales, expenses] = await Promise.all([
    salesMax.length ? db.select({ id: s.id, recurringId: s.recurringId, number: s.number, date: s.issueDate, status: s.status }).from(s).where(inArray(s.id, salesMax.map(r => r.id))) : [],
    expenseMax.length ? db.select({ id: e.id, recurringId: e.recurringId, number: e.number, date: e.issueDate, status: e.status }).from(e).where(inArray(e.id, expenseMax.map(r => r.id))) : [],
  ])
  for (const d of sales) out.set(d.recurringId!, { type: 'sales', id: d.id, number: d.number, date: d.date, status: d.status })
  for (const d of expenses) {
    const prev = out.get(d.recurringId!)
    if (!prev || prev.date < d.date) out.set(d.recurringId!, { type: 'expense', id: d.id, number: d.number, date: d.date, status: d.status })
  }
  return out
}

/** Documentos generados por cada recurrente (los últimos), para la ficha */
export async function generatedDocuments(companyId: number, ids: number[], limit = 24) {
  if (!ids.length) return []
  const db = useDb()
  const [sales, expenses] = await Promise.all([
    db.select({ id: tables.salesDocuments.id, recurringId: tables.salesDocuments.recurringId, number: tables.salesDocuments.number, date: tables.salesDocuments.issueDate, status: tables.salesDocuments.status, total: tables.salesDocuments.total })
      .from(tables.salesDocuments)
      .where(and(eq(tables.salesDocuments.companyId, companyId), inArray(tables.salesDocuments.recurringId, ids)))
      .orderBy(desc(tables.salesDocuments.id)).limit(limit * ids.length),
    db.select({ id: tables.expenses.id, recurringId: tables.expenses.recurringId, number: tables.expenses.number, date: tables.expenses.issueDate, status: tables.expenses.status, total: tables.expenses.total })
      .from(tables.expenses)
      .where(and(eq(tables.expenses.companyId, companyId), inArray(tables.expenses.recurringId, ids)))
      .orderBy(desc(tables.expenses.id)).limit(limit * ids.length),
  ])
  return [
    ...sales.map(s => ({ ...s, type: 'sales' as const })),
    ...expenses.map(e => ({ ...e, type: 'expense' as const })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
}
