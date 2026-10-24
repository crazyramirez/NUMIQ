import { and, eq, inArray, sql } from 'drizzle-orm'
import type { PartySnapshot } from '../db/schema'
import type { AiActionPreview, AiActionResult, AiActionRow } from '../../shared/types/assistant'

/**
 * Operaciones del asistente sobre los datos. Cada una tiene tres partes:
 * - plan: resuelve el filtro en registros concretos y prepara la vista previa (no cambia nada);
 * - ejecutar: aplica el cambio registro a registro con las mismas reglas que la app y guarda cómo estaba;
 * - deshacer: vuelve a dejarlo como estaba (las que se pueden deshacer).
 */

type Company = typeof tables.companies.$inferSelect
type Contact = typeof tables.contacts.$inferSelect
type BankTx = typeof tables.bankTransactions.$inferSelect
type Pay = 'transfer' | 'card' | 'cash' | 'direct_debit' | 'bizum' | 'other'
type ExpenseKind = 'invoice' | 'ticket' | 'payroll' | 'social_security' | 'tax' | 'other'
type Skipped = AiActionResult['skipped']

export interface OpCtx {
  company: Company
  actor: { id: number, name: string, role: string }
}

export interface OpPlan {
  kind: string
  title: string
  risk: 'normal' | 'high'
  params: Record<string, unknown>
  preview: AiActionPreview
}

export interface OpOutcome {
  result: AiActionResult
  undo: Record<string, unknown> | null
}

// ─── Formato ─────────────────────────────────────────────────────────────────

const PAY_BY_ES: Readonly<Record<string, Pay>> = Object.freeze({ transferencia: 'transfer', tarjeta: 'card', efectivo: 'cash', domiciliacion: 'direct_debit', bizum: 'bizum', otro: 'other' })
const PAY_TEXT: Readonly<Record<string, string>> = Object.freeze({ transfer: 'transferencia', card: 'tarjeta', cash: 'efectivo', direct_debit: 'domiciliación', bizum: 'Bizum', other: 'otro' })
const EXPENSE_KIND_TEXT: Readonly<Record<string, string>> = Object.freeze({ invoice: 'factura', ticket: 'ticket', payroll: 'nómina', social_security: 'Seguridad Social', tax: 'impuesto', other: 'otro' })
const VALID_VAT = new Set([0, 4, 5, 10, 21])

const fd = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '')
const pctText = (n: number) => `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(n)} %`
const count = (n: number, one: string, many: string) => `${new Intl.NumberFormat('es-ES').format(n)} ${n === 1 ? one : many}`
const sum = (list: number[]) => round2(list.reduce((s, x) => s + x, 0))
const short = (s: string | null | undefined, max = 90) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}
const names = (list: Array<string | null | undefined>, max = 3) => {
  const unique = [...new Set(list.filter((x): x is string => !!x))]
  return unique.length > max ? `${unique.slice(0, max).join(', ')} y ${unique.length - max} más` : unique.join(', ')
}
const errText = (err: unknown) => (err as { statusMessage?: string })?.statusMessage || (err as Error)?.message || 'Error inesperado'
const today = () => toISODate(new Date())
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function preview(rows: AiActionRow[], extra: Partial<AiActionPreview> & { undoable: boolean }): AiActionPreview {
  return { change: null, scope: null, total: null, warnings: [], ...extra, count: extra.count ?? rows.length, rows: rows.slice(0, 200) }
}

/** Nombre de cada registro para explicar después los que no se pudieron tocar */
const labelsOf = (rows: Array<{ id: number, label: string }>) => Object.fromEntries(rows.map(r => [r.id, r.label]))

class Tally {
  done = 0
  skipped: Skipped = []
  constructor(private labels: Record<string, string> = {}) {}
  skip(id: number, reason: string) {
    this.skipped.push({ id, label: this.labels[id] ?? `#${id}`, reason })
  }

  result(extra: Partial<AiActionResult> = {}): AiActionResult {
    return { done: this.done, skipped: this.skipped.slice(0, 100), ...extra }
  }
}

function checkRange(v: number | null | undefined, min: number, max: number, what: string) {
  if (v == null) return undefined
  if (!Number.isFinite(v) || v < min || v > max) throw new OpError(`${capital(what)} no válido: entre ${min} y ${max}`)
  return round2(v)
}

function payMethod(v: string | null | undefined) {
  if (!v) return undefined
  const p = PAY_BY_ES[v] ?? (Object.values(PAY_BY_ES).includes(v as Pay) ? v as Pay : undefined)
  if (!p) throw new OpError('Forma de pago no válida: transferencia, tarjeta, efectivo, domiciliacion, bizum u otro')
  return p
}

function date(v: string | null | undefined, what: string) {
  if (!v) return undefined
  if (!isISODate(v)) throw new OpError(`La ${what} «${v}» no es válida: usa AAAA-MM-DD`)
  return v
}

function partyFromName(name: string) {
  return { name: name.trim().slice(0, 200), nif: null, address: null, postalCode: null, city: null, province: null, country: 'ES', email: null, phone: null, isPerson: false }
}

function tooMany(n: number, what: string) {
  if (n > MAX_TARGETS) throw new OpError(`Son más de ${MAX_TARGETS} ${what}: demasiados para una sola operación. Divide la petición, por ejemplo por fechas.`)
}

// ═══ Facturas y presupuestos ═════════════════════════════════════════════════

export interface SalesChangesIn {
  cliente: string | null
  irpf: number | null
  iva: number | null
  fecha: string | null
  vencimiento: string | null
  forma_pago: string | null
  notas: string | null
  condiciones: string | null
  referencia: string | null
}

interface SalesChangeSet {
  contactId?: number
  irpfRate?: number
  vatRate?: number
  issueDate?: string
  dueDate?: string
  paymentMethod?: Pay
  notes?: string
  terms?: string
  customerReference?: string
}

const isQuote = (kind: string) => kind === 'quote' || kind === 'proforma'
const salesLabel = (r: { kind: string, number: string | null }) => r.number ?? (isQuote(r.kind) ? 'Presupuesto en borrador' : 'Borrador')
const salesUrl = (r: { kind: string, id: number }) => (isQuote(r.kind) ? `/presupuestos/${r.id}` : `/facturas/${r.id}`)
const salesRow = (r: SalesTarget, extra: Partial<AiActionRow> = {}): AiActionRow => ({
  id: r.id, label: salesLabel(r), sub: [r.client, fd(r.issueDate)].filter(Boolean).join(' · '), amount: r.total, url: salesUrl(r), ...extra,
})

type LineLike = { vatRate: number, surchargeRate: number, quantity: number, unitPrice: number, discountPct: number, irpfApplies: boolean }

/** Recargo de equivalencia de una línea: el del nuevo cliente o, sin cambio de cliente, el que ya llevaba */
function adjustLine<T extends LineLike>(l: T, ch: SalesChangeSet, contact: Pick<Contact, 'equivalenceSurcharge'> | null): T {
  const vatRate = ch.vatRate ?? l.vatRate
  const withSurcharge = contact ? contact.equivalenceSurcharge : l.surchargeRate > 0
  return { ...l, vatRate, surchargeRate: withSurcharge ? SURCHARGE_BY_VAT[vatRate] ?? 0 : 0 }
}

async function linesOf(ids: number[]) {
  const l = tables.salesDocumentLines
  const rows = ids.length ? await useDb().select().from(l).where(inArray(l.documentId, ids)).orderBy(l.documentId, l.position) : []
  const map = new Map<number, typeof rows>()
  for (const r of rows) map.set(r.documentId, [...(map.get(r.documentId) ?? []), r])
  return map
}

export async function planSales(ctx: OpCtx, family: SalesFamily, accion: string, rawFilter: unknown, cambios: SalesChangesIn): Promise<OpPlan> {
  const f = cleanFilter(rawFilter)
  const [one, many] = family === 'quote' ? ['presupuesto', 'presupuestos'] : ['factura', 'facturas']
  requireScope(f, many)
  if (family === 'quote' && (accion === 'marcar_cobradas' || accion === 'marcar_pendientes')) {
    throw new OpError('Los presupuestos no se cobran: primero hay que convertirlos en factura')
  }
  const { rows: found, matched } = await salesTargets(ctx.company, f, family)
  if (!found.length) throw new OpError(`No hay ${many} que coincidan con ese filtro`, { clientes_coincidentes: matched })
  tooMany(found.length, many)
  const scope = f.nombres && matched.length ? `Clientes: ${names(matched, 5)}` : null
  const n = (k: number) => count(k, one, many)

  if (accion === 'eliminar') {
    const issued = found.filter(r => r.status !== 'draft' && !isQuote(r.kind)).length
    const withPayments = found.filter(r => r.paidTotal !== 0).length
    return {
      kind: 'ventas.eliminar',
      title: `Eliminar ${n(found.length)}`,
      risk: 'high',
      params: { ids: found.map(r => r.id), labels: labelsOf(found.map(r => ({ id: r.id, label: salesLabel(r) }))) },
      preview: preview(found.map(r => salesRow(r)), {
        scope,
        total: sum(found.map(r => r.total)),
        undoable: false,
        warnings: [
          'Se borran definitivamente, con sus líneas, cobros y adjuntos.',
          issued ? `${n(issued)} ya ${issued === 1 ? 'está emitida' : 'están emitidas'}: borrarlas deja huecos en la numeración. Si ya se enviaron, lo correcto es anularlas con una rectificativa.` : '',
          withPayments ? `${count(withPayments, 'tiene cobros', 'tienen cobros')}: los movimientos del banco conciliados vuelven a pendientes.` : '',
        ].filter(Boolean),
      }),
    }
  }

  if (accion === 'emitir') {
    const drafts = found.filter(r => r.status === 'draft').sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.id - b.id)
    if (!drafts.length) throw new OpError(`Ninguno de esos ${many} es un borrador: ya están emitidos`)
    const clients = await companyContacts(ctx.company.id)
    const noNif = family === 'invoice' ? drafts.filter(r => !clients.find(c => c.id === r.contactId)?.nif).length : 0
    return {
      kind: 'ventas.emitir',
      title: `Emitir ${n(drafts.length)}`,
      risk: 'normal',
      params: { ids: drafts.map(r => r.id), labels: labelsOf(drafts.map(r => ({ id: r.id, label: `${salesLabel(r)} · ${r.client ?? 'sin cliente'}` }))) },
      preview: preview(drafts.map(r => salesRow(r, { before: 'Borrador', after: 'Emitida' })), {
        scope,
        total: sum(drafts.map(r => r.total)),
        undoable: false,
        warnings: [
          'Se numeran en orden de fecha. Emitir no tiene vuelta atrás: después solo se corrigen con una rectificativa.',
          found.length > drafts.length ? `${count(found.length - drafts.length, 'ya estaba emitido y no se toca', 'ya estaban emitidos y no se tocan')}.` : '',
          noNif ? `${count(noNif, 'no tiene', 'no tienen')} cliente con NIF: no se ${noNif === 1 ? 'podrá' : 'podrán'} emitir.` : '',
        ].filter(Boolean),
      }),
    }
  }

  if (accion === 'marcar_cobradas') {
    const open = found.filter(r => ['issued', 'sent', 'partial'].includes(r.status))
    if (!open.length) throw new OpError('Ninguna de esas facturas tiene cobros pendientes')
    const day = date(cambios.fecha, 'fecha del cobro') ?? today()
    const method = payMethod(cambios.forma_pago) ?? 'transfer'
    return {
      kind: 'ventas.cobrar',
      title: `Marcar como ${open.length === 1 ? 'cobrada' : 'cobradas'} ${n(open.length)}`,
      risk: 'normal',
      params: { ids: open.map(r => r.id), labels: labelsOf(open.map(r => ({ id: r.id, label: salesLabel(r) }))), date: day, method },
      preview: preview(open.map(r => salesRow(r, { amount: round2(r.total - r.paidTotal), before: 'Pendiente', after: 'Cobrada' })), {
        scope,
        change: `Cobro de lo pendiente el ${fd(day)} por ${PAY_TEXT[method]}`,
        total: sum(open.map(r => r.total - r.paidTotal)),
        undoable: true,
        warnings: found.length > open.length ? [`${count(found.length - open.length, 'no tenía', 'no tenían')} nada pendiente y no se ${found.length - open.length === 1 ? 'toca' : 'tocan'}.`] : [],
      }),
    }
  }

  if (accion === 'marcar_pendientes') {
    const paid = found.filter(r => r.status === 'paid' || r.status === 'partial')
    if (!paid.length) throw new OpError('Ninguna de esas facturas tiene cobros registrados')
    return {
      kind: 'ventas.pendiente',
      title: `Quitar los cobros de ${n(paid.length)}`,
      risk: 'normal',
      params: { ids: paid.map(r => r.id), labels: labelsOf(paid.map(r => ({ id: r.id, label: salesLabel(r) }))) },
      preview: preview(paid.map(r => salesRow(r, { before: r.status === 'paid' ? 'Cobrada' : 'Cobro parcial', after: 'Pendiente' })), {
        scope,
        total: sum(paid.map(r => r.total)),
        undoable: true,
        warnings: ['Se borran sus cobros y los movimientos del banco conciliados con ellos vuelven a pendientes.'],
      }),
    }
  }

  if (accion !== 'modificar') throw new OpError(`Acción desconocida: ${accion}`)

  // ─── Modificar ───
  const ch: SalesChangeSet = {}
  const parts: string[] = []
  let contact: Contact | null = null
  if (cambios.cliente?.trim()) {
    contact = await resolveContact(ctx.company.id, cambios.cliente, 'client')
    ch.contactId = contact.id
  }
  ch.irpfRate = checkRange(cambios.irpf, 0, 50, 'el porcentaje de retención')
  if (cambios.iva != null) {
    if (!VALID_VAT.has(cambios.iva)) throw new OpError('Tipo de IVA no válido: 21, 10, 5, 4 o 0')
    ch.vatRate = cambios.iva
  }
  ch.issueDate = date(cambios.fecha, 'fecha')
  ch.dueDate = date(cambios.vencimiento, 'fecha de vencimiento')
  ch.paymentMethod = payMethod(cambios.forma_pago)
  if (cambios.notas != null && cambios.notas.trim()) ch.notes = cambios.notas.trim().slice(0, 5000)
  if (cambios.condiciones != null && cambios.condiciones.trim()) ch.terms = cambios.condiciones.trim().slice(0, 5000)
  if (cambios.referencia != null && cambios.referencia.trim()) ch.customerReference = cambios.referencia.trim().slice(0, 80)
  for (const k of Object.keys(ch) as Array<keyof SalesChangeSet>) if (ch[k] === undefined) delete ch[k]
  if (!Object.keys(ch).length) throw new OpError('Indica qué quieres cambiar')

  if (contact) parts.push(`${names(found.map(r => r.client)) || 'Sin cliente'} → ${contact.name}`)
  if (ch.irpfRate != null) parts.push(ch.irpfRate ? `retención del ${pctText(ch.irpfRate)}` : 'sin retención')
  if (ch.vatRate != null) parts.push(`IVA del ${pctText(ch.vatRate)}`)
  if (ch.issueDate) parts.push(`fecha ${fd(ch.issueDate)}`)
  if (ch.dueDate) parts.push(`vence el ${fd(ch.dueDate)}`)
  if (ch.paymentMethod) parts.push(`pago por ${PAY_TEXT[ch.paymentMethod]}`)
  if (ch.notes) parts.push('notas nuevas')
  if (ch.terms) parts.push('condiciones nuevas')
  if (ch.customerReference) parts.push(`referencia ${ch.customerReference}`)

  const amounts = ch.irpfRate != null || ch.vatRate != null || !!contact
  const lines = amounts ? await linesOf(found.map(r => r.id)) : new Map()
  const locked = await verifactuLocked(ctx.company.id, found)
  const rows: AiActionRow[] = []
  const targets: SalesTarget[] = []
  let unchanged = 0
  let paidTouched = 0
  for (const r of found) {
    if (locked.has(r.id)) continue
    let changes = Object.keys(ch).some(k => !['contactId', 'irpfRate', 'vatRate', 'issueDate', 'dueDate'].includes(k))
    if (ch.contactId != null && r.contactId !== ch.contactId) changes = true
    if (ch.irpfRate != null && r.irpfRate !== ch.irpfRate) changes = true
    if (ch.issueDate && r.issueDate !== ch.issueDate) changes = true
    if (ch.dueDate && r.dueDate !== ch.dueDate) changes = true
    let newTotal = r.total
    if (amounts) {
      const docLines = (lines.get(r.id) ?? []) as LineLike[]
      if (ch.vatRate != null && docLines.some(l => l.vatRate !== ch.vatRate)) changes = true
      newTotal = computeTotals(docLines.map(l => adjustLine(l, ch, contact)), ch.irpfRate ?? r.irpfRate).total
    }
    if (!changes) {
      unchanged++
      continue
    }
    const amountChanges = Math.abs(newTotal - r.total) > 0.004
    if (amountChanges && r.paidTotal !== 0) paidTouched++
    targets.push(r)
    rows.push(salesRow(r, contact
      ? { before: r.client ?? 'Sin cliente', after: contact.name, amount: newTotal }
      : amountChanges ? { before: eurText(r.total), after: eurText(newTotal), amount: newTotal } : {}))
  }
  if (!targets.length && locked.size) throw new OpError(`${locked.size === 1 ? 'Esa factura tiene' : 'Esas facturas tienen'} registro VeriFactu: solo se corrigen con una rectificativa`)
  if (!targets.length) throw new OpError(`${found.length === 1 ? `Ese ${one} ya lo tiene` : `Esos ${many} ya lo tienen`}: no hay nada que cambiar`)

  const issued = targets.filter(r => r.status !== 'draft' && !isQuote(r.kind)).length
  const surchargeChange = contact && targets.some(r => (lines.get(r.id) ?? []).some((l: LineLike) => (l.surchargeRate > 0) !== contact!.equivalenceSurcharge))
  const only = Object.keys(ch)
  const title = only.length === 1 && contact ? `Cambiar el cliente de ${n(targets.length)}`
    : only.length === 1 && ch.irpfRate != null ? (ch.irpfRate ? `Aplicar retención del ${pctText(ch.irpfRate)} a ${n(targets.length)}` : `Quitar la retención de ${n(targets.length)}`)
      : only.length === 1 && ch.vatRate != null ? `Poner IVA del ${pctText(ch.vatRate)} en ${n(targets.length)}`
        : `Modificar ${n(targets.length)}`
  return {
    kind: 'ventas.modificar',
    title,
    risk: 'normal',
    params: { ids: targets.map(r => r.id), labels: labelsOf(targets.map(r => ({ id: r.id, label: salesLabel(r) }))), changes: ch },
    preview: preview(rows, {
      scope,
      change: capital(parts.join(' · ')),
      total: sum(rows.map(r => r.amount ?? 0)),
      undoable: true,
      warnings: [
        issued && contact ? `${n(issued)} ya ${issued === 1 ? 'está emitida' : 'están emitidas'}: el cliente cambia en la propia factura. Si ya se la enviaste al anterior, lo correcto es una rectificativa.` : '',
        issued && (ch.irpfRate != null || ch.vatRate != null) && !contact ? `${n(issued)} ya ${issued === 1 ? 'está emitida' : 'están emitidas'}: si ya ${issued === 1 ? 'la enviaste' : 'las enviaste'}, cambiar importes requiere una rectificativa.` : '',
        issued && ch.issueDate ? 'Cambiar la fecha de facturas emitidas puede romper el orden correlativo de la numeración.' : '',
        surchargeChange ? 'El recargo de equivalencia se ajusta al nuevo cliente.' : '',
        paidTouched ? `${count(paidTouched, 'tiene cobros', 'tienen cobros')}: su estado de cobro se recalcula con el nuevo total.` : '',
        locked.size ? `${n(locked.size)} ${locked.size === 1 ? 'tiene' : 'tienen'} registro VeriFactu y no se ${locked.size === 1 ? 'toca' : 'tocan'}: solo se corrigen con una rectificativa.` : '',
        unchanged ? `${count(unchanged, 'ya lo tenía y no se toca', 'ya lo tenían y no se tocan')}.` : '',
      ].filter(Boolean),
    }),
  }
}

/** saveSalesDraft pone la serie por defecto a los documentos sin serie (importados): se conserva la suya */
async function keepSeries(companyId: number, id: number, seriesId: number | null | undefined) {
  if (seriesId != null) return
  const s = tables.salesDocuments
  await useDb().update(s).set({ seriesId: null }).where(and(eq(s.id, id), eq(s.companyId, companyId)))
}

/** Facturas emitidas con registro VeriFactu: la app no deja modificarlas (misma regla que saveSalesDraft) */
async function verifactuLocked(companyId: number, docs: SalesTarget[]) {
  const ids = docs.filter(d => d.status !== 'draft' && !isQuote(d.kind)).map(d => d.id)
  if (!ids.length) return new Set<number>()
  const vf = tables.verifactuRecords
  const rows = await useDb().selectDistinct({ id: vf.salesDocumentId }).from(vf).where(and(eq(vf.companyId, companyId), inArray(vf.salesDocumentId, ids)))
  return new Set(rows.map(r => r.id))
}

async function loadSalesInput(companyId: number, id: number) {
  const db = useDb()
  const s = tables.salesDocuments
  const [doc] = await db.select().from(s).where(and(eq(s.id, id), eq(s.companyId, companyId)))
  if (!doc) return null
  const lines = await db.select().from(tables.salesDocumentLines).where(eq(tables.salesDocumentLines.documentId, id)).orderBy(tables.salesDocumentLines.position)
  const input = {
    kind: doc.kind,
    seriesId: doc.seriesId,
    contactId: doc.contactId,
    customerReference: doc.customerReference,
    issueDate: doc.issueDate,
    dueDate: doc.dueDate,
    operationDate: doc.operationDate,
    irpfRate: doc.irpfRate,
    paymentMethod: doc.paymentMethod ?? 'transfer',
    description: doc.description,
    notes: doc.notes,
    terms: doc.terms,
    rectifiesId: doc.rectifiesId,
    rectificationCode: doc.rectificationCode,
    rectificationReason: doc.rectificationReason,
    lines: lines.map(l => ({ itemId: l.itemId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, vatRate: l.vatRate, surchargeRate: l.surchargeRate, irpfApplies: l.irpfApplies })),
  } as SalesInput
  return { doc, input }
}

async function salesModify(ctx: OpCtx, p: { ids: number[], labels: Record<string, string>, changes: SalesChangeSet }): Promise<OpOutcome> {
  const db = useDb()
  const c = tables.contacts
  const t = new Tally(p.labels)
  let contact: Contact | null = null
  if (p.changes.contactId) {
    contact = (await db.select().from(c).where(and(eq(c.id, p.changes.contactId), eq(c.companyId, ctx.company.id))))[0] ?? null
    if (!contact) throw new OpError('El cliente nuevo ya no existe')
    if (!contact.isClient) await db.update(c).set({ isClient: true }).where(eq(c.id, contact.id))
  }
  const undo: Array<{ id: number, input: SalesInput, customer: PartySnapshot | null }> = []
  for (const id of p.ids) {
    try {
      const loaded = await loadSalesInput(ctx.company.id, id)
      if (!loaded) {
        t.skip(id, 'Ya no existe')
        continue
      }
      if (!loaded.input.lines.length) {
        t.skip(id, 'No tiene líneas')
        continue
      }
      const ch = p.changes
      const next: SalesInput = {
        ...loaded.input,
        ...(ch.contactId ? { contactId: ch.contactId } : {}),
        ...(ch.irpfRate != null ? { irpfRate: ch.irpfRate } : {}),
        ...(ch.issueDate ? { issueDate: ch.issueDate } : {}),
        ...(ch.dueDate ? { dueDate: ch.dueDate } : {}),
        ...(ch.paymentMethod ? { paymentMethod: ch.paymentMethod } : {}),
        ...(ch.notes ? { notes: ch.notes } : {}),
        ...(ch.terms ? { terms: ch.terms } : {}),
        ...(ch.customerReference ? { customerReference: ch.customerReference } : {}),
        lines: ch.vatRate != null || contact ? loaded.input.lines.map(l => adjustLine(l, ch, contact)) : loaded.input.lines,
      }
      await saveSalesDraft(ctx.company.id, ctx.actor.id, next, id)
      await keepSeries(ctx.company.id, id, loaded.input.seriesId)
      undo.push({ id, input: loaded.input, customer: loaded.doc.customer })
      t.done++
    }
    catch (err) {
      t.skip(id, errText(err))
    }
  }
  return { result: t.result(), undo: { items: undo } }
}

async function salesModifyRevert(ctx: OpCtx, u: { items: Array<{ id: number, input: SalesInput, customer: PartySnapshot | null }> }) {
  const t = new Tally()
  for (const item of u.items) {
    try {
      await saveSalesDraft(ctx.company.id, ctx.actor.id, item.input, item.id)
      // Los datos del cliente tal y como estaban guardados en el documento, y su serie
      await useDb().update(tables.salesDocuments).set({ customer: item.customer, seriesId: item.input.seriesId ?? null })
        .where(and(eq(tables.salesDocuments.id, item.id), eq(tables.salesDocuments.companyId, ctx.company.id)))
      t.done++
    }
    catch (err) {
      t.skip(item.id, errText(err))
    }
  }
  return t.result()
}

async function salesDelete(ctx: OpCtx, p: { ids: number[], labels: Record<string, string> }): Promise<OpOutcome> {
  const t = new Tally(p.labels)
  const { deleted, blocked } = await deleteSalesDocuments(ctx.company.id, p.ids)
  t.done = deleted.length
  for (const b of blocked) t.skip(b.id, 'Registrada en la AEAT: solo se anula con una rectificativa')
  const gone = new Set([...deleted, ...blocked].map(d => d.id))
  for (const id of p.ids) if (!gone.has(id)) t.skip(id, 'Ya no existía')
  return { result: t.result(), undo: null }
}

async function salesIssue(ctx: OpCtx, p: { ids: number[], labels: Record<string, string> }): Promise<OpOutcome> {
  const t = new Tally(p.labels)
  const numbers: string[] = []
  for (const id of p.ids) {
    try {
      numbers.push(await issueSalesDocument(ctx.company.id, id))
      t.done++
    }
    catch (err) {
      t.skip(id, errText(err))
    }
  }
  return { result: t.result({ message: numbers.length ? `Números: ${names(numbers, 6)}` : null }), undo: null }
}

async function salesCollect(ctx: OpCtx, p: { ids: number[], labels: Record<string, string>, date: string, method: Pay }): Promise<OpOutcome> {
  const t = new Tally(p.labels)
  const undo: Array<{ id: number, paymentId: number }> = []
  const s = tables.salesDocuments
  for (const id of p.ids) {
    try {
      const [doc] = await useDb().select({ status: s.status }).from(s).where(and(eq(s.id, id), eq(s.companyId, ctx.company.id)))
      if (!doc) {
        t.skip(id, 'Ya no existe')
        continue
      }
      if (doc.status === 'paid') {
        t.skip(id, 'Ya estaba cobrada')
        continue
      }
      const r = await changeSalesPayments(ctx.company.id, id, { action: 'save', input: { date: p.date, method: p.method, notes: 'Marcada como cobrada desde el asistente' } })
      if (r.paymentId) undo.push({ id, paymentId: r.paymentId })
      t.done++
    }
    catch (err) {
      t.skip(id, errText(err))
    }
  }
  return { result: t.result(), undo: { items: undo } }
}

async function salesCollectRevert(ctx: OpCtx, u: { items: Array<{ id: number, paymentId: number }> }) {
  const t = new Tally()
  for (const item of u.items) {
    try {
      await changeSalesPayments(ctx.company.id, item.id, { action: 'remove', paymentId: item.paymentId })
      t.done++
    }
    catch (err) {
      t.skip(item.id, errText(err))
    }
  }
  return t.result()
}

type SavedPayment = { amount: number, date: string, method: Pay, notes: string | null }

async function salesUncollect(ctx: OpCtx, p: { ids: number[], labels: Record<string, string> }): Promise<OpOutcome> {
  const t = new Tally(p.labels)
  const undo: Array<{ id: number, payments: SavedPayment[], banked: boolean }> = []
  for (const id of p.ids) {
    try {
      const r = await changeSalesPayments(ctx.company.id, id, { action: 'clear' })
      undo.push({ id, payments: r.paymentsBefore.map(x => ({ amount: x.amount, date: x.date, method: x.method, notes: x.notes })), banked: r.unmatched.length > 0 })
      t.done++
    }
    catch (err) {
      t.skip(id, errText(err))
    }
  }
  return { result: t.result(), undo: { items: undo } }
}

async function salesUncollectRevert(ctx: OpCtx, u: { items: Array<{ id: number, payments: SavedPayment[], banked?: boolean }> }) {
  const t = new Tally()
  for (const item of u.items) {
    try {
      for (const pay of item.payments) await changeSalesPayments(ctx.company.id, item.id, { action: 'save', input: pay })
      t.done++
    }
    catch (err) {
      t.skip(item.id, errText(err))
    }
  }
  return t.result({ message: u.items.some(i => i.banked) ? 'Los cobros vuelven a estar, pero sin enlazar con el banco: concílialos de nuevo en Banco si hace falta.' : null })
}

// ═══ Gastos ═════════════════════════════════════════════════════════════════

export interface ExpenseChangesIn {
  proveedor: string | null
  categoria: string | null
  tipo: string | null
  deducible: number | null
  iva_deducible: number | null
  iva: number | null
  irpf: number | null
  fecha: string | null
  descripcion: string | null
  forma_pago: string | null
}

interface ExpenseChangeSet {
  supplierId?: number | null
  /** Proveedor que aún no existe: se crea al ejecutar */
  supplierName?: string
  categoryId?: number | null
  kind?: ExpenseKind
  deductiblePct?: number
  vatDeductiblePct?: number
  vatRate?: number
  irpfRate?: number
  issueDate?: string
  description?: string
  paymentMethod?: Pay
}

const expenseLabel = (r: { supplier: string | null, description: string | null, number: string | null }) =>
  short(r.supplier || r.description || (r.number ? `Factura ${r.number}` : 'Gasto'), 70)
const expenseRow = (r: ExpenseTarget, extra: Partial<AiActionRow> = {}): AiActionRow => ({
  id: r.id,
  label: expenseLabel(r),
  sub: [fd(r.issueDate), r.supplier && r.description && r.description !== r.category ? short(r.description, 50) : null, r.category].filter(Boolean).join(' · '),
  amount: r.total,
  url: `/gastos?ver=${r.id}`,
  ...extra,
})

export async function planExpenses(ctx: OpCtx, accion: string, rawFilter: unknown, cambios: ExpenseChangesIn): Promise<OpPlan> {
  const f = cleanFilter(rawFilter)
  requireScope(f, 'gastos')
  const { rows: found, matched } = await expenseTargets(ctx.company, f)
  if (!found.length) throw new OpError('No hay gastos que coincidan con ese filtro', { proveedores_coincidentes: matched })
  tooMany(found.length, 'gastos')
  const scope = f.nombres && matched.length ? `Proveedores: ${names(matched, 5)}` : null
  const n = (k: number) => count(k, 'gasto', 'gastos')

  if (accion === 'eliminar') {
    const bt = tables.bankTransactions
    const [linked] = await useDb().select({ n: sql<number>`COUNT(*)`.mapWith(Number) }).from(bt)
      .where(and(eq(bt.companyId, ctx.company.id), inArray(bt.expenseId, found.map(r => r.id))))
    const withFile = found.filter(r => r.fileId).length
    return {
      kind: 'gastos.eliminar',
      title: `Eliminar ${n(found.length)}`,
      risk: 'high',
      params: { ids: found.map(r => r.id), labels: labelsOf(found.map(r => ({ id: r.id, label: expenseLabel(r) }))) },
      preview: preview(found.map(r => expenseRow(r)), {
        scope,
        total: sum(found.map(r => r.total)),
        undoable: false,
        warnings: [
          'Se borran definitivamente, con su desglose de IVA y sus pagos.',
          linked?.n ? `${count(linked.n, 'movimiento del banco estaba conciliado', 'movimientos del banco estaban conciliados')} con estos gastos: ${linked.n === 1 ? 'vuelve' : 'vuelven'} a pendientes.` : '',
          withFile ? `${count(withFile, 'tiene', 'tienen')} documento (PDF o foto), que también se borra.` : '',
        ].filter(Boolean),
      }),
    }
  }

  if (accion === 'marcar_pagados') {
    const open = found.filter(r => r.status !== 'paid')
    if (!open.length) throw new OpError('Todos esos gastos ya están pagados')
    const day = date(cambios.fecha, 'fecha del pago') ?? today()
    const method = payMethod(cambios.forma_pago) ?? 'transfer'
    return {
      kind: 'gastos.pagar',
      title: `Marcar como ${open.length === 1 ? 'pagado' : 'pagados'} ${n(open.length)}`,
      risk: 'normal',
      params: { ids: open.map(r => r.id), labels: labelsOf(open.map(r => ({ id: r.id, label: expenseLabel(r) }))), date: day, method },
      preview: preview(open.map(r => expenseRow(r, { amount: round2(r.total - r.paidTotal), before: 'Pendiente', after: 'Pagado' })), {
        scope,
        change: `Pago de lo pendiente el ${fd(day)} por ${PAY_TEXT[method]}`,
        total: sum(open.map(r => r.total - r.paidTotal)),
        undoable: true,
        warnings: found.length > open.length ? [`${count(found.length - open.length, 'ya estaba pagado y no se toca', 'ya estaban pagados y no se tocan')}.`] : [],
      }),
    }
  }

  if (accion !== 'modificar') throw new OpError(`Acción desconocida: ${accion}`)

  const ch: ExpenseChangeSet = {}
  const parts: string[] = []
  const warnings: string[] = []
  let supplierName: string | null = null
  if (cambios.proveedor?.trim()) {
    const supplier = await resolveContact(ctx.company.id, cambios.proveedor, 'supplier').catch((err: unknown) => {
      if (err instanceof OpError && err.data.candidatos) throw err
      return null
    })
    supplierName = supplier?.name ?? cambios.proveedor.trim().slice(0, 200)
    if (supplier) ch.supplierId = supplier.id
    else {
      ch.supplierName = supplierName
      warnings.push(`No existe el proveedor «${supplierName}»: se creará.`)
    }
    parts.push(`proveedor ${supplierName}`)
  }
  let categoryName: string | null = null
  if (cambios.categoria?.trim()) {
    const cat = await resolveExpenseCategory(ctx.company.id, cambios.categoria)
    ch.categoryId = cat?.id ?? null
    categoryName = cat?.name ?? 'Sin categoría'
    parts.push(cat ? `categoría ${cat.name}` : 'sin categoría')
  }
  if (cambios.tipo) {
    const kind = EXPENSE_KIND_BY_ES[cambios.tipo]
    if (!kind) throw new OpError('Tipo de gasto no válido')
    ch.kind = kind
    parts.push(`tipo ${EXPENSE_KIND_TEXT[kind]}`)
  }
  ch.deductiblePct = checkRange(cambios.deducible, 0, 100, 'el porcentaje deducible')
  ch.vatDeductiblePct = checkRange(cambios.iva_deducible, 0, 100, 'el porcentaje de IVA deducible') ?? ch.deductiblePct
  if (ch.deductiblePct != null) parts.push(`deducible ${pctText(ch.deductiblePct)}${ch.vatDeductiblePct !== ch.deductiblePct ? ` (IVA ${pctText(ch.vatDeductiblePct!)})` : ''}`)
  else if (ch.vatDeductiblePct != null) parts.push(`IVA deducible ${pctText(ch.vatDeductiblePct)}`)
  if (cambios.iva != null) {
    if (!VALID_VAT.has(cambios.iva)) throw new OpError('Tipo de IVA no válido: 21, 10, 5, 4 o 0')
    ch.vatRate = cambios.iva
    parts.push(`IVA del ${pctText(cambios.iva)}`)
    warnings.push('Se mantiene el total pagado y se recalculan la base y el IVA.')
  }
  ch.irpfRate = checkRange(cambios.irpf, 0, 50, 'el porcentaje de retención')
  if (ch.irpfRate != null) {
    parts.push(ch.irpfRate ? `retención del ${pctText(ch.irpfRate)}` : 'sin retención')
    if (ch.vatRate == null) warnings.push('Se mantiene la base y cambia el total a pagar.')
  }
  ch.issueDate = date(cambios.fecha, 'fecha')
  if (ch.issueDate) parts.push(`fecha ${fd(ch.issueDate)}`)
  if (cambios.descripcion?.trim()) {
    ch.description = cambios.descripcion.trim().slice(0, 255)
    parts.push('descripción nueva')
  }
  ch.paymentMethod = payMethod(cambios.forma_pago)
  if (ch.paymentMethod) parts.push(`pago por ${PAY_TEXT[ch.paymentMethod]}`)
  for (const k of Object.keys(ch) as Array<keyof ExpenseChangeSet>) if (ch[k] === undefined) delete ch[k]
  if (!Object.keys(ch).length) throw new OpError('Indica qué quieres cambiar')

  // Gastos con varios tipos de IVA: el cambio de IVA se hace a mano
  let multi = new Set<number>()
  if (ch.vatRate != null) {
    const tl = tables.expenseTaxLines
    const counts = await useDb().select({ id: tl.expenseId, n: sql<number>`COUNT(*)`.mapWith(Number) }).from(tl)
      .where(inArray(tl.expenseId, found.map(r => r.id))).groupBy(tl.expenseId)
    multi = new Set(counts.filter(x => x.n > 1).map(x => x.id))
  }
  const rows: AiActionRow[] = []
  const targets: ExpenseTarget[] = []
  let unchanged = 0
  for (const r of found) {
    if (multi.has(r.id)) continue
    const same = (ch.supplierId === undefined || r.supplierId === ch.supplierId) && !ch.supplierName
      && (ch.categoryId === undefined || r.categoryId === ch.categoryId)
      && (!ch.kind || r.kind === ch.kind)
      && (ch.deductiblePct == null || r.deductiblePct === ch.deductiblePct)
      && (ch.vatDeductiblePct == null || r.vatDeductiblePct === ch.vatDeductiblePct)
      && (ch.irpfRate == null || r.irpfRate === ch.irpfRate)
      && (!ch.issueDate || r.issueDate === ch.issueDate)
      && ch.vatRate == null && !ch.description && !ch.paymentMethod
    if (same) {
      unchanged++
      continue
    }
    targets.push(r)
    const extra: Partial<AiActionRow> = ch.supplierId !== undefined || ch.supplierName ? { before: r.supplier ?? 'Sin proveedor', after: supplierName }
      : ch.categoryId !== undefined ? { before: r.category ?? 'Sin categoría', after: categoryName }
        : ch.deductiblePct != null ? { before: `${pctText(r.deductiblePct)} deducible`, after: `${pctText(ch.deductiblePct)} deducible` }
          : ch.vatRate != null ? { before: `IVA ${eurText(r.vatTotal)}`, after: `IVA ${eurText(round2(r.total - r.total / (1 + (ch.vatRate - (ch.irpfRate ?? r.irpfRate)) / 100)))}` }
            : ch.irpfRate != null ? { before: eurText(r.total), after: eurText(round2(r.taxBase + r.vatTotal - pctOf(r.taxBase, ch.irpfRate))) }
              : {}
    rows.push(expenseRow(r, extra))
  }
  if (multi.size) warnings.push(`${count(multi.size, 'tiene', 'tienen')} varios tipos de IVA y no se ${multi.size === 1 ? 'toca' : 'tocan'}: cámbialo a mano.`)
  if (unchanged) warnings.push(`${count(unchanged, 'ya lo tenía y no se toca', 'ya lo tenían y no se tocan')}.`)
  if (!targets.length) throw new OpError('Esos gastos ya lo tienen: no hay nada que cambiar', { avisos: warnings })

  const only = Object.keys(ch).filter(k => k !== 'vatDeductiblePct' || ch.deductiblePct == null)
  const title = only.length === 1 && ch.categoryId !== undefined ? `Cambiar la categoría de ${n(targets.length)}`
    : only.length === 1 && (ch.supplierId !== undefined || ch.supplierName) ? `Cambiar el proveedor de ${n(targets.length)}`
      : only.length === 1 && ch.deductiblePct != null ? `Cambiar la deducibilidad de ${n(targets.length)}`
        : `Modificar ${n(targets.length)}`
  return {
    kind: 'gastos.modificar',
    title,
    risk: 'normal',
    params: { ids: targets.map(r => r.id), labels: labelsOf(targets.map(r => ({ id: r.id, label: expenseLabel(r) }))), changes: ch },
    preview: preview(rows, { scope, change: capital(parts.join(' · ')), total: sum(targets.map(r => r.total)), undoable: true, warnings }),
  }
}

// Columnas de un gasto que guardan las operaciones para poder deshacerlas
const EXPENSE_FIELDS = Object.freeze(['supplierId', 'supplier', 'categoryId', 'kind', 'deductiblePct', 'vatDeductiblePct', 'issueDate', 'description', 'paymentMethod', 'taxBase', 'vatTotal', 'surchargeTotal', 'irpfRate', 'irpfTotal', 'total', 'paidTotal', 'status', 'paidAt', 'notes'] as const)

type ExpenseRow = typeof tables.expenses.$inferSelect
type ExpenseSnapshot = { id: number, row: Partial<ExpenseRow>, lines: Array<{ base: number, vatRate: number, vatAmount: number, surchargeRate: number, surchargeAmount: number }> }

/**
 * Cambia campos de un gasto. Con un IVA nuevo se conserva el total (lo que se pagó) y se recalculan
 * base e IVA; con otra retención se conserva la base. Devuelve cómo estaba.
 */
async function updateExpenseFields(companyId: number, id: number, ch: ExpenseChangeSet): Promise<ExpenseSnapshot> {
  const db = useDb()
  const e = tables.expenses
  const tl = tables.expenseTaxLines
  const [row] = await db.select().from(e).where(and(eq(e.id, id), eq(e.companyId, companyId)))
  if (!row) throw new OpError('Ya no existe')
  const lines = await db.select().from(tl).where(eq(tl.expenseId, id))
  const snapshot: ExpenseSnapshot = {
    id,
    row: Object.fromEntries(EXPENSE_FIELDS.map(k => [k, row[k]])) as Partial<ExpenseRow>,
    lines: lines.map(l => ({ base: l.base, vatRate: l.vatRate, vatAmount: l.vatAmount, surchargeRate: l.surchargeRate, surchargeAmount: l.surchargeAmount })),
  }
  const set: Partial<typeof e.$inferInsert> = {}
  if (ch.supplierId !== undefined) {
    if (ch.supplierId) {
      const c = tables.contacts
      const [contact] = await db.select().from(c).where(and(eq(c.id, ch.supplierId), eq(c.companyId, companyId)))
      if (!contact) throw new OpError('El proveedor ya no existe')
      if (!contact.isSupplier) await db.update(c).set({ isSupplier: true }).where(eq(c.id, contact.id))
      set.supplierId = contact.id
      set.supplier = contactSnapshot(contact)
    }
    else set.supplierId = null
  }
  if (ch.categoryId !== undefined) set.categoryId = ch.categoryId
  if (ch.kind) set.kind = ch.kind
  if (ch.deductiblePct != null) set.deductiblePct = ch.deductiblePct
  if (ch.vatDeductiblePct != null) set.vatDeductiblePct = ch.vatDeductiblePct
  if (ch.issueDate) set.issueDate = ch.issueDate
  if (ch.description) set.description = ch.description
  if (ch.paymentMethod) set.paymentMethod = ch.paymentMethod

  let newLines: ReturnType<typeof expenseTotals>['lines'] | null = null
  if (ch.vatRate != null || (ch.irpfRate != null && ch.irpfRate !== row.irpfRate)) {
    const irpf = ch.irpfRate ?? row.irpfRate
    let taxLines: Array<{ base: number, vatRate: number, vatAmount?: number | null, surchargeRate: number }>
    if (ch.vatRate != null && !(lines.length === 1 && lines[0]!.vatRate === ch.vatRate)) {
      if (lines.length > 1) throw new OpError('Tiene varios tipos de IVA: cámbialo a mano')
      const s = lines[0]?.surchargeRate ?? 0
      const base = round2(row.total / (1 + (ch.vatRate + s - irpf) / 100))
      // La cuota cuadra al céntimo con lo pagado
      const vatAmount = round2(row.total - base - pctOf(base, s) + pctOf(base, irpf))
      taxLines = [{ base, vatRate: ch.vatRate, vatAmount, surchargeRate: s }]
    }
    else {
      taxLines = lines.map(l => ({ base: l.base, vatRate: l.vatRate, vatAmount: l.vatAmount, surchargeRate: l.surchargeRate }))
    }
    if (taxLines.length) {
      const totals = expenseTotals({ taxLines, irpfRate: irpf })
      newLines = totals.lines
      Object.assign(set, { taxBase: totals.taxBase, vatTotal: totals.vatTotal, surchargeTotal: totals.surchargeTotal, irpfRate: irpf, irpfTotal: totals.irpfTotal, total: totals.total })
      if (row.status === 'paid') set.paidTotal = totals.total
      else {
        const full = row.paidTotal > 0 && row.paidTotal >= totals.total - 0.005
        set.status = full ? 'paid' : row.paidTotal > 0 ? 'partial' : 'pending'
        if (full) set.paidAt = new Date()
      }
    }
  }
  if (!Object.keys(set).length && !newLines) return snapshot
  await db.transaction(async (tx) => {
    if (Object.keys(set).length) await tx.update(e).set(set).where(eq(e.id, id))
    if (newLines) {
      await tx.delete(tl).where(eq(tl.expenseId, id))
      await tx.insert(tl).values(newLines.map(l => ({ ...l, expenseId: id })))
    }
  })
  return snapshot
}

async function restoreExpense(companyId: number, snap: ExpenseSnapshot) {
  const db = useDb()
  const e = tables.expenses
  const tl = tables.expenseTaxLines
  const [cur] = await db.select({ id: e.id }).from(e).where(and(eq(e.id, snap.id), eq(e.companyId, companyId)))
  if (!cur) throw new OpError('Ya no existe')
  const row = { ...snap.row, paidAt: snap.row.paidAt ? new Date(snap.row.paidAt) : null }
  await db.transaction(async (tx) => {
    await tx.update(e).set(row).where(eq(e.id, snap.id))
    if (snap.lines.length) {
      await tx.delete(tl).where(eq(tl.expenseId, snap.id))
      await tx.insert(tl).values(snap.lines.map(l => ({ ...l, expenseId: snap.id })))
    }
  })
}

async function expensesModify(ctx: OpCtx, p: { ids: number[], labels: Record<string, string>, changes: ExpenseChangeSet }): Promise<OpOutcome> {
  const t = new Tally(p.labels)
  let ch = p.changes
  if (ch.supplierName && ch.supplierId === undefined) {
    ch = { ...ch, supplierId: await ensureSupplier(ctx.company.id, partyFromName(ch.supplierName), 'Creado desde el asistente') }
  }
  const undo: ExpenseSnapshot[] = []
  for (const id of p.ids) {
    try {
      undo.push(await updateExpenseFields(ctx.company.id, id, ch))
      t.done++
    }
    catch (err) {
      t.skip(id, errText(err))
    }
  }
  return { result: t.result(), undo: { items: undo } }
}

async function expensesModifyRevert(ctx: OpCtx, u: { items: ExpenseSnapshot[] }) {
  const t = new Tally()
  for (const snap of u.items) {
    try {
      await restoreExpense(ctx.company.id, snap)
      t.done++
    }
    catch (err) {
      t.skip(snap.id, errText(err))
    }
  }
  return t.result()
}

async function expensesDelete(ctx: OpCtx, p: { ids: number[], labels: Record<string, string> }): Promise<OpOutcome> {
  const t = new Tally(p.labels)
  const { deleted } = await deleteExpenses(ctx.company.id, p.ids)
  t.done = deleted.length
  const gone = new Set(deleted.map(d => d.id))
  for (const id of p.ids) if (!gone.has(id)) t.skip(id, 'Ya no existía')
  return { result: t.result(), undo: null }
}

type PayUndo = { id: number, paymentId: number, before: { status: ExpenseRow['status'], paidTotal: number, paidAt: string | Date | null, paymentMethod: ExpenseRow['paymentMethod'] } }

async function expensesPay(ctx: OpCtx, p: { ids: number[], labels: Record<string, string>, date: string, method: Pay }): Promise<OpOutcome> {
  const t = new Tally(p.labels)
  const db = useDb()
  const e = tables.expenses
  const undo: PayUndo[] = []
  for (const id of p.ids) {
    try {
      const [row] = await db.select().from(e).where(and(eq(e.id, id), eq(e.companyId, ctx.company.id)))
      if (!row) {
        t.skip(id, 'Ya no existe')
        continue
      }
      if (row.status === 'paid') {
        t.skip(id, 'Ya estaba pagado')
        continue
      }
      const paymentId = await db.transaction(async (tx) => {
        const [res] = await tx.insert(tables.payments).values({
          companyId: ctx.company.id, direction: 'out', expenseId: id, amount: round2(row.total - row.paidTotal), date: p.date, method: p.method, notes: 'Marcado como pagado desde el asistente',
        }).$returningId()
        await tx.update(e).set({ status: 'paid', paidTotal: row.total, paidAt: new Date(`${p.date}T12:00:00`), paymentMethod: row.paymentMethod ?? p.method }).where(eq(e.id, id))
        return res!.id
      })
      undo.push({ id, paymentId, before: { status: row.status, paidTotal: row.paidTotal, paidAt: row.paidAt, paymentMethod: row.paymentMethod } })
      t.done++
    }
    catch (err) {
      t.skip(id, errText(err))
    }
  }
  return { result: t.result(), undo: { items: undo } }
}

async function expensesPayRevert(ctx: OpCtx, u: { items: PayUndo[] }) {
  const t = new Tally()
  const db = useDb()
  const bt = tables.bankTransactions
  for (const item of u.items) {
    try {
      const [row] = await db.select({ id: tables.expenses.id }).from(tables.expenses).where(and(eq(tables.expenses.id, item.id), eq(tables.expenses.companyId, ctx.company.id)))
      if (!row) throw new OpError('Ya no existe')
      await db.transaction(async (tx) => {
        // Si el pago se concilió después con el banco, el movimiento vuelve a pendiente
        await tx.update(bt).set({ status: 'pending', paymentId: null, expenseId: null, ownsPayment: false, matchedAt: null, matchedBy: null })
          .where(and(eq(bt.companyId, ctx.company.id), eq(bt.paymentId, item.paymentId)))
        await tx.delete(tables.payments).where(and(eq(tables.payments.id, item.paymentId), eq(tables.payments.companyId, ctx.company.id)))
        await tx.update(tables.expenses).set({ ...item.before, paidAt: item.before.paidAt ? new Date(item.before.paidAt) : null }).where(eq(tables.expenses.id, item.id))
      })
      t.done++
    }
    catch (err) {
      t.skip(item.id, errText(err))
    }
  }
  return t.result()
}

// ═══ Banco ══════════════════════════════════════════════════════════════════

export interface BankOptionsIn {
  categoria: string | null
  proveedor: string | null
  iva: number | null
  tipo_gasto: string | null
  deducible: number | null
  iva_deducible: number | null
  motivo: string | null
}

type LinkedExpense = { id: number, category: string | null, categoryId: number | null, supplier: string | null, fromBank: boolean }

async function linkedExpenses(companyId: number, txs: BankTx[]) {
  const ids = [...new Set(txs.map(t => t.expenseId).filter((x): x is number => x != null))]
  const map = new Map<number, LinkedExpense>()
  if (!ids.length) return map
  const e = tables.expenses
  const k = tables.categories
  const rows = await useDb().select({ id: e.id, categoryId: e.categoryId, category: k.name, supplier: e.supplier, notes: e.notes, fileId: e.fileId })
    .from(e).leftJoin(k, eq(k.id, e.categoryId)).where(and(eq(e.companyId, companyId), inArray(e.id, ids)))
  for (const r of rows) {
    map.set(r.id, { id: r.id, category: r.category, categoryId: r.categoryId, supplier: r.supplier?.name ?? null, fromBank: !!r.notes?.startsWith('Creado desde el banco') && !r.fileId })
  }
  return map
}

function txState(tx: BankTx, linked: Map<number, LinkedExpense>) {
  if (tx.status === 'pending') return 'Por revisar'
  if (tx.status === 'ignored') return `Ignorado${tx.ignoreReason ? `: ${tx.ignoreReason}` : ''}`
  if (tx.expenseId) {
    const e = linked.get(tx.expenseId)
    return `Gasto${e?.category ? ` · ${e.category}` : ''}`
  }
  return tx.salesDocumentId ? 'Cobro de factura' : 'Conciliado'
}

const txLabel = (tx: BankTx) => short(tx.description, 80) || 'Movimiento'
const txRow = (tx: BankTx, extra: Partial<AiActionRow> = {}): AiActionRow => ({
  id: tx.id, label: txLabel(tx), sub: [fd(tx.date), tx.counterparty ? short(tx.counterparty, 40) : null].filter(Boolean).join(' · '), amount: tx.amount, url: '/banco', ...extra,
})

export async function planBank(ctx: OpCtx, accion: string, rawFilter: unknown, o: BankOptionsIn): Promise<OpPlan> {
  const f = cleanFilter(rawFilter)
  requireScope(f, 'movimientos')
  let found = await bankTargets(ctx.company, f)
  const texts = [...(f.nombres ?? []), ...(f.texto ? [f.texto] : [])]
  if (!found.length) {
    throw new OpError(`No hay movimientos del banco que coincidan${texts.length ? ` con «${texts.join('», «')}»` : ''}`, { sugerencia: 'Prueba con otra palabra del concepto o del ordenante, o usa listar con entidad movimientos' })
  }
  const linked = await linkedExpenses(ctx.company.id, found)
  const n = (k: number) => count(k, 'movimiento', 'movimientos')
  const scope = texts.length ? `Concepto u ordenante con: ${texts.join(', ')}` : null

  if (accion === 'crear_gasto') {
    const credits = found.filter(t => t.amount >= 0).length
    found = found.filter(t => t.amount < 0)
    if (!found.length) throw new OpError('Esos movimientos son abonos (entradas de dinero): solo los cargos pueden ser gastos')
    tooMany(found.length, 'movimientos')
    if (!o.categoria?.trim()) {
      const all = await useDb().select({ name: tables.categories.name }).from(tables.categories)
        .where(and(eq(tables.categories.companyId, ctx.company.id), eq(tables.categories.kind, 'expense')))
      throw new OpError('Indica la categoría de gasto', { categorias: all.map(c => c.name) })
    }
    const cat = await resolveExpenseCategory(ctx.company.id, o.categoria)
    if (o.iva != null && !VALID_VAT.has(o.iva)) throw new OpError('Tipo de IVA no válido: 21, 10, 5, 4 o 0')
    const noVat = ['640', '642', '626'].includes(cat?.accountCode ?? '')
    const vatRate = o.iva ?? (noVat ? 0 : 21)
    const kind: ExpenseKind = (o.tipo_gasto ? EXPENSE_KIND_BY_ES[o.tipo_gasto] : undefined) ?? (cat?.accountCode === '640' ? 'payroll' : cat?.accountCode === '642' ? 'social_security' : 'ticket')
    const deductiblePct = checkRange(o.deducible, 0, 100, 'el porcentaje deducible') ?? null
    const vatDeductiblePct = checkRange(o.iva_deducible, 0, 100, 'el porcentaje de IVA deducible') ?? deductiblePct
    const supplier = o.proveedor?.trim().slice(0, 200) || null
    const onlyCategory = !supplier && o.iva == null && deductiblePct == null
    let unchanged = 0
    const targets = found.filter((tx) => {
      const e = tx.status === 'matched' && tx.expenseId ? linked.get(tx.expenseId) : undefined
      if (e && onlyCategory && e.categoryId === (cat?.id ?? null)) {
        unchanged++
        return false
      }
      return true
    })
    if (!targets.length) throw new OpError(`Esos cargos ya están como ${cat?.name ?? 'gasto sin categoría'}: no hay nada que cambiar`)
    const withExpense = targets.filter(tx => tx.status === 'matched' && tx.expenseId).length
    const otherMatch = targets.filter(tx => tx.status === 'matched' && !tx.expenseId).length
    const recorded = new Map(targets.filter(tx => tx.status !== 'matched').map(tx => [tx.id, recordedExpense(tx)]).filter((x): x is [number, { kind: 'expense' | 'payment', id: number }] => !!x[1]))
    const maybe = targets.filter(tx => tx.status !== 'matched' && !recorded.has(tx.id) && (tx.suggestion?.kind === 'expense' || tx.suggestion?.kind === 'payment') && tx.suggestion.confidence >= 50).length
    const fallbackName = f.nombres?.length === 1 ? capital(f.nombres[0]!) : null
    return {
      kind: 'banco.gasto',
      title: `Asignar ${count(targets.length, 'cargo', 'cargos')} a ${cat?.name ?? 'gasto sin categoría'}`,
      risk: 'normal',
      params: {
        items: targets.map(tx => ({ id: tx.id, supplier: supplier ?? tx.counterparty?.slice(0, 200) ?? fallbackName, match: recorded.get(tx.id) ?? null })),
        labels: labelsOf(targets.map(tx => ({ id: tx.id, label: `${fd(tx.date)} · ${txLabel(tx)}` }))),
        categoryId: cat?.id ?? null,
        vatRate,
        kind,
        deductiblePct,
        vatDeductiblePct,
      },
      preview: preview(targets.map(tx => txRow(tx, { before: txState(tx, linked), after: `${cat?.name ?? 'Sin categoría'}${recorded.has(tx.id) ? ' · con su gasto ya anotado' : ''}` })), {
        scope,
        change: [supplier, cat?.name ?? 'Sin categoría', `IVA ${pctText(vatRate)} incluido`, deductiblePct != null ? `deducible ${pctText(deductiblePct)}` : null].filter(Boolean).join(' · '),
        total: sum(targets.map(tx => tx.amount)),
        undoable: true,
        warnings: [
          withExpense ? `${count(withExpense, 'ya tenía gasto: se actualiza ese gasto', 'ya tenían gasto: se actualiza ese gasto')} en vez de crear otro.` : '',
          recorded.size ? `${count(recorded.size, 'corresponde', 'corresponden')} a un gasto que ya estaba anotado (su factura): se ${recorded.size === 1 ? 'concilia' : 'concilian'} con él en vez de crear otro, para no duplicarlo.` : '',
          maybe ? `${count(maybe, 'podría corresponder', 'podrían corresponder')} a un gasto ya anotado, pero no está claro: se crea un gasto nuevo. Revísalo en Banco si dudas.` : '',
          otherMatch ? `${count(otherMatch, 'estaba conciliado', 'estaban conciliados')} con otro documento: se deshace esa conciliación.` : '',
          credits ? `${count(credits, 'abono no se toca', 'abonos no se tocan')}: solo los cargos son gastos.` : '',
          unchanged ? `${count(unchanged, 'ya estaba así y no se toca', 'ya estaban así y no se tocan')}.` : '',
        ].filter(Boolean),
      }),
    }
  }

  tooMany(found.length, 'movimientos')
  const labels = labelsOf(found.map(tx => ({ id: tx.id, label: `${fd(tx.date)} · ${txLabel(tx)}` })))
  const fromBank = found.filter(tx => tx.status === 'matched' && tx.ownsPayment && tx.expenseId && linked.get(tx.expenseId)?.fromBank).length
  const withDocs = found.filter(tx => tx.status === 'matched').length - fromBank
  const unmatchWarnings = [
    fromBank ? `${count(fromBank, 'tenía un gasto creado desde el banco: ese gasto se elimina', 'tenían un gasto creado desde el banco: esos gastos se eliminan')}.` : '',
    withDocs ? `${count(withDocs, 'estaba conciliado', 'estaban conciliados')} con una factura o un gasto con documento: el documento se conserva, pero pierde ese cobro o pago.` : '',
  ]

  if (accion === 'ignorar') {
    const reason = o.motivo?.trim().slice(0, 120) || null
    let unchanged = 0
    const targets = found.filter((tx) => {
      if (tx.status === 'ignored' && (tx.ignoreReason ?? null) === reason) {
        unchanged++
        return false
      }
      return true
    })
    if (!targets.length) throw new OpError('Esos movimientos ya están así: no hay nada que cambiar')
    const after = reason ? `Ignorado: ${reason}` : 'Ignorado'
    if (withDocs && reason && /personal|particular|privad/i.test(reason)) {
      unmatchWarnings.push('Si ese gasto tampoco es de la empresa, pídeme después que lo elimine o que lo marque como no deducible.')
    }
    return {
      kind: 'banco.ignorar',
      title: reason ? `Marcar ${n(targets.length)} como «${reason}»` : `Ignorar ${n(targets.length)}`,
      risk: 'normal',
      params: { ids: targets.map(tx => tx.id), labels, reason },
      preview: preview(targets.map(tx => txRow(tx, { before: txState(tx, linked), after })), {
        scope,
        change: reason ? `Revisados sin documento: ${reason}. No cuentan como ingreso ni gasto de la empresa.` : 'Revisados sin documento: no cuentan como ingreso ni gasto de la empresa.',
        total: sum(targets.map(tx => tx.amount)),
        undoable: true,
        warnings: [...unmatchWarnings, unchanged ? `${count(unchanged, 'ya estaba así y no se toca', 'ya estaban así y no se tocan')}.` : ''].filter(Boolean),
      }),
    }
  }

  if (accion === 'deshacer') {
    const targets = found.filter(tx => tx.status !== 'pending')
    if (!targets.length) throw new OpError('Esos movimientos ya están por revisar')
    return {
      kind: 'banco.deshacer',
      title: `Volver a dejar por revisar ${n(targets.length)}`,
      risk: 'normal',
      params: { ids: targets.map(tx => tx.id), labels },
      preview: preview(targets.map(tx => txRow(tx, { before: txState(tx, linked), after: 'Por revisar' })), {
        scope,
        total: sum(targets.map(tx => tx.amount)),
        undoable: true,
        warnings: unmatchWarnings.filter(Boolean),
      }),
    }
  }

  if (accion === 'eliminar') {
    return {
      kind: 'banco.eliminar',
      title: `Eliminar ${n(found.length)} del banco`,
      risk: 'high',
      params: { ids: found.map(tx => tx.id), labels },
      preview: preview(found.map(tx => txRow(tx, { before: txState(tx, linked) })), {
        scope,
        total: sum(found.map(tx => tx.amount)),
        undoable: true,
        warnings: ['Solo se borran los movimientos: los cobros, pagos y gastos a los que estaban unidos se conservan.'],
      }),
    }
  }

  throw new OpError(`Acción desconocida: ${accion}`)
}

type TxSnapshot = {
  id: number
  status: BankTx['status']
  ignoreReason: string | null
  suggestion: BankTx['suggestion']
  expenseId: number | null
  salesDocumentId: number | null
  paymentId: number | null
  ownsPayment: boolean
  /** Gasto creado desde el movimiento (se borra al deshacer la conciliación): con qué datos rehacerlo */
  ownExpense: { kind: ExpenseKind, categoryId: number | null, supplier: string | null, vatRate: number, description: string | null, deductiblePct: number, vatDeductiblePct: number } | null
}

async function loadTxRow(companyId: number, id: number) {
  const t = tables.bankTransactions
  const [tx] = await useDb().select().from(t).where(and(eq(t.id, id), eq(t.companyId, companyId)))
  return tx ?? null
}

async function txSnapshot(tx: BankTx): Promise<TxSnapshot> {
  const snap: TxSnapshot = {
    id: tx.id, status: tx.status, ignoreReason: tx.ignoreReason, suggestion: tx.suggestion, expenseId: tx.expenseId,
    salesDocumentId: tx.salesDocumentId, paymentId: tx.paymentId, ownsPayment: tx.ownsPayment, ownExpense: null,
  }
  if (tx.status === 'matched' && tx.ownsPayment && tx.expenseId) {
    const db = useDb()
    const [e] = await db.select().from(tables.expenses).where(eq(tables.expenses.id, tx.expenseId))
    if (e && e.notes?.startsWith('Creado desde el banco') && !e.fileId) {
      const [line] = await db.select({ vatRate: tables.expenseTaxLines.vatRate }).from(tables.expenseTaxLines).where(eq(tables.expenseTaxLines.expenseId, e.id)).limit(1)
      snap.ownExpense = { kind: e.kind, categoryId: e.categoryId, supplier: e.supplier?.name ?? null, vatRate: line?.vatRate ?? 0, description: e.description, deductiblePct: e.deductiblePct, vatDeductiblePct: e.vatDeductiblePct }
    }
  }
  return snap
}

/** Deja un movimiento como estaba: por revisar, ignorado o conciliado con lo mismo que antes */
async function restoreTx(ctx: OpCtx, snap: TxSnapshot) {
  const db = useDb()
  const t = tables.bankTransactions
  const tx = await loadTxRow(ctx.company.id, snap.id)
  if (!tx) throw new OpError('El movimiento ya no existe')
  if (tx.status === 'matched') await unmatch(ctx.company, tx.id, { suggest: false })
  if (snap.status === 'pending') {
    await db.update(t).set({ status: 'pending', ignoreReason: null, matchedAt: null, matchedBy: null, suggestion: snap.suggestion }).where(eq(t.id, tx.id))
    return
  }
  if (snap.status === 'ignored') {
    await db.update(t).set({ status: 'ignored', ignoreReason: snap.ignoreReason, matchedAt: new Date(), matchedBy: ctx.actor.id }).where(eq(t.id, tx.id))
    return
  }
  if (snap.ownExpense) await expenseFromTx(ctx.company, ctx.actor.id, tx.id, snap.ownExpense)
  else if (snap.ownsPayment && snap.salesDocumentId) await confirmMatch(ctx.company, ctx.actor.id, tx.id, { kind: 'invoice', id: snap.salesDocumentId })
  else if (snap.ownsPayment && snap.expenseId) await confirmMatch(ctx.company, ctx.actor.id, tx.id, { kind: 'expense', id: snap.expenseId })
  else if (snap.paymentId) await confirmMatch(ctx.company, ctx.actor.id, tx.id, { kind: 'payment', id: snap.paymentId })
  else if (snap.expenseId) await confirmMatch(ctx.company, ctx.actor.id, tx.id, { kind: 'expense', id: snap.expenseId })
}

type BankUndo = { type: 'tx', snap: TxSnapshot }
  | { type: 'expense', snap: ExpenseSnapshot }
  | { type: 'match', snap: TxSnapshot, expense: ExpenseSnapshot, payments: Array<{ id: number, bankAccountId: number | null }> }

/** Gasto ya anotado que la conciliación propone con seguridad para un cargo: se concilia en vez de duplicarlo */
function recordedExpense(tx: BankTx): { kind: 'expense' | 'payment', id: number } | null {
  const s = tx.suggestion
  return s && (s.kind === 'expense' || s.kind === 'payment') && s.id && s.confidence >= 70 ? { kind: s.kind, id: s.id } : null
}

async function bankExpense(ctx: OpCtx, p: { items: Array<{ id: number, supplier: string | null, match?: { kind: 'expense' | 'payment', id: number } | null }>, labels: Record<string, string>, categoryId: number | null, vatRate: number, kind: ExpenseKind, deductiblePct: number | null, vatDeductiblePct: number | null }): Promise<OpOutcome> {
  const t = new Tally(p.labels)
  const undo: BankUndo[] = []
  for (const item of p.items) {
    try {
      const tx = await loadTxRow(ctx.company.id, item.id)
      if (!tx) {
        t.skip(item.id, 'Ya no existe')
        continue
      }
      if (tx.amount >= 0) {
        t.skip(item.id, 'Es un abono')
        continue
      }
      if (item.match && tx.status !== 'matched') {
        // Su factura ya está anotada: se concilia con ella y se le pone la categoría
        const db = useDb()
        const expenseId = item.match.kind === 'expense'
          ? item.match.id
          : (await db.select({ e: tables.payments.expenseId }).from(tables.payments).where(and(eq(tables.payments.id, item.match.id), eq(tables.payments.companyId, ctx.company.id))))[0]?.e
        if (!expenseId) throw new OpError('El gasto anotado ya no existe')
        const snap = await txSnapshot(tx)
        const expense = await updateExpenseFields(ctx.company.id, expenseId, {})
        const payments = await db.select({ id: tables.payments.id, bankAccountId: tables.payments.bankAccountId }).from(tables.payments).where(eq(tables.payments.expenseId, expenseId))
        await confirmMatch(ctx.company, ctx.actor.id, tx.id, item.match)
        const ch: ExpenseChangeSet = { categoryId: p.categoryId }
        if (p.deductiblePct != null) Object.assign(ch, { deductiblePct: p.deductiblePct, vatDeductiblePct: p.vatDeductiblePct ?? p.deductiblePct })
        await updateExpenseFields(ctx.company.id, expenseId, ch)
        undo.push({ type: 'match', snap, expense, payments })
      }
      else if (tx.status === 'matched' && tx.expenseId) {
        // Ya tiene gasto: se actualiza ese gasto. Si tiene factura o ticket, solo su categoría y deducibilidad
        const e = (await linkedExpenses(ctx.company.id, [tx])).get(tx.expenseId)
        const own = !!e?.fromBank
        const ch: ExpenseChangeSet = { categoryId: p.categoryId }
        if (p.deductiblePct != null) Object.assign(ch, { deductiblePct: p.deductiblePct, vatDeductiblePct: p.vatDeductiblePct ?? p.deductiblePct })
        if (own) {
          Object.assign(ch, { kind: p.kind, vatRate: p.vatRate })
          if (item.supplier) ch.supplierId = await ensureSupplier(ctx.company.id, partyFromName(item.supplier), 'Creado desde el asistente')
        }
        undo.push({ type: 'expense', snap: await updateExpenseFields(ctx.company.id, tx.expenseId, ch) })
      }
      else {
        const snap = await txSnapshot(tx)
        if (tx.status === 'matched') await unmatch(ctx.company, tx.id, { suggest: false })
        await expenseFromTx(ctx.company, ctx.actor.id, tx.id, {
          kind: p.kind, categoryId: p.categoryId, supplier: item.supplier, vatRate: p.vatRate, description: null, deductiblePct: p.deductiblePct, vatDeductiblePct: p.vatDeductiblePct,
        })
        undo.push({ type: 'tx', snap })
      }
      t.done++
    }
    catch (err) {
      t.skip(item.id, errText(err))
    }
  }
  return { result: t.result({ url: '/banco' }), undo: { items: undo } }
}

async function bankRevert(ctx: OpCtx, u: { items: BankUndo[] }) {
  const t = new Tally()
  for (const item of [...u.items].reverse()) {
    try {
      if (item.type === 'expense') await restoreExpense(ctx.company.id, item.snap)
      else if (item.type === 'match') {
        // Primero se deshace la conciliación y después el gasto vuelve a como estaba, con sus pagos
        await restoreTx(ctx, item.snap)
        await restoreExpense(ctx.company.id, item.expense)
        for (const pay of item.payments) {
          await useDb().update(tables.payments).set({ bankAccountId: pay.bankAccountId }).where(and(eq(tables.payments.id, pay.id), eq(tables.payments.companyId, ctx.company.id)))
        }
      }
      else await restoreTx(ctx, item.snap)
      t.done++
    }
    catch (err) {
      t.skip(item.snap.id, errText(err))
    }
  }
  return t.result()
}

async function bankIgnore(ctx: OpCtx, p: { ids: number[], labels: Record<string, string>, reason: string | null }): Promise<OpOutcome> {
  const t = new Tally(p.labels)
  const db = useDb()
  const bt = tables.bankTransactions
  const undo: BankUndo[] = []
  for (const id of p.ids) {
    try {
      const tx = await loadTxRow(ctx.company.id, id)
      if (!tx) {
        t.skip(id, 'Ya no existe')
        continue
      }
      const snap = await txSnapshot(tx)
      if (tx.status === 'matched') await unmatch(ctx.company, tx.id, { suggest: false })
      await db.update(bt).set({ status: 'ignored', ignoreReason: p.reason, matchedAt: new Date(), matchedBy: ctx.actor.id }).where(eq(bt.id, tx.id))
      undo.push({ type: 'tx', snap })
      t.done++
    }
    catch (err) {
      t.skip(id, errText(err))
    }
  }
  return { result: t.result({ url: '/banco' }), undo: { items: undo } }
}

async function bankReset(ctx: OpCtx, p: { ids: number[], labels: Record<string, string> }): Promise<OpOutcome> {
  const t = new Tally(p.labels)
  const db = useDb()
  const bt = tables.bankTransactions
  const undo: BankUndo[] = []
  const reset: number[] = []
  for (const id of p.ids) {
    try {
      const tx = await loadTxRow(ctx.company.id, id)
      if (!tx) {
        t.skip(id, 'Ya no existe')
        continue
      }
      if (tx.status === 'pending') {
        t.skip(id, 'Ya estaba por revisar')
        continue
      }
      const snap = await txSnapshot(tx)
      if (tx.status === 'matched') await unmatch(ctx.company, tx.id, { suggest: false })
      else await db.update(bt).set({ status: 'pending', ignoreReason: null, matchedAt: null, matchedBy: null }).where(eq(bt.id, tx.id))
      undo.push({ type: 'tx', snap })
      reset.push(id)
      t.done++
    }
    catch (err) {
      t.skip(id, errText(err))
    }
  }
  if (reset.length) await suggestMatches(ctx.company, reset).catch(() => {})
  return { result: t.result({ url: '/banco' }), undo: { items: undo } }
}

async function bankDelete(ctx: OpCtx, p: { ids: number[], labels: Record<string, string> }): Promise<OpOutcome> {
  const t = new Tally(p.labels)
  const bt = tables.bankTransactions
  const rows = await useDb().select().from(bt).where(and(eq(bt.companyId, ctx.company.id), inArray(bt.id, p.ids)))
  if (rows.length) await useDb().delete(bt).where(and(eq(bt.companyId, ctx.company.id), inArray(bt.id, rows.map(r => r.id))))
  t.done = rows.length
  const gone = new Set(rows.map(r => r.id))
  for (const id of p.ids) if (!gone.has(id)) t.skip(id, 'Ya no existía')
  return { result: t.result({ url: '/banco' }), undo: { rows } }
}

async function bankDeleteRevert(ctx: OpCtx, u: { rows: BankTx[] }) {
  const t = new Tally()
  const bt = tables.bankTransactions
  for (const r of u.rows) {
    try {
      if (r.companyId !== ctx.company.id) throw new OpError('No es de esta empresa')
      await useDb().insert(bt).values({
        ...r,
        matchedAt: r.matchedAt ? new Date(r.matchedAt) : null,
        createdAt: new Date(r.createdAt),
      })
      t.done++
    }
    catch (err) {
      t.skip(r.id, /duplicate/i.test(errText(err)) ? 'Ya se había vuelto a importar' : errText(err))
    }
  }
  return t.result()
}

// ═══ Clientes y proveedores ══════════════════════════════════════════════════

export interface ContactChangesIn {
  nombre: string | null
  nombre_comercial: string | null
  nif: string | null
  email: string | null
  telefono: string | null
  direccion: string | null
  cp: string | null
  ciudad: string | null
  provincia: string | null
  pais: string | null
  iban: string | null
  dias_pago: number | null
  irpf: number | null
  recargo_equivalencia: boolean | null
  es_cliente: boolean | null
  es_proveedor: boolean | null
  categoria_gasto: string | null
  notas: string | null
}

type ContactSet = Partial<Pick<Contact, 'name' | 'tradeName' | 'nif' | 'email' | 'phone' | 'address' | 'postalCode' | 'city' | 'province' | 'country' | 'iban' | 'paymentTermsDays' | 'irpfRate' | 'equivalenceSurcharge' | 'isClient' | 'isSupplier' | 'defaultCategoryId' | 'notes'>>

const CONTACT_FIELD_TEXT: Readonly<Record<string, string>> = Object.freeze({
  name: 'nombre', tradeName: 'nombre comercial', nif: 'NIF', email: 'email', phone: 'teléfono', address: 'dirección', postalCode: 'código postal',
  city: 'ciudad', province: 'provincia', country: 'país', iban: 'IBAN', paymentTermsDays: 'días de pago', irpfRate: 'retención',
  equivalenceSurcharge: 'recargo de equivalencia', isClient: 'cliente', isSupplier: 'proveedor', defaultCategoryId: 'categoría de gasto', notes: 'notas',
})

function contactValue(k: string, v: unknown, categories: Map<number, string>) {
  if (v == null || v === '') return '—'
  if (k === 'irpfRate') return pctText(Number(v))
  if (k === 'paymentTermsDays') return `${v} días`
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  if (k === 'defaultCategoryId') return categories.get(Number(v)) ?? '—'
  return short(String(v), 40)
}

const contactUrl = (c: Pick<Contact, 'id' | 'isClient'>) => (c.isClient ? `/clientes/${c.id}` : `/proveedores/${c.id}`)
const contactRole = (c: Pick<Contact, 'isClient' | 'isSupplier'>) => (c.isClient && c.isSupplier ? 'Cliente y proveedor' : c.isClient ? 'Cliente' : 'Proveedor')

export async function planContacts(ctx: OpCtx, accion: string, rawFilter: unknown, cambios: ContactChangesIn): Promise<OpPlan> {
  const f = cleanFilter(rawFilter)
  requireScope(f, 'contactos')
  const found = await contactTargets(ctx.company, f)
  if (!found.length) throw new OpError('No hay clientes ni proveedores que coincidan con ese filtro')
  tooMany(found.length, 'contactos')
  const n = (k: number) => count(k, 'contacto', 'contactos')
  const labels = labelsOf(found.map(c => ({ id: c.id, label: c.name })))
  const row = (c: Contact, extra: Partial<AiActionRow> = {}): AiActionRow => ({ id: c.id, label: c.name, sub: [contactRole(c), c.nif].filter(Boolean).join(' · '), url: contactUrl(c), ...extra })

  if (accion === 'eliminar') {
    const ids = found.map(c => c.id)
    const db = useDb()
    const [[sales], [exps]] = await Promise.all([
      db.select({ n: sql<number>`COUNT(*)`.mapWith(Number) }).from(tables.salesDocuments).where(and(eq(tables.salesDocuments.companyId, ctx.company.id), inArray(tables.salesDocuments.contactId, ids))),
      db.select({ n: sql<number>`COUNT(*)`.mapWith(Number) }).from(tables.expenses).where(and(eq(tables.expenses.companyId, ctx.company.id), inArray(tables.expenses.supplierId, ids))),
    ])
    const docs = [sales?.n ? count(sales.n, 'factura o presupuesto', 'facturas y presupuestos') : '', exps?.n ? count(exps.n, 'gasto', 'gastos') : ''].filter(Boolean)
    return {
      kind: 'contactos.eliminar',
      title: found.length === 1 ? `Eliminar «${found[0]!.name}»` : `Eliminar ${n(found.length)}`,
      risk: 'high',
      params: { ids, labels },
      preview: preview(found.map(c => row(c)), {
        undoable: false,
        warnings: [
          'Se borran definitivamente sus fichas.',
          docs.length ? `Sus ${docs.join(' y ')} se conservan con los datos del contacto, solo pierden el enlace a la ficha.` : '',
        ].filter(Boolean),
      }),
    }
  }

  if (accion !== 'modificar') throw new OpError(`Acción desconocida: ${accion}`)

  const set: ContactSet = {}
  const text = (v: string | null, max: number) => (v != null && v.trim() ? v.trim().slice(0, max) : undefined)
  if (found.length > 1 && (cambios.nombre || cambios.nif || cambios.email || cambios.iban)) {
    throw new OpError('El nombre, el NIF, el email y el IBAN se cambian de uno en uno: concreta el contacto')
  }
  set.name = text(cambios.nombre, 200)
  set.tradeName = text(cambios.nombre_comercial, 200)
  if (cambios.nif?.trim()) {
    const nif = normalizeNif(cambios.nif)
    if (!validateNif(nif).valid && !looksLikeEuVat(nif)) throw new OpError(`El NIF «${cambios.nif}» no es válido: revisa la letra de control`)
    set.nif = nif
  }
  if (cambios.email?.trim()) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cambios.email.trim())) throw new OpError('Email no válido')
    set.email = cambios.email.trim().toLowerCase().slice(0, 191)
  }
  set.phone = text(cambios.telefono, 40)
  set.address = text(cambios.direccion, 255)
  set.postalCode = text(cambios.cp, 10)
  set.city = text(cambios.ciudad, 120)
  set.province = text(cambios.provincia, 120)
  if (cambios.pais?.trim()) {
    if (!/^[a-z]{2}$/i.test(cambios.pais.trim())) throw new OpError('El país va con su código de dos letras (ES, FR, PT…)')
    set.country = cambios.pais.trim().toUpperCase()
  }
  if (cambios.iban?.trim()) set.iban = cambios.iban.replace(/\s/g, '').toUpperCase().slice(0, 34)
  if (cambios.dias_pago != null) set.paymentTermsDays = Math.round(checkRange(cambios.dias_pago, 0, 365, 'los días de pago')!)
  if (cambios.irpf != null) set.irpfRate = checkRange(cambios.irpf, 0, 50, 'el porcentaje de retención')!
  if (cambios.recargo_equivalencia != null) set.equivalenceSurcharge = cambios.recargo_equivalencia
  if (cambios.es_cliente != null) set.isClient = cambios.es_cliente
  if (cambios.es_proveedor != null) set.isSupplier = cambios.es_proveedor
  const categories = new Map<number, string>()
  if (cambios.categoria_gasto?.trim()) {
    const cat = await resolveExpenseCategory(ctx.company.id, cambios.categoria_gasto)
    set.defaultCategoryId = cat?.id ?? null
    if (cat) categories.set(cat.id, cat.name)
  }
  set.notes = text(cambios.notas, 5000)
  for (const k of Object.keys(set) as Array<keyof ContactSet>) if (set[k] === undefined) delete set[k]
  const keys = Object.keys(set) as Array<keyof ContactSet>
  if (!keys.length) throw new OpError('Indica qué quieres cambiar')
  if (set.isClient === false && set.isSupplier === false) throw new OpError('Un contacto tiene que ser cliente, proveedor o ambos')

  const all = await useDb().select({ id: tables.categories.id, name: tables.categories.name }).from(tables.categories).where(eq(tables.categories.companyId, ctx.company.id))
  for (const c of all) categories.set(c.id, c.name)
  const targets = found.filter(c => keys.some(k => c[k] !== set[k]))
  if (!targets.length) throw new OpError('Ya lo tienen así: no hay nada que cambiar')
  const k0 = keys[0]!
  const change = keys.map(k => `${CONTACT_FIELD_TEXT[k]}: ${contactValue(k, set[k], categories)}`).join(' · ')
  return {
    kind: 'contactos.modificar',
    title: targets.length === 1 ? `Modificar «${targets[0]!.name}»` : `Modificar ${n(targets.length)}`,
    risk: 'normal',
    params: { ids: targets.map(c => c.id), labels, set },
    preview: preview(targets.map(c => row(c, { before: contactValue(k0, c[k0], categories), after: contactValue(k0, set[k0], categories) })), {
      change: capital(change),
      undoable: true,
      warnings: [
        set.irpfRate != null || set.equivalenceSurcharge != null || set.paymentTermsDays != null ? 'Se aplica a las facturas nuevas: las que ya existen no cambian.' : '',
        found.length > targets.length ? `${count(found.length - targets.length, 'ya lo tenía y no se toca', 'ya lo tenían y no se tocan')}.` : '',
      ].filter(Boolean),
    }),
  }
}

async function contactsModify(ctx: OpCtx, p: { ids: number[], labels: Record<string, string>, set: ContactSet }): Promise<OpOutcome> {
  const t = new Tally(p.labels)
  const db = useDb()
  const c = tables.contacts
  const keys = Object.keys(p.set) as Array<keyof ContactSet>
  const undo: Array<{ id: number, before: ContactSet }> = []
  for (const id of p.ids) {
    try {
      const [row] = await db.select().from(c).where(and(eq(c.id, id), eq(c.companyId, ctx.company.id)))
      if (!row) {
        t.skip(id, 'Ya no existe')
        continue
      }
      if ((p.set.isClient ?? row.isClient) === false && (p.set.isSupplier ?? row.isSupplier) === false) {
        t.skip(id, 'Quedaría sin ser cliente ni proveedor')
        continue
      }
      await db.update(c).set(p.set).where(eq(c.id, id))
      undo.push({ id, before: Object.fromEntries(keys.map(k => [k, row[k]])) as ContactSet })
      t.done++
    }
    catch (err) {
      t.skip(id, errText(err))
    }
  }
  return { result: t.result(), undo: { items: undo } }
}

async function contactsModifyRevert(ctx: OpCtx, u: { items: Array<{ id: number, before: ContactSet }> }) {
  const t = new Tally()
  const c = tables.contacts
  for (const item of u.items) {
    try {
      const res = await useDb().update(c).set(item.before).where(and(eq(c.id, item.id), eq(c.companyId, ctx.company.id)))
      if (!res[0].affectedRows) throw new OpError('Ya no existe')
      t.done++
    }
    catch (err) {
      t.skip(item.id, errText(err))
    }
  }
  return t.result()
}

async function contactsDelete(ctx: OpCtx, p: { ids: number[], labels: Record<string, string> }): Promise<OpOutcome> {
  const t = new Tally(p.labels)
  const { deleted } = await deleteContacts(ctx.company.id, p.ids)
  t.done = deleted.length
  const gone = new Set(deleted.map(d => d.id))
  for (const id of p.ids) if (!gone.has(id)) t.skip(id, 'Ya no existía')
  return { result: t.result(), undo: null }
}

// ═══ Productos y servicios ═══════════════════════════════════════════════════

export interface ItemChangesIn {
  nombre: string | null
  precio: number | null
  subir_pct: number | null
  iva: number | null
  categoria: string | null
  tipo: string | null
  unidad: string | null
  descripcion: string | null
}

type ItemRow = typeof tables.items.$inferSelect
type ItemSet = Partial<Pick<ItemRow, 'name' | 'unitPrice' | 'vatRate' | 'categoryId' | 'kind' | 'unit' | 'description'>>

export async function planItems(ctx: OpCtx, accion: string, rawFilter: unknown, cambios: ItemChangesIn): Promise<OpPlan> {
  const f = cleanFilter(rawFilter)
  requireScope(f, 'productos')
  const found = await itemTargets(ctx.company, f)
  if (!found.length) throw new OpError('No hay productos ni servicios que coincidan con ese filtro')
  tooMany(found.length, 'productos')
  const services = found.every(i => i.kind === 'service')
  const n = (k: number) => (services ? count(k, 'servicio', 'servicios') : count(k, 'producto', 'productos'))
  const labels = labelsOf(found.map(i => ({ id: i.id, label: i.name })))
  const row = (i: ItemRow, extra: Partial<AiActionRow> = {}): AiActionRow => ({ id: i.id, label: i.name, sub: [i.kind === 'service' ? 'Servicio' : 'Producto', `IVA ${pctText(i.vatRate)}`].join(' · '), amount: i.unitPrice, url: '/productos', ...extra })

  if (accion === 'eliminar') {
    return {
      kind: 'productos.eliminar',
      title: found.length === 1 ? `Eliminar «${found[0]!.name}»` : `Eliminar ${n(found.length)}`,
      risk: 'high',
      params: { ids: found.map(i => i.id), labels },
      preview: preview(found.map(i => row(i)), {
        undoable: false,
        warnings: ['Se borran del catálogo. Las facturas y presupuestos que los usan conservan concepto, precio e IVA.'],
      }),
    }
  }
  if (accion !== 'modificar') throw new OpError(`Acción desconocida: ${accion}`)

  if (found.length > 1 && cambios.nombre) throw new OpError('El nombre se cambia de uno en uno: concreta el producto')
  if (cambios.precio != null && cambios.subir_pct != null) throw new OpError('Indica un precio nuevo o un porcentaje de subida, no los dos')
  const set: ItemSet = {}
  const parts: string[] = []
  if (cambios.nombre?.trim()) {
    set.name = cambios.nombre.trim().slice(0, 200)
    parts.push(`nombre «${set.name}»`)
  }
  if (cambios.precio != null) {
    set.unitPrice = checkRange(cambios.precio, 0, 99_999_999, 'el precio')!
    parts.push(`precio ${eurText(set.unitPrice)}`)
  }
  const factor = cambios.subir_pct != null ? 1 + checkRange(cambios.subir_pct, -90, 500, 'el porcentaje')! / 100 : null
  if (factor) parts.push(`precio ${cambios.subir_pct! >= 0 ? '+' : ''}${pctText(cambios.subir_pct!)}`)
  if (cambios.iva != null) {
    if (!VALID_VAT.has(cambios.iva)) throw new OpError('Tipo de IVA no válido: 21, 10, 5, 4 o 0')
    set.vatRate = cambios.iva
    parts.push(`IVA ${pctText(cambios.iva)}`)
  }
  if (cambios.categoria?.trim()) {
    const cat = await resolveItemCategory(ctx.company.id, cambios.categoria)
    set.categoryId = cat?.id ?? null
    parts.push(cat ? `categoría ${cat.name}` : 'sin categoría')
  }
  if (cambios.tipo === 'servicio' || cambios.tipo === 'producto') {
    set.kind = cambios.tipo === 'servicio' ? 'service' : 'product'
    parts.push(cambios.tipo)
  }
  if (cambios.unidad?.trim()) {
    set.unit = cambios.unidad.trim().slice(0, 20)
    parts.push(`unidad ${set.unit}`)
  }
  if (cambios.descripcion?.trim()) {
    set.description = cambios.descripcion.trim().slice(0, 2000)
    parts.push('descripción nueva')
  }
  if (!parts.length) throw new OpError('Indica qué quieres cambiar')
  const priceOf = (i: ItemRow) => (factor ? round2(i.unitPrice * factor) : set.unitPrice ?? i.unitPrice)
  const targets = found.filter(i => priceOf(i) !== i.unitPrice || (Object.keys(set) as Array<keyof ItemSet>).some(k => k !== 'unitPrice' && i[k] !== set[k]))
  if (!targets.length) throw new OpError('Ya lo tienen así: no hay nada que cambiar')
  const priceChange = factor != null || set.unitPrice != null
  return {
    kind: 'productos.modificar',
    title: targets.length === 1 ? `Modificar «${targets[0]!.name}»` : priceChange && parts.length === 1 ? `Cambiar el precio de ${n(targets.length)}` : `Modificar ${n(targets.length)}`,
    risk: 'normal',
    params: { ids: targets.map(i => i.id), labels, set, factor },
    preview: preview(targets.map(i => row(i, priceChange ? { before: eurText(i.unitPrice), after: eurText(priceOf(i)), amount: priceOf(i) } : {})), {
      change: capital(parts.join(' · ')),
      undoable: true,
      warnings: priceChange || set.vatRate != null ? ['Se aplica a las facturas nuevas: las que ya existen no cambian.'] : [],
    }),
  }
}

async function itemsModify(ctx: OpCtx, p: { ids: number[], labels: Record<string, string>, set: ItemSet, factor: number | null }): Promise<OpOutcome> {
  const t = new Tally(p.labels)
  const db = useDb()
  const i = tables.items
  const undo: Array<{ id: number, before: ItemSet }> = []
  for (const id of p.ids) {
    try {
      const [row] = await db.select().from(i).where(and(eq(i.id, id), eq(i.companyId, ctx.company.id)))
      if (!row) {
        t.skip(id, 'Ya no existe')
        continue
      }
      const set: ItemSet = { ...p.set, ...(p.factor ? { unitPrice: round2(row.unitPrice * p.factor) } : {}) }
      await db.update(i).set(set).where(eq(i.id, id))
      undo.push({ id, before: Object.fromEntries(Object.keys(set).map(k => [k, row[k as keyof ItemSet]])) as ItemSet })
      t.done++
    }
    catch (err) {
      t.skip(id, errText(err))
    }
  }
  return { result: t.result({ url: '/productos' }), undo: { items: undo } }
}

async function itemsModifyRevert(ctx: OpCtx, u: { items: Array<{ id: number, before: ItemSet }> }) {
  const t = new Tally()
  const i = tables.items
  for (const item of u.items) {
    try {
      const res = await useDb().update(i).set(item.before).where(and(eq(i.id, item.id), eq(i.companyId, ctx.company.id)))
      if (!res[0].affectedRows) throw new OpError('Ya no existe')
      t.done++
    }
    catch (err) {
      t.skip(item.id, errText(err))
    }
  }
  return t.result()
}

async function itemsDelete(ctx: OpCtx, p: { ids: number[], labels: Record<string, string> }): Promise<OpOutcome> {
  const t = new Tally(p.labels)
  const { deleted } = await deleteItems(ctx.company.id, p.ids)
  t.done = deleted.length
  const gone = new Set(deleted.map(d => d.id))
  for (const id of p.ids) if (!gone.has(id)) t.skip(id, 'Ya no existía')
  return { result: t.result({ url: '/productos' }), undo: null }
}

// ═══ Altas (se ejecutan al momento y se pueden deshacer) ═════════════════════

export interface NewContactIn {
  nombre: string
  tipo: string
  persona: boolean
  nif: string | null
  email: string | null
  telefono: string | null
  direccion: string | null
  cp: string | null
  ciudad: string | null
  provincia: string | null
  pais: string | null
  irpf: number | null
  dias_pago: number | null
  notas: string | null
}

export async function planNewContact(ctx: OpCtx, a: NewContactIn): Promise<OpPlan> {
  const parsed = contactInputSchema.safeParse({
    isClient: a.tipo !== 'proveedor',
    isSupplier: a.tipo !== 'cliente',
    kind: a.persona ? 'person' : 'company',
    name: a.nombre,
    nif: a.nif,
    nifType: a.nif && !validateNif(a.nif).valid && looksLikeEuVat(a.nif) ? 'vat_eu' : 'nif',
    email: a.email,
    phone: a.telefono,
    address: a.direccion,
    postalCode: a.cp,
    city: a.ciudad,
    province: a.provincia,
    country: a.pais || 'ES',
    irpfRate: a.irpf,
    paymentTermsDays: a.dias_pago,
    notes: a.notas,
  })
  if (!parsed.success) throw new OpError(parsed.error.issues[0]?.message ?? 'Datos no válidos')
  const input = parsed.data
  const existing = contactMatches(await companyContacts(ctx.company.id), input.nif ?? input.name)
    .filter(c => (input.nif && c.nif && normalizeNif(c.nif) === input.nif) || comparableName(c.name) === comparableName(input.name))
  if (existing.length) throw new OpError(`Ya existe «${existing[0]!.name}»`, { contacto: { nombre: existing[0]!.name, nif: existing[0]!.nif, url: contactUrl(existing[0]!) } })
  const role = contactRole(input)
  return {
    kind: 'contactos.crear',
    title: `Crear ${role.toLowerCase()} «${input.name}»`,
    risk: 'normal',
    params: { input },
    preview: preview([{ id: 0, label: input.name, sub: [role, input.nif, input.email].filter(Boolean).join(' · ') }], { undoable: true }),
  }
}

async function contactCreate(ctx: OpCtx, p: { input: ContactInput }): Promise<OpOutcome> {
  const [res] = await useDb().insert(tables.contacts).values({ ...p.input, companyId: ctx.company.id }).$returningId()
  const id = res!.id
  return { result: { done: 1, skipped: [], url: contactUrl({ id, isClient: p.input.isClient }) }, undo: { id } }
}

async function contactCreateRevert(ctx: OpCtx, u: { id: number }) {
  const db = useDb()
  const [[sales], [exps]] = await Promise.all([
    db.select({ n: sql<number>`COUNT(*)`.mapWith(Number) }).from(tables.salesDocuments).where(and(eq(tables.salesDocuments.companyId, ctx.company.id), eq(tables.salesDocuments.contactId, u.id))),
    db.select({ n: sql<number>`COUNT(*)`.mapWith(Number) }).from(tables.expenses).where(and(eq(tables.expenses.companyId, ctx.company.id), eq(tables.expenses.supplierId, u.id))),
  ])
  if ((sales?.n ?? 0) + (exps?.n ?? 0) > 0) return { done: 0, skipped: [{ id: u.id, label: 'Contacto', reason: 'Ya tiene documentos: bórralo desde su ficha si de verdad sobra' }] }
  const { deleted } = await deleteContacts(ctx.company.id, [u.id])
  return { done: deleted.length, skipped: [] }
}

export interface NewItemIn {
  nombre: string
  precio: number
  iva: number | null
  tipo: string | null
  unidad: string | null
  descripcion: string | null
  categoria: string | null
}

export async function planNewItem(ctx: OpCtx, a: NewItemIn): Promise<OpPlan> {
  const cat = a.categoria?.trim() ? await resolveItemCategory(ctx.company.id, a.categoria) : null
  const parsed = itemInputSchema.safeParse({
    kind: a.tipo === 'producto' ? 'product' : 'service',
    name: a.nombre,
    description: a.descripcion,
    unit: a.unidad,
    unitPrice: a.precio,
    vatRate: a.iva ?? (ctx.company.defaultVatRate || 21),
    categoryId: cat?.id ?? null,
  })
  if (!parsed.success) throw new OpError(parsed.error.issues[0]?.message ?? 'Datos no válidos')
  const input = parsed.data
  const items = await useDb().select({ name: tables.items.name }).from(tables.items).where(and(eq(tables.items.companyId, ctx.company.id), sql`${tables.items.archivedAt} IS NULL`))
  if (items.some(i => comparableName(i.name) === comparableName(input.name))) throw new OpError(`Ya existe un producto llamado «${input.name}»`)
  return {
    kind: 'productos.crear',
    title: `Crear ${input.kind === 'service' ? 'el servicio' : 'el producto'} «${input.name}»`,
    risk: 'normal',
    params: { input },
    preview: preview([{ id: 0, label: input.name, sub: `IVA ${pctText(input.vatRate)}${cat ? ` · ${cat.name}` : ''}`, amount: input.unitPrice }], { undoable: true }),
  }
}

async function itemCreate(ctx: OpCtx, p: { input: ItemInputLike }): Promise<OpOutcome> {
  const [res] = await useDb().insert(tables.items).values({ ...p.input, companyId: ctx.company.id }).$returningId()
  return { result: { done: 1, skipped: [], url: '/productos' }, undo: { id: res!.id } }
}

type ItemInputLike = { kind: 'service' | 'product', name: string, description: string | null, sku: string | null, unit: string | null, unitPrice: number, vatRate: number, categoryId?: number | null }

async function itemCreateRevert(ctx: OpCtx, u: { id: number }) {
  const { deleted } = await deleteItems(ctx.company.id, [u.id])
  return { done: deleted.length, skipped: [] }
}

export interface NewExpenseIn {
  proveedor: string | null
  fecha: string | null
  descripcion: string | null
  numero: string | null
  importe: number
  importe_incluye_iva: boolean
  iva: number | null
  irpf: number | null
  categoria: string | null
  tipo: string | null
  pagado: boolean
  forma_pago: string | null
  deducible: number | null
}

export async function planNewExpense(ctx: OpCtx, a: NewExpenseIn): Promise<OpPlan> {
  if (!Number.isFinite(a.importe) || a.importe === 0) throw new OpError('Indica el importe del gasto')
  const vatRate = a.iva ?? 21
  if (!VALID_VAT.has(vatRate)) throw new OpError('Tipo de IVA no válido: 21, 10, 5, 4 o 0')
  const irpfRate = checkRange(a.irpf, 0, 50, 'el porcentaje de retención') ?? 0
  const supplier = a.proveedor?.trim()
    ? await resolveContact(ctx.company.id, a.proveedor, 'supplier').catch((err: unknown) => {
      if (err instanceof OpError && err.data.candidatos) throw err
      return null
    })
    : null
  const cat = a.categoria?.trim() ? await resolveExpenseCategory(ctx.company.id, a.categoria) : undefined
  const base = a.importe_incluye_iva ? round2(a.importe / (1 + vatRate / 100)) : round2(a.importe)
  const vatAmount = a.importe_incluye_iva ? round2(a.importe - base) : null
  const kind = (a.tipo ? EXPENSE_KIND_BY_ES[a.tipo] : undefined) ?? (a.numero ? 'invoice' : 'ticket')
  const deductible = checkRange(a.deducible, 0, 100, 'el porcentaje deducible')
    ?? (await deductibleGuesser(ctx.company.id))({ supplierId: supplier?.id, supplierName: supplier?.name ?? a.proveedor, categoryId: cat?.id }).deductiblePct
  const parsed = expenseInputSchema.safeParse({
    kind,
    supplierId: supplier?.id ?? null,
    newSupplier: !supplier && a.proveedor?.trim() ? partyFromName(a.proveedor) : null,
    number: a.numero,
    issueDate: date(a.fecha, 'fecha') ?? today(),
    categoryId: cat?.id ?? null,
    description: a.descripcion,
    taxLines: [{ base, vatRate, vatAmount, surchargeRate: 0 }],
    irpfRate,
    deductiblePct: deductible,
    vatDeductiblePct: deductible,
    paymentMethod: payMethod(a.forma_pago) ?? null,
    paid: a.pagado,
    notes: 'Creado desde el asistente',
  })
  if (!parsed.success) throw new OpError(parsed.error.issues[0]?.message ?? 'Datos no válidos')
  const input = parsed.data
  const totals = expenseTotals(input)
  const label = supplier?.name ?? a.proveedor?.trim() ?? input.description ?? 'Gasto'
  return {
    kind: 'gastos.crear',
    title: `Anotar un gasto de ${label}`,
    risk: 'normal',
    params: { input },
    preview: preview([{ id: 0, label, sub: [fd(input.issueDate), cat?.name, input.paid ? 'Pagado' : 'Pendiente'].filter(Boolean).join(' · '), amount: totals.total }], {
      change: `Base ${eurText(totals.taxBase)} + IVA ${eurText(totals.vatTotal)}${totals.irpfTotal ? ` − retención ${eurText(totals.irpfTotal)}` : ''}`,
      undoable: true,
      warnings: !supplier && a.proveedor?.trim() ? [`No existe el proveedor «${a.proveedor.trim()}»: se crea.`] : [],
    }),
  }
}

async function expenseCreate(ctx: OpCtx, p: { input: ExpenseInput }): Promise<OpOutcome> {
  const id = await saveExpense(ctx.company.id, ctx.actor.id, p.input)
  return { result: { done: 1, skipped: [], url: `/gastos?ver=${id}` }, undo: { id } }
}

async function expenseCreateRevert(ctx: OpCtx, u: { id: number }) {
  const { deleted } = await deleteExpenses(ctx.company.id, [u.id])
  return { done: deleted.length, skipped: [] }
}

// ═══ Registro ═══════════════════════════════════════════════════════════════

// Los parámetros y el «deshacer» vienen de la propuesta guardada (JSON)
export async function executeOp(ctx: OpCtx, kind: string, params: any): Promise<OpOutcome> {
  switch (kind) {
    case 'ventas.modificar': return salesModify(ctx, params)
    case 'ventas.eliminar': return salesDelete(ctx, params)
    case 'ventas.emitir': return salesIssue(ctx, params)
    case 'ventas.cobrar': return salesCollect(ctx, params)
    case 'ventas.pendiente': return salesUncollect(ctx, params)
    case 'gastos.modificar': return expensesModify(ctx, params)
    case 'gastos.eliminar': return expensesDelete(ctx, params)
    case 'gastos.pagar': return expensesPay(ctx, params)
    case 'gastos.crear': return expenseCreate(ctx, params)
    case 'banco.gasto': return bankExpense(ctx, params)
    case 'banco.ignorar': return bankIgnore(ctx, params)
    case 'banco.deshacer': return bankReset(ctx, params)
    case 'banco.eliminar': return bankDelete(ctx, params)
    case 'contactos.modificar': return contactsModify(ctx, params)
    case 'contactos.eliminar': return contactsDelete(ctx, params)
    case 'contactos.crear': return contactCreate(ctx, params)
    case 'productos.modificar': return itemsModify(ctx, params)
    case 'productos.eliminar': return itemsDelete(ctx, params)
    case 'productos.crear': return itemCreate(ctx, params)
    default: throw new OpError(`Operación desconocida: ${kind}`)
  }
}

export async function revertOp(ctx: OpCtx, kind: string, undo: any): Promise<AiActionResult> {
  switch (kind) {
    case 'ventas.modificar': return salesModifyRevert(ctx, undo)
    case 'ventas.cobrar': return salesCollectRevert(ctx, undo)
    case 'ventas.pendiente': return salesUncollectRevert(ctx, undo)
    case 'gastos.modificar': return expensesModifyRevert(ctx, undo)
    case 'gastos.pagar': return expensesPayRevert(ctx, undo)
    case 'gastos.crear': return expenseCreateRevert(ctx, undo)
    case 'banco.gasto':
    case 'banco.ignorar':
    case 'banco.deshacer': return bankRevert(ctx, undo)
    case 'banco.eliminar': return bankDeleteRevert(ctx, undo)
    case 'contactos.modificar': return contactsModifyRevert(ctx, undo)
    case 'contactos.crear': return contactCreateRevert(ctx, undo)
    case 'productos.modificar': return itemsModifyRevert(ctx, undo)
    case 'productos.crear': return itemCreateRevert(ctx, undo)
    default: throw new OpError('Esta operación no se puede deshacer')
  }
}
