import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { PartySnapshot, SalesStatus } from '../db/schema'
import type { RichDoc } from '../../shared/utils/rich'
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

const MAX_AMOUNT = 99_999_999
const round4 = (n: number) => Math.round(n * 10000) / 10000

/** Un importe en euros (base, total, cuota): a céntimos */
function amount(v: number, what: string) {
  if (!Number.isFinite(v) || Math.abs(v) > MAX_AMOUNT) throw new OpError(`${capital(what)} no es un importe válido`)
  return round2(v)
}

/** Un precio unitario: hasta 4 decimales, como en las líneas de factura */
function price(v: number) {
  if (!Number.isFinite(v) || Math.abs(v) > MAX_AMOUNT) throw new OpError('El precio no es un importe válido')
  return round4(v)
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

export interface SalesLineOpIn {
  accion: string
  buscar: string | null
  concepto: string | null
  cantidad: number | null
  precio: number | null
  iva: number | null
  descuento: number | null
}

export interface SalesChangesIn {
  cliente: string | null
  irpf: number | null
  iva: number | null
  fecha: string | null
  vencimiento: string | null
  fecha_operacion: string | null
  forma_pago: string | null
  notas: string | null
  condiciones: string | null
  referencia: string | null
  descripcion: string | null
  descuento: number | null
  base: number | null
  total: number | null
  lineas: SalesLineOpIn[] | null
  vaciar: string[] | null
}

/** Cambio de líneas: añadir una, cambiar las que encajan con `match` (todas si es null) o quitarlas */
type LineOp = { op: 'add' | 'edit' | 'remove', match: string | null, description?: string, quantity?: number, unitPrice?: number, vatRate?: number, discountPct?: number, itemId?: number | null }

interface SalesChangeSet {
  contactId?: number
  irpfRate?: number
  vatRate?: number
  issueDate?: string
  dueDate?: string | null
  operationDate?: string | null
  paymentMethod?: Pay
  notes?: string | null
  terms?: string | null
  customerReference?: string | null
  description?: RichDoc | null
  discountPct?: number
  /** Base o total al que se ajustan los precios */
  taxBase?: number
  total?: number
  lineOps?: LineOp[]
}

type SalesLine = SalesInput['lines'][number]

const SALES_CLEAR: Readonly<Record<string, 'notes' | 'terms' | 'customerReference' | 'dueDate' | 'operationDate' | 'description'>> = Object.freeze({
  notas: 'notes', condiciones: 'terms', referencia: 'customerReference', vencimiento: 'dueDate', fecha_operacion: 'operationDate', descripcion: 'description',
})

const isQuote = (kind: string) => kind === 'quote' || kind === 'proforma'
const salesLabel = (r: { kind: string, number: string | null }) => r.number ?? (isQuote(r.kind) ? 'Presupuesto en borrador' : 'Borrador')
const salesUrl = (r: { kind: string, id: number }) => (isQuote(r.kind) ? `/presupuestos/${r.id}` : `/facturas/${r.id}`)
const salesRow = (r: SalesTarget, extra: Partial<AiActionRow> = {}): AiActionRow => ({
  id: r.id, label: salesLabel(r), sub: [r.client, fd(r.issueDate)].filter(Boolean).join(' · '), amount: r.total, url: salesUrl(r), ...extra,
})

function statusText(kind: string, status: string) {
  const quote = isQuote(kind)
  switch (status) {
    case 'draft': return 'Borrador'
    case 'issued': return quote ? 'Pendiente' : 'Emitida'
    case 'sent': return quote ? 'Enviado' : 'Enviada'
    case 'accepted': return 'Aceptado'
    case 'rejected': return 'Rechazado'
    case 'invoiced': return 'Facturado'
    case 'paid': return 'Cobrada'
    case 'partial': return 'Cobro parcial'
    case 'cancelled': return 'Anulada'
    default: return status
  }
}

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
  const map = new Map<number, SalesLine[]>()
  for (const r of rows) {
    const line: SalesLine = { itemId: r.itemId, description: r.description, quantity: r.quantity, unitPrice: r.unitPrice, discountPct: r.discountPct, vatRate: r.vatRate, surchargeRate: r.surchargeRate, irpfApplies: r.irpfApplies }
    map.set(r.documentId, [...(map.get(r.documentId) ?? []), line])
  }
  return map
}

/** ¿El concepto de la línea contiene el texto (o todas sus palabras)? */
function lineMatches(l: { description: string }, q: string) {
  const text = comparableName(l.description)
  const target = comparableName(q)
  if (!target) return false
  if (text.includes(target)) return true
  const words = target.split(' ').filter(w => w.length > 2)
  return words.length > 0 && words.every(w => text.includes(w))
}

const touchesLines = (ch: SalesChangeSet) => ch.vatRate != null || ch.discountPct != null || ch.taxBase != null || ch.total != null || !!ch.lineOps?.length || ch.contactId != null

/**
 * Líneas nuevas de un documento: primero los cambios de líneas, después el descuento, el IVA y el
 * recargo del cliente y, al final, el ajuste de precios para llegar a la base o al total pedidos.
 * Si algo no encaja en este documento lanza OpError con el motivo («no tiene ninguna línea…»).
 */
function nextSalesLines(lines: SalesLine[], irpfRate: number, ch: SalesChangeSet, contact: Pick<Contact, 'equivalenceSurcharge'> | null): SalesLine[] {
  let out = lines.map(l => ({ ...l }))
  const withSurcharge = contact ? contact.equivalenceSurcharge : lines.some(l => l.surchargeRate > 0)
  for (const op of ch.lineOps ?? []) {
    if (op.op === 'add') {
      const vatRate = op.vatRate ?? 21
      out.push({ itemId: op.itemId ?? null, description: op.description ?? '', quantity: op.quantity ?? 1, unitPrice: op.unitPrice ?? 0, discountPct: op.discountPct ?? 0, vatRate, surchargeRate: withSurcharge ? SURCHARGE_BY_VAT[vatRate] ?? 0 : 0, irpfApplies: true })
      continue
    }
    const hit = out.filter(l => !op.match || lineMatches(l, op.match))
    if (!hit.length) throw new OpError(`no tiene ninguna línea «${op.match}»`)
    if (op.op === 'remove') {
      out = out.filter(l => !hit.includes(l))
      continue
    }
    if (op.description && hit.length > 1) throw new OpError(op.match ? `tiene varias líneas «${op.match}»: concreta cuál` : 'tiene varias líneas: concreta cuál cambia de concepto')
    for (const l of hit) {
      if (op.description) l.description = op.description
      if (op.quantity != null) l.quantity = op.quantity
      if (op.unitPrice != null) l.unitPrice = op.unitPrice
      if (op.discountPct != null) l.discountPct = op.discountPct
      if (op.vatRate != null) {
        l.vatRate = op.vatRate
        l.surchargeRate = l.surchargeRate > 0 ? SURCHARGE_BY_VAT[op.vatRate] ?? 0 : 0
      }
    }
  }
  if (!out.length) throw new OpError('se quedaría sin líneas')
  if (ch.discountPct != null) out = out.map(l => ({ ...l, discountPct: ch.discountPct! }))
  if (ch.vatRate != null || contact) out = out.map(l => adjustLine(l, ch, contact))
  if (ch.taxBase != null || ch.total != null) out = fitSalesLines(out, irpfRate, ch.taxBase != null ? { base: ch.taxBase } : { total: ch.total! })
  return out
}

/**
 * Precios en proporción para que el documento sume la base o el total pedidos (con sus impuestos);
 * el céntimo que falte por redondeo se corrige en la línea de mayor importe.
 */
function fitSalesLines(lines: SalesLine[], irpfRate: number, goal: { base?: number, total?: number }): SalesLine[] {
  const target = goal.base ?? goal.total ?? 0
  const value = (ls: SalesLine[]) => {
    const t = computeTotals(ls, irpfRate)
    return goal.base != null ? t.taxBase : t.total
  }
  const now = value(lines)
  if (!now && lines.length > 1) throw new OpError('suma 0: indica el precio de cada línea')
  const out = lines.map(l => ({ ...l, unitPrice: now ? round4(l.unitPrice * target / now) : 0 }))
  const big = out.reduce((m, l, i) => (Math.abs(lineAmounts(l).base) > Math.abs(lineAmounts(out[m]!).base) ? i : m), 0)
  const l = out[big]!
  const units = l.quantity * (1 - (l.discountPct || 0) / 100)
  const rate = goal.base != null ? 1 : 1 + (l.vatRate + (l.surchargeRate || 0) - (l.irpfApplies !== false ? irpfRate : 0)) / 100
  if (!units || !rate) return out
  for (let i = 0; i < 6; i++) {
    const diff = round2(target - value(out))
    if (!diff) break
    l.unitPrice = round4(l.unitPrice + diff / rate / units)
  }
  return out
}

const sameSalesLines = (a: SalesLine[], b: SalesLine[]) => a.length === b.length && a.every((l, i) => {
  const o = b[i]!
  return l.description === o.description && l.quantity === o.quantity && l.unitPrice === o.unitPrice && (l.discountPct || 0) === (o.discountPct || 0)
    && l.vatRate === o.vatRate && (l.surchargeRate || 0) === (o.surchargeRate || 0) && l.irpfApplies === o.irpfApplies
})

/** Los cambios de líneas pedidos, validados; las líneas nuevas toman precio e IVA del catálogo si no se dan */
async function resolveLineOps(ctx: OpCtx, ops: SalesLineOpIn[]): Promise<LineOp[]> {
  if (ops.length > 50) throw new OpError('Demasiados cambios de líneas de una vez: divide la petición')
  const catalog = ops.some(o => o.accion === 'anadir')
    ? await useDb().select().from(tables.items).where(and(eq(tables.items.companyId, ctx.company.id), isNull(tables.items.archivedAt)))
    : []
  return ops.map((o): LineOp => {
    if (o.iva != null && !VALID_VAT.has(o.iva)) throw new OpError('Tipo de IVA no válido: 21, 10, 5, 4 o 0')
    const vatRate = o.iva ?? undefined
    const quantity = o.cantidad != null ? checkRange(o.cantidad, -999_999, 999_999, 'la cantidad') : undefined
    if (quantity === 0) throw new OpError('La cantidad no puede ser 0: para quitar una línea usa quitar')
    const unitPrice = o.precio != null ? price(o.precio) : undefined
    const discountPct = checkRange(o.descuento, 0, 100, 'el descuento')
    const description = o.concepto?.trim().slice(0, 2000) || undefined
    const match = o.buscar?.trim().slice(0, 120) || null
    if (o.accion === 'anadir') {
      if (!description) throw new OpError('Indica el concepto de la línea nueva')
      const item = catalog.find(i => comparableName(i.name) === comparableName(description))
      const p = unitPrice ?? item?.unitPrice
      if (p == null) throw new OpError(`Indica el precio de «${description}»: no está en el catálogo`)
      return { op: 'add', match: null, description, quantity: quantity ?? 1, unitPrice: p, vatRate: vatRate ?? item?.vatRate ?? (ctx.company.defaultVatRate || 21), discountPct: discountPct ?? 0, itemId: item?.id ?? null }
    }
    if (o.accion === 'quitar') {
      if (!match) throw new OpError('Indica qué línea quitar (su concepto)')
      return { op: 'remove', match }
    }
    if (o.accion !== 'modificar') throw new OpError(`Cambio de línea desconocido: ${o.accion}`)
    if (description == null && quantity == null && unitPrice == null && discountPct == null && vatRate == null) throw new OpError('Indica qué cambia en la línea')
    return { op: 'edit', match, description, quantity, unitPrice, vatRate, discountPct }
  })
}

function lineOpText(op: LineOp) {
  if (op.op === 'add') return `línea nueva «${short(op.description, 40)}» de ${eurText(op.unitPrice ?? 0)}${op.quantity !== 1 ? ` × ${op.quantity}` : ''}`
  if (op.op === 'remove') return `sin la línea «${op.match}»`
  const what = [
    op.description ? `concepto «${short(op.description, 40)}»` : '',
    op.quantity != null ? `cantidad ${op.quantity}` : '',
    op.unitPrice != null ? `precio ${eurText(op.unitPrice)}` : '',
    op.discountPct != null ? `descuento ${pctText(op.discountPct)}` : '',
    op.vatRate != null ? `IVA ${pctText(op.vatRate)}` : '',
  ].filter(Boolean).join(', ')
  return `${op.match ? `línea «${op.match}»` : 'líneas'}: ${what}`
}

/** «No se tocan 2 facturas: no tienen…» para lo que el filtro encontró pero no se puede cambiar */
function skippedText(reasons: Map<string, number>, n: (k: number) => string) {
  return [...reasons].map(([why, k]) => `No se ${k === 1 ? 'toca' : 'tocan'} ${n(k)}: ${why}.`)
}

const STATUS_BY_ACTION: Readonly<Record<string, ManualStatus>> = Object.freeze({ marcar_enviadas: 'sent', marcar_aceptados: 'accepted', marcar_rechazados: 'rejected' })

export async function planSales(ctx: OpCtx, family: SalesFamily, accion: string, rawFilter: unknown, cambios: SalesChangesIn): Promise<OpPlan> {
  const f = cleanFilter(rawFilter)
  const [one, many] = family === 'quote' ? ['presupuesto', 'presupuestos'] : ['factura', 'facturas']
  requireScope(f, many)
  if (family === 'quote' && accion === 'marcar_cobradas') throw new OpError('Los presupuestos no se cobran: primero hay que convertirlos en factura (convertir_en_factura)')
  const { rows: found, matched } = await salesTargets(ctx.company, f, family)
  if (!found.length) {
    // «La factura PC-77» puede ser una recibida: se dice al modelo para que use la herramienta buena
    const other = family === 'invoice' && (f.numeros || f.nombres || f.texto) ? (await expenseTargets(ctx.company, f, 50).catch(() => null))?.rows.length : 0
    throw new OpError(`No hay ${many} que coincidan con ese filtro`, {
      clientes_coincidentes: matched,
      ...(other ? { sugerencia: `Coinciden ${count(other, 'gasto', 'gastos')} (facturas recibidas de proveedores): usa operar_gastos con el mismo filtro, sin preguntar` } : {}),
    })
  }
  tooMany(found.length, many)
  const scope = f.nombres && matched.length ? `Clientes: ${names(matched, 5)}` : null
  const n = (k: number) => count(k, one, many)
  const labels = (list: SalesTarget[]) => labelsOf(list.map(r => ({ id: r.id, label: salesLabel(r) })))

  if (accion === 'eliminar') {
    const issued = found.filter(r => r.status !== 'draft' && !isQuote(r.kind)).length
    const withPayments = found.filter(r => r.paidTotal !== 0).length
    return {
      kind: 'ventas.eliminar',
      title: `Eliminar ${n(found.length)}`,
      risk: 'high',
      params: { ids: found.map(r => r.id), labels: labels(found) },
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
      params: { ids: open.map(r => r.id), labels: labels(open), date: day, method },
      preview: preview(open.map(r => salesRow(r, { amount: round2(r.total - r.paidTotal), before: 'Pendiente', after: 'Cobrada' })), {
        scope,
        change: `Cobro de lo pendiente el ${fd(day)} por ${PAY_TEXT[method]}`,
        total: sum(open.map(r => r.total - r.paidTotal)),
        undoable: true,
        warnings: found.length > open.length ? [`${count(found.length - open.length, 'no tenía', 'no tenían')} nada pendiente y no se ${found.length - open.length === 1 ? 'toca' : 'tocan'}.`] : [],
      }),
    }
  }

  if (accion === 'marcar_pendientes' && family === 'invoice') {
    const paid = found.filter(r => r.status === 'paid' || r.status === 'partial')
    if (!paid.length) throw new OpError('Ninguna de esas facturas tiene cobros registrados')
    return {
      kind: 'ventas.pendiente',
      title: `Quitar los cobros de ${n(paid.length)}`,
      risk: 'normal',
      params: { ids: paid.map(r => r.id), labels: labels(paid) },
      preview: preview(paid.map(r => salesRow(r, { before: r.status === 'paid' ? 'Cobrada' : 'Cobro parcial', after: 'Pendiente' })), {
        scope,
        total: sum(paid.map(r => r.total)),
        undoable: true,
        warnings: ['Se borran sus cobros y los movimientos del banco conciliados con ellos vuelven a pendientes.'],
      }),
    }
  }

  // ─── Estados: enviada, aceptado, rechazado, pendiente (presupuestos) ───
  const wanted = STATUS_BY_ACTION[accion] ?? (accion === 'marcar_pendientes' ? 'issued' : null)
  if (wanted) {
    if (family === 'invoice' && wanted !== 'sent') throw new OpError('Aceptar o rechazar solo se hace con presupuestos')
    const why = (r: SalesTarget) => r.status === wanted ? 'ya lo estaba'
      : r.status === 'draft' ? 'es un borrador: hay que emitirlo antes'
        : r.status === 'invoiced' ? 'ya está facturado'
          : !isQuote(r.kind) && !['issued', 'sent'].includes(r.status) ? 'tiene cobros o está anulada: conserva su estado'
            : null
    const ok = found.filter(r => !why(r))
    const reasons = new Map<string, number>()
    for (const r of found) {
      const w = why(r)
      if (w) reasons.set(w, (reasons.get(w) ?? 0) + 1)
    }
    if (!ok.length) throw new OpError(capital(found.length === 1 ? why(found[0]!)! : `no se puede: ${[...reasons.keys()].join('; ')}`))
    const label = statusText(found[0]!.kind, wanted).toLowerCase()
    return {
      kind: 'ventas.estado',
      title: `Marcar como ${label}${ok.length === 1 ? '' : 's'} ${n(ok.length)}`,
      risk: 'normal',
      params: { ids: ok.map(r => r.id), labels: labels(ok), status: wanted },
      preview: preview(ok.map(r => salesRow(r, { before: statusText(r.kind, r.status), after: statusText(r.kind, wanted) })), {
        scope,
        total: sum(ok.map(r => r.total)),
        undoable: true,
        warnings: skippedText(reasons, n),
      }),
    }
  }

  if (accion === 'pasar_a_borrador') {
    if (family === 'quote') throw new OpError('Los presupuestos no tienen borrador: se pueden marcar como pendientes')
    const locked = await verifactuLocked(ctx.company.id, found)
    const issued = found.filter(r => r.status !== 'draft' && !locked.has(r.id))
    if (!issued.length) throw new OpError(locked.size ? 'Tienen registro VeriFactu: solo se corrigen con una rectificativa' : 'Ya son borradores')
    const withPayments = issued.filter(r => r.paidTotal !== 0).length
    const already = found.length - issued.length - locked.size
    return {
      kind: 'ventas.borrador',
      title: `Devolver a borrador ${n(issued.length)}`,
      risk: 'high',
      params: { ids: issued.map(r => r.id), labels: labels(issued) },
      preview: preview(issued.map(r => salesRow(r, { before: statusText(r.kind, r.status), after: 'Borrador' })), {
        scope,
        total: sum(issued.map(r => r.total)),
        undoable: false,
        warnings: [
          'Pierden su número: al emitirlas de nuevo reciben el siguiente de la serie y pueden quedar huecos en la numeración.',
          'Si ya se enviaron al cliente, lo correcto es anularlas con una rectificativa.',
          withPayments ? `${count(withPayments, 'tiene cobros', 'tienen cobros')}: se borran y los movimientos del banco conciliados vuelven a pendientes.` : '',
          locked.size ? `${n(locked.size)} ${locked.size === 1 ? 'tiene' : 'tienen'} registro VeriFactu y no se ${locked.size === 1 ? 'toca' : 'tocan'}.` : '',
          already > 0 ? `${count(already, 'ya era borrador', 'ya eran borradores')}.` : '',
        ].filter(Boolean),
      }),
    }
  }

  if (accion === 'convertir_en_factura') {
    if (family !== 'quote') throw new OpError('Solo los presupuestos se convierten en factura')
    const s = tables.salesDocuments
    const made = await useDb().selectDistinct({ id: s.sourceId }).from(s)
      .where(and(eq(s.companyId, ctx.company.id), eq(s.kind, 'invoice'), inArray(s.sourceId, found.map(r => r.id))))
    const invoiced = new Set(made.map(m => m.id))
    const ready = found.filter(r => r.status !== 'invoiced' && !invoiced.has(r.id))
    if (!ready.length) throw new OpError(found.length === 1 ? 'Ese presupuesto ya tiene su factura' : 'Esos presupuestos ya tienen su factura')
    return {
      kind: 'ventas.convertir',
      title: `Convertir en factura ${n(ready.length)}`,
      risk: 'normal',
      params: { ids: ready.map(r => r.id), labels: labels(ready) },
      preview: preview(ready.map(r => salesRow(r, { before: statusText(r.kind, r.status), after: 'Borrador de factura' })), {
        scope,
        total: sum(ready.map(r => r.total)),
        undoable: true,
        warnings: [
          `Se crea un borrador de factura por ${one}, con sus mismas líneas y fecha de hoy: revísalo y emítelo.`,
          `${ready.length === 1 ? 'El presupuesto queda aceptado' : 'Los presupuestos quedan aceptados'}.`,
          found.length > ready.length ? `${count(found.length - ready.length, 'ya tenía su factura y no se toca', 'ya tenían su factura y no se tocan')}.` : '',
        ].filter(Boolean),
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
  ch.operationDate = date(cambios.fecha_operacion, 'fecha de operación')
  ch.paymentMethod = payMethod(cambios.forma_pago)
  if (cambios.notas?.trim()) ch.notes = cambios.notas.trim().slice(0, 5000)
  if (cambios.condiciones?.trim()) ch.terms = cambios.condiciones.trim().slice(0, 5000)
  if (cambios.referencia?.trim()) ch.customerReference = cambios.referencia.trim().slice(0, 80)
  if (cambios.descripcion?.trim()) ch.description = plainToRich(cambios.descripcion.slice(0, 5000))
  ch.discountPct = checkRange(cambios.descuento, 0, 100, 'el descuento')
  if (cambios.base != null && cambios.total != null) throw new OpError('Indica la base o el total, no los dos: el otro sale de los impuestos')
  if (cambios.base != null) ch.taxBase = amount(cambios.base, 'la base')
  if (cambios.total != null) ch.total = amount(cambios.total, 'el total')
  if (cambios.lineas?.length) ch.lineOps = await resolveLineOps(ctx, cambios.lineas)
  for (const v of cambios.vaciar ?? []) {
    const k = SALES_CLEAR[v]
    if (!k) throw new OpError(`«${v}» no se puede dejar en blanco`)
    if (ch[k] != null) throw new OpError(`«${v}»: indica un valor nuevo o vacíalo, no las dos cosas`)
    ch[k] = null
  }
  for (const k of Object.keys(ch) as Array<keyof SalesChangeSet>) if (ch[k] === undefined) delete ch[k]
  if (!Object.keys(ch).length) throw new OpError('Indica qué quieres cambiar')

  if (contact) parts.push(`${names(found.map(r => r.client)) || 'Sin cliente'} → ${contact.name}`)
  for (const op of ch.lineOps ?? []) parts.push(lineOpText(op))
  if (ch.taxBase != null) parts.push(`base ${eurText(ch.taxBase)}`)
  if (ch.total != null) parts.push(`total ${eurText(ch.total)}`)
  if (ch.discountPct != null) parts.push(ch.discountPct ? `descuento del ${pctText(ch.discountPct)}` : 'sin descuento')
  if (ch.irpfRate != null) parts.push(ch.irpfRate ? `retención del ${pctText(ch.irpfRate)}` : 'sin retención')
  if (ch.vatRate != null) parts.push(`IVA del ${pctText(ch.vatRate)}`)
  if (ch.issueDate) parts.push(`fecha ${fd(ch.issueDate)}`)
  if (ch.dueDate !== undefined) parts.push(ch.dueDate ? `vence el ${fd(ch.dueDate)}` : 'sin vencimiento')
  if (ch.operationDate !== undefined) parts.push(ch.operationDate ? `fecha de operación ${fd(ch.operationDate)}` : 'sin fecha de operación')
  if (ch.paymentMethod) parts.push(`pago por ${PAY_TEXT[ch.paymentMethod]}`)
  if (ch.notes !== undefined) parts.push(ch.notes ? 'notas nuevas' : 'sin notas')
  if (ch.terms !== undefined) parts.push(ch.terms ? 'condiciones nuevas' : 'sin condiciones')
  if (ch.customerReference !== undefined) parts.push(ch.customerReference ? `referencia ${ch.customerReference}` : 'sin referencia')
  if (ch.description !== undefined) parts.push(ch.description ? 'descripción nueva' : 'sin descripción')

  const linesChange = touchesLines(ch)
  const amounts = linesChange || ch.irpfRate != null
  const lines = amounts ? await linesOf(found.map(r => r.id)) : new Map<number, SalesLine[]>()
  const locked = await verifactuLocked(ctx.company.id, found)
  const rows: AiActionRow[] = []
  const targets: SalesTarget[] = []
  const failed = new Map<string, number>()
  let unchanged = 0
  let paidTouched = 0
  let unfit = 0
  let scaled = false
  // Lo que no se compara con el documento cuenta siempre como cambio
  const COMPARED = new Set(['contactId', 'irpfRate', 'vatRate', 'issueDate', 'dueDate', 'discountPct', 'taxBase', 'total', 'lineOps'])
  for (const r of found) {
    if (locked.has(r.id)) continue
    const docLines = lines.get(r.id) ?? []
    let next: SalesLine[] | null = null
    if (linesChange) {
      try {
        next = nextSalesLines(docLines, ch.irpfRate ?? r.irpfRate, ch, contact)
      }
      catch (err) {
        if (!(err instanceof OpError)) throw err
        failed.set(err.message, (failed.get(err.message) ?? 0) + 1)
        continue
      }
    }
    let changes = Object.keys(ch).some(k => !COMPARED.has(k))
    if (ch.contactId != null && r.contactId !== ch.contactId) changes = true
    if (ch.irpfRate != null && r.irpfRate !== ch.irpfRate) changes = true
    if (ch.issueDate && r.issueDate !== ch.issueDate) changes = true
    if (ch.dueDate !== undefined && r.dueDate !== ch.dueDate) changes = true
    if (next && !sameSalesLines(docLines, next)) changes = true
    if (!changes) {
      unchanged++
      continue
    }
    const after = amounts ? computeTotals(next ?? docLines, ch.irpfRate ?? r.irpfRate) : null
    const newTotal = after?.total ?? r.total
    if (after && ((ch.taxBase != null && after.taxBase !== ch.taxBase) || (ch.total != null && after.total !== ch.total))) unfit++
    if ((ch.taxBase != null || ch.total != null) && docLines.length > 1) scaled = true
    const amountChanges = Math.abs(newTotal - r.total) > 0.004
    if (amountChanges && r.paidTotal !== 0) paidTouched++
    targets.push(r)
    rows.push(salesRow(r, contact
      ? { before: r.client ?? 'Sin cliente', after: contact.name, amount: newTotal }
      : ch.taxBase != null && after ? { before: `Base ${eurText(r.taxBase)}`, after: `Base ${eurText(after.taxBase)}`, amount: newTotal }
        : amountChanges ? { before: eurText(r.total), after: eurText(newTotal), amount: newTotal } : {}))
  }
  if (!targets.length && failed.size) throw new OpError(capital([...failed.keys()][0]!), { avisos: skippedText(failed, n) })
  if (!targets.length && locked.size) throw new OpError(`${locked.size === 1 ? 'Esa factura tiene' : 'Esas facturas tienen'} registro VeriFactu: solo se corrigen con una rectificativa`)
  if (!targets.length) throw new OpError(`${found.length === 1 ? `Ese ${one} ya lo tiene` : `Esos ${many} ya lo tienen`}: no hay nada que cambiar`)

  const issued = targets.filter(r => r.status !== 'draft' && !isQuote(r.kind)).length
  const amountsChange = rows.some(x => x.before && x.after && x.amount != null) || ch.irpfRate != null || ch.vatRate != null
  const surchargeChange = contact && targets.some(r => (lines.get(r.id) ?? []).some(l => (l.surchargeRate > 0) !== contact!.equivalenceSurcharge))
  const only = Object.keys(ch)
  const title = only.length === 1 && contact ? `Cambiar el cliente de ${n(targets.length)}`
    : only.length === 1 && ch.irpfRate != null ? (ch.irpfRate ? `Aplicar retención del ${pctText(ch.irpfRate)} a ${n(targets.length)}` : `Quitar la retención de ${n(targets.length)}`)
      : only.length === 1 && ch.vatRate != null ? `Poner IVA del ${pctText(ch.vatRate)} en ${n(targets.length)}`
        : only.length === 1 && (ch.taxBase != null || ch.total != null) ? `Cambiar el importe de ${n(targets.length)}`
          : only.length === 1 && ch.lineOps ? `Cambiar las líneas de ${n(targets.length)}`
            : only.length === 1 && ch.discountPct != null ? `Aplicar un descuento del ${pctText(ch.discountPct)} a ${n(targets.length)}`
              : `Modificar ${n(targets.length)}`
  return {
    kind: 'ventas.modificar',
    title,
    risk: 'normal',
    params: { ids: targets.map(r => r.id), labels: labels(targets), changes: ch },
    preview: preview(rows, {
      scope,
      change: capital(parts.join(' · ')),
      total: sum(rows.map(r => r.amount ?? 0)),
      undoable: true,
      warnings: [
        issued && contact ? `${n(issued)} ya ${issued === 1 ? 'está emitida' : 'están emitidas'}: el cliente cambia en la propia factura. Si ya se la enviaste al anterior, lo correcto es una rectificativa.` : '',
        issued && amountsChange && !contact ? `${n(issued)} ya ${issued === 1 ? 'está emitida' : 'están emitidas'}: si ya ${issued === 1 ? 'la enviaste' : 'las enviaste'}, cambiar importes requiere una rectificativa.` : '',
        issued && ch.issueDate ? 'Cambiar la fecha de facturas emitidas puede romper el orden correlativo de la numeración.' : '',
        scaled ? 'Los precios de cada línea se ajustan en proporción para llegar al importe.' : '',
        unfit ? `${count(unfit, 'no cuadra', 'no cuadran')} al céntimo por el redondeo de los precios: revisa el importe final en la tarjeta.` : '',
        surchargeChange ? 'El recargo de equivalencia se ajusta al nuevo cliente.' : '',
        paidTouched ? `${count(paidTouched, 'tiene cobros', 'tienen cobros')}: su estado de cobro se recalcula con el nuevo total.` : '',
        locked.size ? `${n(locked.size)} ${locked.size === 1 ? 'tiene' : 'tienen'} registro VeriFactu y no se ${locked.size === 1 ? 'toca' : 'tocan'}: solo se corrigen con una rectificativa.` : '',
        ...skippedText(failed, n),
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
        ...(ch.dueDate !== undefined ? { dueDate: ch.dueDate } : {}),
        ...(ch.operationDate !== undefined ? { operationDate: ch.operationDate } : {}),
        ...(ch.paymentMethod ? { paymentMethod: ch.paymentMethod } : {}),
        ...(ch.notes !== undefined ? { notes: ch.notes } : {}),
        ...(ch.terms !== undefined ? { terms: ch.terms } : {}),
        ...(ch.customerReference !== undefined ? { customerReference: ch.customerReference } : {}),
        ...(ch.description !== undefined ? { description: ch.description } : {}),
        lines: touchesLines(ch) ? nextSalesLines(loaded.input.lines, ch.irpfRate ?? loaded.input.irpfRate, ch, contact) : loaded.input.lines,
      }
      await saveSalesDraft(ctx.company.id, ctx.actor.id, next, id)
      await keepSeries(ctx.company.id, id, loaded.input.seriesId)
      undo.push({ id, input: loaded.input, customer: loaded.doc.customer })
      t.done++
    }
    catch (err) {
      t.skip(id, capital(errText(err)))
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

type StatusUndo = { id: number, status: SalesStatus, sentAt: string | Date | null }

async function salesSetStatus(ctx: OpCtx, p: { ids: number[], labels: Record<string, string>, status: ManualStatus }): Promise<OpOutcome> {
  const t = new Tally(p.labels)
  const s = tables.salesDocuments
  const undo: StatusUndo[] = []
  for (const id of p.ids) {
    try {
      const [doc] = await useDb().select({ status: s.status, sentAt: s.sentAt }).from(s).where(and(eq(s.id, id), eq(s.companyId, ctx.company.id)))
      if (!doc) {
        t.skip(id, 'Ya no existe')
        continue
      }
      if (doc.status === p.status) {
        t.skip(id, 'Ya lo estaba')
        continue
      }
      await setSalesStatus(ctx.company.id, id, p.status)
      undo.push({ id, status: doc.status, sentAt: doc.sentAt })
      t.done++
    }
    catch (err) {
      t.skip(id, errText(err))
    }
  }
  return { result: t.result(), undo: { items: undo } }
}

async function salesSetStatusRevert(ctx: OpCtx, u: { items: StatusUndo[] }) {
  const t = new Tally()
  const s = tables.salesDocuments
  for (const item of u.items) {
    try {
      const [doc] = await useDb().select({ status: s.status }).from(s).where(and(eq(s.id, item.id), eq(s.companyId, ctx.company.id)))
      if (!doc) throw new OpError('Ya no existe')
      if (doc.status === 'invoiced' || doc.status === 'paid' || doc.status === 'partial') throw new OpError('Ha cambiado después: ya está facturado o cobrado')
      await useDb().update(s).set({ status: item.status, sentAt: item.sentAt ? new Date(item.sentAt) : null }).where(eq(s.id, item.id))
      t.done++
    }
    catch (err) {
      t.skip(item.id, errText(err))
    }
  }
  return t.result()
}

async function salesBackToDraft(ctx: OpCtx, p: { ids: number[], labels: Record<string, string> }): Promise<OpOutcome> {
  const t = new Tally(p.labels)
  for (const id of p.ids) {
    try {
      if (await salesToDraft(ctx.company.id, id)) t.done++
      else t.skip(id, 'Ya era un borrador')
    }
    catch (err) {
      t.skip(id, errText(err))
    }
  }
  return { result: t.result(), undo: null }
}

type ConvertUndo = { id: number, invoiceId: number, status: SalesStatus }

async function salesConvert(ctx: OpCtx, p: { ids: number[], labels: Record<string, string> }): Promise<OpOutcome> {
  const t = new Tally(p.labels)
  const db = useDb()
  const s = tables.salesDocuments
  const undo: ConvertUndo[] = []
  for (const id of p.ids) {
    try {
      const [doc] = await db.select({ status: s.status }).from(s).where(and(eq(s.id, id), eq(s.companyId, ctx.company.id)))
      if (!doc) {
        t.skip(id, 'Ya no existe')
        continue
      }
      const [made] = await db.select({ id: s.id }).from(s).where(and(eq(s.companyId, ctx.company.id), eq(s.kind, 'invoice'), eq(s.sourceId, id))).limit(1)
      if (made || doc.status === 'invoiced') {
        t.skip(id, 'Ya tiene su factura')
        continue
      }
      undo.push({ id, invoiceId: await quoteToInvoice(ctx.company, ctx.actor.id, id), status: doc.status })
      t.done++
    }
    catch (err) {
      t.skip(id, errText(err))
    }
  }
  const url = undo.length === 1 ? `/facturas/${undo[0]!.invoiceId}` : '/facturas'
  return { result: t.result({ url, message: undo.length ? 'Los borradores de factura están listos para revisarlos y emitirlos.' : null }), undo: { items: undo } }
}

async function salesConvertRevert(ctx: OpCtx, u: { items: ConvertUndo[] }) {
  const t = new Tally()
  const db = useDb()
  const s = tables.salesDocuments
  for (const item of u.items) {
    try {
      const [inv] = await db.select({ status: s.status }).from(s).where(and(eq(s.id, item.invoiceId), eq(s.companyId, ctx.company.id)))
      if (inv && inv.status !== 'draft') throw new OpError('La factura ya está emitida: si sobra, anúlala con una rectificativa')
      if (inv) await deleteSalesDocuments(ctx.company.id, [item.invoiceId])
      await db.update(s).set({ status: item.status }).where(and(eq(s.id, item.id), eq(s.companyId, ctx.company.id)))
      t.done++
    }
    catch (err) {
      t.skip(item.id, errText(err))
    }
  }
  return t.result()
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
  base: number | null
  total: number | null
  cuota_iva: number | null
  desglose: Array<{ base: number, iva: number, cuota: number | null, recargo: boolean | null }> | null
  fecha: string | null
  vencimiento: string | null
  numero: string | null
  descripcion: string | null
  notas: string | null
  forma_pago: string | null
  bien_inversion: boolean | null
  inversion_sujeto_pasivo: boolean | null
  revisado: boolean | null
  motivo: string | null
  vaciar: string[] | null
}

type TaxLineIn = { base: number, vatRate: number, vatAmount: number | null, surchargeRate: number }

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
  /** Importes: la base, el total (lo pagado), la cuota de IVA o el desglose completo por tipos */
  taxBase?: number
  total?: number
  vatAmount?: number
  taxLines?: TaxLineIn[]
  issueDate?: string
  dueDate?: string | null
  number?: string | null
  description?: string | null
  notes?: string | null
  paymentMethod?: Pay | null
  isInvestment?: boolean
  reverseCharge?: boolean
  reviewed?: boolean
}

const EXPENSE_CLEAR: Readonly<Record<string, 'description' | 'notes' | 'number' | 'dueDate' | 'paymentMethod'>> = Object.freeze({
  descripcion: 'description', notas: 'notes', numero: 'number', vencimiento: 'dueDate', forma_pago: 'paymentMethod',
})

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

const EXPENSE_AMOUNT_KEYS = Object.freeze(['taxLines', 'taxBase', 'total', 'vatAmount', 'vatRate', 'irpfRate'] as const)
const SEVERAL_VAT = 'con varios tipos de IVA hay que indicar el desglose completo'

/** Bases repartidas en proporción hasta sumar `target`; el céntimo que sobre va a la línea mayor */
function scaleBases(tl: TaxLineIn[], target: number): TaxLineIn[] {
  const current = sum(tl.map(l => l.base))
  if (!current) throw new OpError('su base es 0: hay que indicar el desglose por tipos de IVA')
  const out = tl.map(l => ({ ...l, base: round2(l.base * target / current), vatAmount: null }))
  const big = out.reduce((m, l, i) => (Math.abs(l.base) > Math.abs(out[m]!.base) ? i : m), 0)
  out[big]!.base = round2(out[big]!.base + target - sum(out.map(l => l.base)))
  return out
}

/**
 * Desglose de IVA nuevo de un gasto, o null si sus importes no cambian. Otra base mantiene los tipos y
 * recalcula las cuotas; otro total (lo pagado) mantiene los tipos y saca base y cuota al céntimo; base y
 * total a la vez fijan la cuota; otro tipo de IVA a secas mantiene el total; otra retención, la base.
 */
function nextExpenseLines(row: { total: number, taxBase: number, vatTotal: number, irpfRate: number }, lines: TaxLineIn[], ch: Pick<ExpenseChangeSet, typeof EXPENSE_AMOUNT_KEYS[number]>): { taxLines: TaxLineIn[], irpfRate: number } | null {
  if (!EXPENSE_AMOUNT_KEYS.some(k => ch[k] != null)) return null
  const irpf = ch.irpfRate ?? row.irpfRate
  let tl: TaxLineIn[] = (ch.taxLines ?? lines).map(l => ({ ...l }))
  if (!tl.length) tl = [{ base: row.taxBase, vatRate: 0, vatAmount: row.vatTotal, surchargeRate: 0 }]
  const one = tl.length === 1 ? tl[0]! : null
  if ((ch.vatRate != null || ch.vatAmount != null) && !one) throw new OpError(SEVERAL_VAT)
  let rateChanged = false
  if (one && ch.vatRate != null && ch.vatRate !== one.vatRate) {
    one.surchargeRate = one.surchargeRate > 0 ? SURCHARGE_BY_VAT[ch.vatRate] ?? 0 : 0
    one.vatRate = ch.vatRate
    one.vatAmount = null
    rateChanged = true
  }
  // Otro tipo de IVA sin más importes: se mantiene lo que se pagó
  const total = ch.total ?? (rateChanged && ch.taxBase == null && ch.vatAmount == null ? row.total : null)
  if (one && ch.vatAmount != null) one.vatAmount = ch.vatAmount
  if (ch.taxBase != null) {
    if (one) {
      one.base = ch.taxBase
      if (ch.vatAmount == null) one.vatAmount = null
    }
    else tl = scaleBases(tl, ch.taxBase)
  }
  if (total != null) {
    if (one) {
      const s = one.surchargeRate
      if (ch.taxBase != null) one.vatAmount = round2(total - one.base - pctOf(one.base, s) + pctOf(one.base, irpf))
      else if (ch.vatAmount != null) one.base = round2((total - ch.vatAmount) / (1 + (s - irpf) / 100))
      else {
        one.base = round2(total / (1 + (one.vatRate + s - irpf) / 100))
        // La cuota cuadra al céntimo con lo pagado
        one.vatAmount = round2(total - one.base - pctOf(one.base, s) + pctOf(one.base, irpf))
      }
    }
    else {
      if (ch.taxBase != null) throw new OpError(SEVERAL_VAT)
      const current = expenseTotals({ taxLines: tl, irpfRate: irpf }).total
      if (!current) throw new OpError('su total es 0: hay que indicar el desglose por tipos de IVA')
      tl = scaleBases(tl, round2(sum(tl.map(l => l.base)) * total / current))
      // El céntimo de redondeo, en la cuota del tipo más alto
      const diff = round2(total - expenseTotals({ taxLines: tl, irpfRate: irpf }).total)
      const top = tl.reduce((m, l, i) => (l.vatRate > tl[m]!.vatRate ? i : m), 0)
      if (diff && tl[top]!.vatRate > 0) tl[top]!.vatAmount = round2(pctOf(tl[top]!.base, tl[top]!.vatRate) + diff)
    }
  }
  for (const l of tl) {
    if (!Number.isFinite(l.base) || Math.abs(l.base) > MAX_AMOUNT || (l.vatAmount != null && !Number.isFinite(l.vatAmount))) throw new OpError('el importe no es válido')
  }
  return { taxLines: tl, irpfRate: irpf }
}

/** Aviso si una cuota no corresponde a su tipo (base y total que no cuadran con el IVA) */
function oddVat(lines: Array<{ base: number, vatRate: number, vatAmount: number }>) {
  for (const l of lines) {
    const expected = pctOf(l.base, l.vatRate)
    if (Math.abs(l.vatAmount - expected) > Math.max(0.05, Math.abs(l.base) * 0.005)) {
      return `La cuota de IVA queda en ${eurText(l.vatAmount)}, que no es el ${pctText(l.vatRate)} de ${eurText(l.base)}: revisa que base y total sean los de la factura.`
    }
  }
  return null
}

async function expenseLinesOf(ids: number[]) {
  const tl = tables.expenseTaxLines
  const rows = ids.length ? await useDb().select().from(tl).where(inArray(tl.expenseId, ids)).orderBy(tl.expenseId, tl.id) : []
  const map = new Map<number, TaxLineIn[]>()
  for (const r of rows) map.set(r.expenseId, [...(map.get(r.expenseId) ?? []), { base: r.base, vatRate: r.vatRate, vatAmount: r.vatAmount, surchargeRate: r.surchargeRate }])
  return map
}

const sameTaxLines = (a: Array<{ base: number, vatRate: number, vatAmount: number | null, surchargeRate: number }>, b: TaxLineIn[]) =>
  a.length === b.length && a.every((l, i) => l.base === b[i]!.base && l.vatRate === b[i]!.vatRate && l.vatAmount === b[i]!.vatAmount && l.surchargeRate === b[i]!.surchargeRate)

/** Gastos (de estos) conciliados con un movimiento del banco, directamente o por su pago */
async function bankLinked(companyId: number, ids: number[]) {
  if (!ids.length) return new Set<number>()
  const db = useDb()
  const bt = tables.bankTransactions
  const p = tables.payments
  const [direct, viaPayment] = await Promise.all([
    db.selectDistinct({ id: bt.expenseId }).from(bt).where(and(eq(bt.companyId, companyId), inArray(bt.expenseId, ids))),
    db.selectDistinct({ id: p.expenseId }).from(bt).innerJoin(p, eq(p.id, bt.paymentId)).where(and(eq(bt.companyId, companyId), inArray(p.expenseId, ids))),
  ])
  return new Set([...direct, ...viaPayment].map(r => r.id).filter((x): x is number => x != null))
}

export async function planExpenses(ctx: OpCtx, accion: string, rawFilter: unknown, cambios: ExpenseChangesIn): Promise<OpPlan> {
  const f = cleanFilter(rawFilter)
  requireScope(f, 'gastos')
  const { rows: found, matched } = await expenseTargets(ctx.company, f)
  if (!found.length) {
    const other = f.numeros || f.nombres || f.texto ? (await salesTargets(ctx.company, f, 'invoice', 50).catch(() => null))?.rows.length : 0
    throw new OpError('No hay gastos que coincidan con ese filtro', {
      proveedores_coincidentes: matched,
      ...(other ? { sugerencia: `Coinciden ${count(other, 'factura emitida', 'facturas emitidas')} a clientes: usa operar_facturas con el mismo filtro, sin preguntar` } : {}),
    })
  }
  tooMany(found.length, 'gastos')
  const scope = f.nombres && matched.length ? `Proveedores: ${names(matched, 5)}` : null
  const n = (k: number) => count(k, 'gasto', 'gastos')
  const labels = (list: ExpenseTarget[]) => labelsOf(list.map(r => ({ id: r.id, label: expenseLabel(r) })))

  if (accion === 'eliminar') {
    const bt = tables.bankTransactions
    const [linked] = await useDb().select({ n: sql<number>`COUNT(*)`.mapWith(Number) }).from(bt)
      .where(and(eq(bt.companyId, ctx.company.id), inArray(bt.expenseId, found.map(r => r.id))))
    const withFile = found.filter(r => r.fileId).length
    return {
      kind: 'gastos.eliminar',
      title: `Eliminar ${n(found.length)}`,
      risk: 'high',
      params: { ids: found.map(r => r.id), labels: labels(found) },
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
      params: { ids: open.map(r => r.id), labels: labels(open), date: day, method },
      preview: preview(open.map(r => expenseRow(r, { amount: round2(r.total - r.paidTotal), before: 'Pendiente', after: 'Pagado' })), {
        scope,
        change: `Pago de lo pendiente el ${fd(day)} por ${PAY_TEXT[method]}`,
        total: sum(open.map(r => r.total - r.paidTotal)),
        undoable: true,
        warnings: found.length > open.length ? [`${count(found.length - open.length, 'ya estaba pagado y no se toca', 'ya estaban pagados y no se tocan')}.`] : [],
      }),
    }
  }

  if (accion === 'marcar_pendientes') {
    const paid = found.filter(r => r.status !== 'pending')
    if (!paid.length) throw new OpError('Ninguno de esos gastos tiene pagos registrados: ya están pendientes')
    const linked = await bankLinked(ctx.company.id, paid.map(r => r.id))
    return {
      kind: 'gastos.pendiente',
      title: `Quitar los pagos de ${n(paid.length)}`,
      risk: 'normal',
      params: { ids: paid.map(r => r.id), labels: labels(paid) },
      preview: preview(paid.map(r => expenseRow(r, { before: r.status === 'paid' ? 'Pagado' : 'Pago parcial', after: 'Pendiente' })), {
        scope,
        total: sum(paid.map(r => r.total)),
        undoable: true,
        warnings: [
          'Se borran sus pagos y quedan pendientes de pago.',
          linked.size ? `${count(linked.size, 'está conciliado', 'están conciliados')} con el banco: ${linked.size === 1 ? 'su movimiento vuelve' : 'sus movimientos vuelven'} a por revisar.` : '',
          found.length > paid.length ? `${count(found.length - paid.length, 'ya estaba pendiente y no se toca', 'ya estaban pendientes y no se tocan')}.` : '',
        ].filter(Boolean),
      }),
    }
  }

  if (accion === 'aprobar' || accion === 'rechazar') {
    if (ctx.actor.role !== 'owner' && ctx.actor.role !== 'admin') throw new OpError('Solo el titular o un administrador pueden aprobar o rechazar gastos')
    const approve = accion === 'aprobar'
    const open = found.filter(r => r.approval === 'pending' || (approve && r.approval === 'rejected'))
    if (!open.length) throw new OpError('Ninguno de esos gastos está pendiente de aprobación')
    const reason = cambios.motivo?.trim().slice(0, 300) || null
    return {
      kind: approve ? 'gastos.aprobar' : 'gastos.rechazar',
      title: `${approve ? 'Aprobar' : 'Rechazar'} ${n(open.length)}`,
      risk: 'normal',
      params: { ids: open.map(r => r.id), labels: labels(open), reason },
      preview: preview(open.map(r => expenseRow(r, { before: r.approval === 'rejected' ? 'Rechazado' : 'Por aprobar', after: approve ? 'Aprobado' : 'Rechazado' })), {
        scope,
        change: !approve && reason ? `Motivo: ${reason}` : null,
        total: sum(open.map(r => r.total)),
        undoable: true,
        warnings: [
          approve ? 'Pasan a contar en impuestos, informes y pagos pendientes.' : 'No cuentan en impuestos ni informes hasta que se corrijan y se aprueben.',
          'Quien los registró recibe un aviso.',
          found.length > open.length ? `${count(found.length - open.length, 'no estaba pendiente y no se toca', 'no estaban pendientes y no se tocan')}.` : '',
        ].filter(Boolean),
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

  // ─── Importes ───
  if (cambios.desglose?.length) {
    if (cambios.base != null || cambios.total != null || cambios.cuota_iva != null || cambios.iva != null) {
      throw new OpError('Con el desglose no indiques también base, total, IVA o cuota: van dentro de cada línea del desglose')
    }
    if (cambios.desglose.length > 10) throw new OpError('Como mucho 10 tipos de IVA')
    ch.taxLines = cambios.desglose.map((d) => {
      if (!VALID_VAT.has(d.iva)) throw new OpError('Tipo de IVA no válido: 21, 10, 5, 4 o 0')
      return { base: amount(d.base, 'la base'), vatRate: d.iva, vatAmount: d.cuota != null ? amount(d.cuota, 'la cuota de IVA') : null, surchargeRate: d.recargo ? SURCHARGE_BY_VAT[d.iva] ?? 0 : 0 }
    })
    parts.push(`desglose ${ch.taxLines.map(l => `${eurText(l.base)} al ${pctText(l.vatRate)}`).join(' + ')}`)
  }
  if (cambios.iva != null) {
    if (!VALID_VAT.has(cambios.iva)) throw new OpError('Tipo de IVA no válido: 21, 10, 5, 4 o 0')
    ch.vatRate = cambios.iva
    parts.push(`IVA del ${pctText(cambios.iva)}`)
  }
  if (cambios.base != null) {
    ch.taxBase = amount(cambios.base, 'la base')
    parts.push(`base ${eurText(ch.taxBase)}`)
  }
  if (cambios.total != null) {
    ch.total = amount(cambios.total, 'el total')
    parts.push(`total ${eurText(ch.total)}`)
  }
  if (cambios.cuota_iva != null) {
    ch.vatAmount = amount(cambios.cuota_iva, 'la cuota de IVA')
    parts.push(`cuota de IVA ${eurText(ch.vatAmount)}`)
  }
  ch.irpfRate = checkRange(cambios.irpf, 0, 50, 'el porcentaje de retención')
  if (ch.irpfRate != null) parts.push(ch.irpfRate ? `retención del ${pctText(ch.irpfRate)}` : 'sin retención')
  if (!ch.taxLines) {
    const fixed = ch.taxBase != null || ch.total != null || ch.vatAmount != null
    if (ch.vatRate != null && !fixed) warnings.push('Se mantiene el total pagado y se recalculan la base y el IVA.')
    else if (ch.total != null && ch.taxBase == null && ch.vatAmount == null) warnings.push('Se mantienen los tipos de IVA y retención: la base y las cuotas salen del total.')
    else if (ch.taxBase != null && ch.total == null && ch.vatAmount == null) warnings.push('Se mantienen los tipos de IVA y retención: cambian las cuotas y el total.')
    else if (ch.irpfRate != null && !fixed) warnings.push('Se mantiene la base y cambia el total a pagar.')
  }

  // ─── Resto de datos ───
  ch.issueDate = date(cambios.fecha, 'fecha')
  if (ch.issueDate) parts.push(`fecha ${fd(ch.issueDate)}`)
  ch.dueDate = date(cambios.vencimiento, 'fecha de vencimiento')
  if (ch.dueDate) parts.push(`vence el ${fd(ch.dueDate)}`)
  if (cambios.numero?.trim()) {
    if (found.length > 1) throw new OpError('El número de factura se cambia de uno en uno: concreta el gasto')
    ch.number = cambios.numero.trim().slice(0, 60)
    parts.push(`número ${ch.number}`)
  }
  if (cambios.descripcion?.trim()) {
    ch.description = cambios.descripcion.trim().slice(0, 255)
    parts.push('descripción nueva')
  }
  if (cambios.notas?.trim()) {
    ch.notes = cambios.notas.trim().slice(0, 5000)
    parts.push('notas nuevas')
  }
  ch.paymentMethod = payMethod(cambios.forma_pago)
  if (ch.paymentMethod) parts.push(`pago por ${PAY_TEXT[ch.paymentMethod]}`)
  if (cambios.bien_inversion != null) {
    ch.isInvestment = cambios.bien_inversion
    parts.push(ch.isInvestment ? 'bien de inversión' : 'no es bien de inversión')
  }
  if (cambios.inversion_sujeto_pasivo != null) {
    ch.reverseCharge = cambios.inversion_sujeto_pasivo
    parts.push(ch.reverseCharge ? 'con inversión del sujeto pasivo' : 'sin inversión del sujeto pasivo')
  }
  if (cambios.revisado != null) {
    ch.reviewed = cambios.revisado
    parts.push(ch.reviewed ? 'revisado' : 'por revisar')
  }
  for (const v of cambios.vaciar ?? []) {
    const k = EXPENSE_CLEAR[v]
    if (!k) throw new OpError(`«${v}» no se puede dejar en blanco`)
    if (ch[k] != null) throw new OpError(`«${v}»: indica un valor nuevo o vacíalo, no las dos cosas`)
    ch[k] = null
    parts.push(`sin ${v === 'forma_pago' ? 'forma de pago' : v === 'numero' ? 'número' : v === 'descripcion' ? 'descripción' : v}`)
  }
  for (const k of Object.keys(ch) as Array<keyof ExpenseChangeSet>) if (ch[k] === undefined) delete ch[k]
  if (!Object.keys(ch).length) throw new OpError('Indica qué quieres cambiar')

  if (ch.number) {
    const r = found[0]!
    const e = tables.expenses
    const supplierId = ch.supplierId !== undefined ? ch.supplierId : r.supplierId
    const [dup] = supplierId
      ? await useDb().select({ id: e.id }).from(e).where(and(eq(e.companyId, ctx.company.id), eq(e.supplierId, supplierId), eq(e.number, ch.number), ne(e.id, r.id))).limit(1)
      : []
    if (dup) throw new OpError(`Ya hay otro gasto de ${supplierName ?? r.supplier ?? 'ese proveedor'} con el número ${ch.number}: sería un duplicado`, { gasto: `/gastos?ver=${dup.id}` })
  }

  const amounts = EXPENSE_AMOUNT_KEYS.some(k => ch[k] != null)
  const taxLinesById = amounts ? await expenseLinesOf(found.map(r => r.id)) : new Map<number, TaxLineIn[]>()
  const rows: AiActionRow[] = []
  const targets: ExpenseTarget[] = []
  const totalChanged: ExpenseTarget[] = []
  const failed = new Map<string, number>()
  let unchanged = 0
  let odd: string | null = null
  for (const r of found) {
    let next: ReturnType<typeof expenseTotals> | null = null
    let nextIrpf = r.irpfRate
    if (amounts) {
      try {
        const nl = nextExpenseLines(r, taxLinesById.get(r.id) ?? [], ch)
        if (nl) {
          next = expenseTotals(nl)
          nextIrpf = nl.irpfRate
        }
      }
      catch (err) {
        if (!(err instanceof OpError)) throw err
        failed.set(err.message, (failed.get(err.message) ?? 0) + 1)
        continue
      }
    }
    if (ch.dueDate && ch.dueDate < (ch.issueDate ?? r.issueDate)) {
      failed.set('el vencimiento quedaría antes de la fecha del gasto', (failed.get('el vencimiento quedaría antes de la fecha del gasto') ?? 0) + 1)
      continue
    }
    const amountChanges = !!next && (next.total !== r.total || nextIrpf !== r.irpfRate || !sameTaxLines(next.lines, taxLinesById.get(r.id) ?? []))
    const same = !amountChanges
      && (ch.supplierId === undefined || r.supplierId === ch.supplierId) && !ch.supplierName
      && (ch.categoryId === undefined || r.categoryId === ch.categoryId)
      && (!ch.kind || r.kind === ch.kind)
      && (ch.deductiblePct == null || r.deductiblePct === ch.deductiblePct)
      && (ch.vatDeductiblePct == null || r.vatDeductiblePct === ch.vatDeductiblePct)
      && (!ch.issueDate || r.issueDate === ch.issueDate)
      && (ch.dueDate === undefined || r.dueDate === ch.dueDate)
      && (ch.number === undefined || r.number === ch.number)
      && (ch.description === undefined || r.description === ch.description)
      && (ch.paymentMethod === undefined || r.paymentMethod === ch.paymentMethod)
      && (ch.isInvestment == null || r.isInvestment === ch.isInvestment)
      && (ch.reverseCharge == null || r.reverseCharge === ch.reverseCharge)
      && (ch.reviewed == null || r.reviewed === ch.reviewed)
      && ch.notes === undefined
    if (same) {
      unchanged++
      continue
    }
    targets.push(r)
    if (next && next.total !== r.total) totalChanged.push(r)
    if (next) odd ??= oddVat(next.lines)
    const payroll = r.kind === 'payroll' || ch.kind === 'payroll'
    const extra: Partial<AiActionRow> = next && amountChanges
      ? (ch.taxBase != null || ch.taxLines) && next.taxBase !== r.taxBase
          ? { before: `${payroll ? 'Bruto' : 'Base'} ${eurText(r.taxBase)}`, after: `${payroll ? 'Bruto' : 'Base'} ${eurText(next.taxBase)}`, amount: next.total }
          : ch.vatRate != null && ch.total == null && next.total === r.total
            ? { before: `IVA ${eurText(r.vatTotal)}`, after: `IVA ${eurText(next.vatTotal)}`, amount: next.total }
            : { before: eurText(r.total), after: eurText(next.total), amount: next.total }
      : ch.supplierId !== undefined || ch.supplierName ? { before: r.supplier ?? 'Sin proveedor', after: supplierName }
        : ch.categoryId !== undefined ? { before: r.category ?? 'Sin categoría', after: categoryName }
          : ch.deductiblePct != null ? { before: `${pctText(r.deductiblePct)} deducible`, after: `${pctText(ch.deductiblePct)} deducible` }
            : ch.number !== undefined ? { before: r.number ?? 'Sin número', after: ch.number ?? 'Sin número' }
              : ch.dueDate !== undefined ? { before: r.dueDate ? fd(r.dueDate) : 'Sin vencimiento', after: ch.dueDate ? fd(ch.dueDate) : 'Sin vencimiento' }
                : ch.issueDate ? { before: fd(r.issueDate), after: fd(ch.issueDate) }
                  : {}
    rows.push(expenseRow(r, extra))
  }
  if (!targets.length && failed.size) throw new OpError(capital([...failed.keys()][0]!), { avisos: skippedText(failed, n) })
  if (!targets.length) throw new OpError('Esos gastos ya lo tienen: no hay nada que cambiar', { avisos: warnings })

  if (totalChanged.length) {
    const paid = totalChanged.filter(r => r.status === 'paid').length
    const linked = await bankLinked(ctx.company.id, totalChanged.map(r => r.id))
    if (paid) warnings.push(`${count(paid, 'estaba pagado', 'estaban pagados')}: ${paid === 1 ? 'sigue pagado' : 'siguen pagados'} por el nuevo total.`)
    if (linked.size) warnings.push(`${count(linked.size, 'está conciliado', 'están conciliados')} con un cargo del banco: con el nuevo total el pago ya no cuadrará con el movimiento.`)
  }
  if (odd) warnings.push(odd)
  warnings.push(...skippedText(failed, n))
  if (unchanged) warnings.push(`${count(unchanged, 'ya lo tenía y no se toca', 'ya lo tenían y no se tocan')}.`)

  const only = Object.keys(ch).filter(k => k !== 'vatDeductiblePct' || ch.deductiblePct == null)
  const onlyAmounts = only.every(k => (EXPENSE_AMOUNT_KEYS as readonly string[]).includes(k))
  const title = only.length === 1 && ch.categoryId !== undefined ? `Cambiar la categoría de ${n(targets.length)}`
    : only.length === 1 && (ch.supplierId !== undefined || ch.supplierName) ? `Cambiar el proveedor de ${n(targets.length)}`
      : only.length === 1 && ch.deductiblePct != null ? `Cambiar la deducibilidad de ${n(targets.length)}`
        : onlyAmounts ? `Cambiar el importe de ${n(targets.length)}`
          : `Modificar ${n(targets.length)}`
  return {
    kind: 'gastos.modificar',
    title,
    risk: 'normal',
    params: { ids: targets.map(r => r.id), labels: labels(targets), changes: ch },
    preview: preview(rows, { scope, change: capital(parts.join(' · ')), total: sum(rows.map((x, i) => x.amount ?? targets[i]!.total)), undoable: true, warnings }),
  }
}

// Columnas de un gasto que guardan las operaciones para poder deshacerlas
const EXPENSE_FIELDS = Object.freeze(['supplierId', 'supplier', 'categoryId', 'kind', 'number', 'deductiblePct', 'vatDeductiblePct', 'issueDate', 'dueDate', 'description', 'paymentMethod', 'taxBase', 'vatTotal', 'surchargeTotal', 'irpfRate', 'irpfTotal', 'total', 'paidTotal', 'status', 'paidAt', 'notes', 'isInvestment', 'reverseCharge', 'reviewed', 'reviewNotes'] as const)

type ExpenseRow = typeof tables.expenses.$inferSelect
type ExpenseSnapshot = { id: number, row: Partial<ExpenseRow>, lines: Array<{ base: number, vatRate: number, vatAmount: number, surchargeRate: number, surchargeAmount: number }> }

/**
 * Cambia campos de un gasto con las reglas de importes de nextExpenseLines. Si cambia el total, el
 * estado de pago se recalcula (uno pagado sigue pagado por el nuevo total). Devuelve cómo estaba.
 */
async function updateExpenseFields(companyId: number, id: number, ch: ExpenseChangeSet): Promise<ExpenseSnapshot> {
  const db = useDb()
  const e = tables.expenses
  const tl = tables.expenseTaxLines
  const [row] = await db.select().from(e).where(and(eq(e.id, id), eq(e.companyId, companyId)))
  if (!row) throw new OpError('Ya no existe')
  const lines = await db.select().from(tl).where(eq(tl.expenseId, id)).orderBy(tl.id)
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
  if (ch.dueDate !== undefined) {
    if (ch.dueDate && ch.dueDate < (ch.issueDate ?? row.issueDate)) throw new OpError('El vencimiento quedaría antes de la fecha del gasto')
    set.dueDate = ch.dueDate
  }
  if (ch.number !== undefined) set.number = ch.number
  if (ch.description !== undefined) set.description = ch.description
  if (ch.notes !== undefined) set.notes = ch.notes
  if (ch.paymentMethod !== undefined) set.paymentMethod = ch.paymentMethod
  if (ch.isInvestment != null) set.isInvestment = ch.isInvestment
  if (ch.reverseCharge != null) set.reverseCharge = ch.reverseCharge
  if (ch.reviewed != null) Object.assign(set, ch.reviewed ? { reviewed: true, reviewNotes: null } : { reviewed: false })

  let newLines: ReturnType<typeof expenseTotals>['lines'] | null = null
  const next = nextExpenseLines(row, lines.map(l => ({ base: l.base, vatRate: l.vatRate, vatAmount: l.vatAmount, surchargeRate: l.surchargeRate })), ch)
  if (next) {
    const totals = expenseTotals(next)
    newLines = totals.lines
    Object.assign(set, { taxBase: totals.taxBase, vatTotal: totals.vatTotal, surchargeTotal: totals.surchargeTotal, irpfRate: next.irpfRate, irpfTotal: totals.irpfTotal, total: totals.total })
    if (row.status === 'paid') set.paidTotal = totals.total
    else {
      const full = row.paidTotal > 0 && row.paidTotal >= totals.total - 0.005
      set.status = full ? 'paid' : row.paidTotal > 0 ? 'partial' : 'pending'
      if (full) set.paidAt = new Date()
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
      t.skip(id, capital(errText(err)))
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

type UnpayUndo = { id: number, before: PayUndo['before'], payments: Array<{ amount: number, date: string, method: Pay, notes: string | null, bankAccountId: number | null }>, banked: boolean }

/** Vuelven a pendientes de pago: se borran sus pagos y sus movimientos del banco quedan por revisar */
async function expensesUnpay(ctx: OpCtx, p: { ids: number[], labels: Record<string, string> }): Promise<OpOutcome> {
  const t = new Tally(p.labels)
  const db = useDb()
  const e = tables.expenses
  const rows = await db.select().from(e).where(and(eq(e.companyId, ctx.company.id), inArray(e.id, p.ids)))
  const byId = new Map(rows.map(r => [r.id, r]))
  const open: ExpenseRow[] = []
  for (const id of p.ids) {
    const r = byId.get(id)
    if (!r) t.skip(id, 'Ya no existe')
    else if (r.status === 'pending') t.skip(id, 'Ya estaba pendiente')
    else open.push(r)
  }
  if (!open.length) return { result: t.result(), undo: { items: [] } }
  const ids = open.map(r => r.id)
  const [pays, linked] = await Promise.all([
    db.select().from(tables.payments).where(and(eq(tables.payments.companyId, ctx.company.id), inArray(tables.payments.expenseId, ids))),
    bankLinked(ctx.company.id, ids),
  ])
  await unpayExpenses(ctx.company.id, ids)
  t.done = open.length
  const undo: UnpayUndo[] = open.map(r => ({
    id: r.id,
    before: { status: r.status, paidTotal: r.paidTotal, paidAt: r.paidAt, paymentMethod: r.paymentMethod },
    payments: pays.filter(x => x.expenseId === r.id).map(x => ({ amount: x.amount, date: x.date, method: x.method, notes: x.notes, bankAccountId: x.bankAccountId })),
    banked: linked.has(r.id),
  }))
  return { result: t.result(), undo: { items: undo } }
}

async function expensesUnpayRevert(ctx: OpCtx, u: { items: UnpayUndo[] }) {
  const t = new Tally()
  const db = useDb()
  const e = tables.expenses
  for (const item of u.items) {
    try {
      const [row] = await db.select({ status: e.status }).from(e).where(and(eq(e.id, item.id), eq(e.companyId, ctx.company.id)))
      if (!row) throw new OpError('Ya no existe')
      if (row.status !== 'pending') throw new OpError('Ya se ha vuelto a pagar')
      await db.transaction(async (tx) => {
        if (item.payments.length) {
          await tx.insert(tables.payments).values(item.payments.map(x => ({ ...x, companyId: ctx.company.id, direction: 'out' as const, expenseId: item.id })))
        }
        await tx.update(e).set({ ...item.before, paidAt: item.before.paidAt ? new Date(item.before.paidAt) : null }).where(eq(e.id, item.id))
      })
      t.done++
    }
    catch (err) {
      t.skip(item.id, errText(err))
    }
  }
  return t.result({ message: u.items.some(i => i.banked) ? 'Los pagos vuelven a estar, pero sin enlazar con el banco: concílialos de nuevo en Banco si hace falta.' : null })
}

type ApprovalUndo = { id: number, approval: ExpenseRow['approval'], approvedBy: number | null, approvedAt: string | Date | null, rejectReason: string | null }

async function expensesDecide(ctx: OpCtx, p: { ids: number[], labels: Record<string, string>, reason: string | null }, decision: 'approve' | 'reject'): Promise<OpOutcome> {
  if (ctx.actor.role !== 'owner' && ctx.actor.role !== 'admin') throw new OpError('Solo el titular o un administrador pueden aprobar o rechazar gastos')
  const t = new Tally(p.labels)
  const e = tables.expenses
  const rows = await useDb().select({ id: e.id, approval: e.approval, approvedBy: e.approvedBy, approvedAt: e.approvedAt, rejectReason: e.rejectReason })
    .from(e).where(and(eq(e.companyId, ctx.company.id), inArray(e.id, p.ids)))
  const open = rows.filter(r => r.approval === 'pending' || (decision === 'approve' && r.approval === 'rejected'))
  const ok = new Set(open.map(r => r.id))
  for (const id of p.ids) if (!ok.has(id)) t.skip(id, rows.some(r => r.id === id) ? 'Ya no está pendiente de aprobación' : 'Ya no existe')
  if (open.length) t.done = (await decideExpenses(ctx.company.id, ctx.actor.id, open.map(r => r.id), decision, p.reason)).done
  return { result: t.result(), undo: { items: open satisfies ApprovalUndo[] } }
}

async function expensesDecideRevert(ctx: OpCtx, u: { items: ApprovalUndo[] }) {
  const t = new Tally()
  const e = tables.expenses
  for (const item of u.items) {
    try {
      const res = await useDb().update(e).set({ approval: item.approval, approvedBy: item.approvedBy, approvedAt: item.approvedAt ? new Date(item.approvedAt) : null, rejectReason: item.rejectReason })
        .where(and(eq(e.id, item.id), eq(e.companyId, ctx.company.id)))
      if (!res[0].affectedRows) throw new OpError('Ya no existe')
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
  /** Un pago de varias facturas: todas ellas (la primera es salesDocumentId) */
  salesDocumentIds?: number[] | null
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
  if (tx.status === 'matched' && tx.salesDocumentId && tx.groupPaymentIds?.length) {
    const rows = await useDb().select({ doc: tables.payments.salesDocumentId }).from(tables.payments).where(inArray(tables.payments.id, tx.groupPaymentIds))
    snap.salesDocumentIds = [tx.salesDocumentId, ...rows.map(r => r.doc).filter((x): x is number => !!x)]
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
  else if (snap.ownsPayment && snap.salesDocumentId) await confirmMatch(ctx.company, ctx.actor.id, tx.id, { kind: 'invoice', id: snap.salesDocumentId, ids: snap.salesDocumentIds })
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
  persona_contacto: string | null
  web: string | null
  tipo_persona: string | null
  notas: string | null
  vaciar: string[] | null
}

type ContactSet = Partial<Pick<Contact, 'name' | 'tradeName' | 'contactPerson' | 'kind' | 'nif' | 'email' | 'phone' | 'website' | 'address' | 'postalCode' | 'city' | 'province' | 'country' | 'iban' | 'paymentTermsDays' | 'irpfRate' | 'equivalenceSurcharge' | 'isClient' | 'isSupplier' | 'defaultCategoryId' | 'notes'>>

const CONTACT_FIELD_TEXT: Readonly<Record<string, string>> = Object.freeze({
  name: 'nombre', tradeName: 'nombre comercial', contactPerson: 'persona de contacto', kind: 'tipo', nif: 'NIF', email: 'email', phone: 'teléfono', website: 'web',
  address: 'dirección', postalCode: 'código postal', city: 'ciudad', province: 'provincia', country: 'país', iban: 'IBAN', paymentTermsDays: 'días de pago', irpfRate: 'retención',
  equivalenceSurcharge: 'recargo de equivalencia', isClient: 'cliente', isSupplier: 'proveedor', defaultCategoryId: 'categoría de gasto', notes: 'notas',
})

/** Datos que se pueden dejar en blanco */
const CONTACT_CLEAR: Readonly<Record<string, keyof ContactSet>> = Object.freeze({
  nombre_comercial: 'tradeName', persona_contacto: 'contactPerson', nif: 'nif', email: 'email', telefono: 'phone', web: 'website', direccion: 'address', cp: 'postalCode',
  ciudad: 'city', provincia: 'province', iban: 'iban', dias_pago: 'paymentTermsDays', irpf: 'irpfRate', categoria_gasto: 'defaultCategoryId', notas: 'notes',
})

function contactValue(k: string, v: unknown, categories: Map<number, string>) {
  if (v == null || v === '') return '—'
  if (k === 'irpfRate') return pctText(Number(v))
  if (k === 'paymentTermsDays') return `${v} días`
  if (k === 'kind') return v === 'person' ? 'Persona' : 'Empresa'
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
  set.contactPerson = text(cambios.persona_contacto, 120)
  if (cambios.web?.trim()) set.website = cambios.web.trim().slice(0, 200)
  if (cambios.tipo_persona === 'persona' || cambios.tipo_persona === 'empresa') set.kind = cambios.tipo_persona === 'persona' ? 'person' : 'company'
  set.notes = text(cambios.notas, 5000)
  for (const v of cambios.vaciar ?? []) {
    const k = CONTACT_CLEAR[v]
    if (!k) throw new OpError(`«${v}» no se puede dejar en blanco`)
    if (set[k] != null) throw new OpError(`«${v}»: indica un valor nuevo o vacíalo, no las dos cosas`)
    ;(set as Record<string, unknown>)[k] = null
  }
  for (const k of Object.keys(set) as Array<keyof ContactSet>) if (set[k] === undefined) delete set[k]
  const keys = Object.keys(set) as Array<keyof ContactSet>
  if (!keys.length) throw new OpError('Indica qué quieres cambiar')
  if (set.isClient === false && set.isSupplier === false) throw new OpError('Un contacto tiene que ser cliente, proveedor o ambos')

  const all = await useDb().select({ id: tables.categories.id, name: tables.categories.name }).from(tables.categories).where(eq(tables.categories.companyId, ctx.company.id))
  for (const c of all) categories.set(c.id, c.name)
  const targets = found.filter(c => keys.some(k => c[k] !== set[k]))
  if (!targets.length) throw new OpError('Ya lo tienen así: no hay nada que cambiar')
  const k0 = keys[0]!
  const change = keys.map(k => (set[k] == null ? `sin ${CONTACT_FIELD_TEXT[k]}` : `${CONTACT_FIELD_TEXT[k]}: ${contactValue(k, set[k], categories)}`)).join(' · ')
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
  referencia: string | null
  vaciar: string[] | null
}

type ItemRow = typeof tables.items.$inferSelect
type ItemSet = Partial<Pick<ItemRow, 'name' | 'unitPrice' | 'vatRate' | 'categoryId' | 'kind' | 'unit' | 'description' | 'sku'>>
const ITEM_CLEAR: Readonly<Record<string, 'unit' | 'description' | 'sku' | 'categoryId'>> = Object.freeze({ unidad: 'unit', descripcion: 'description', referencia: 'sku', categoria: 'categoryId' })

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
  if (cambios.referencia?.trim()) {
    if (found.length > 1) throw new OpError('La referencia se cambia de uno en uno: concreta el producto')
    set.sku = cambios.referencia.trim().slice(0, 60)
    parts.push(`referencia ${set.sku}`)
  }
  for (const v of cambios.vaciar ?? []) {
    const k = ITEM_CLEAR[v]
    if (!k) throw new OpError(`«${v}» no se puede dejar en blanco`)
    if (set[k] != null) throw new OpError(`«${v}»: indica un valor nuevo o vacíalo, no las dos cosas`)
    set[k] = null
    parts.push(`sin ${v === 'descripcion' ? 'descripción' : v === 'categoria' ? 'categoría' : v}`)
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

// ═══ Facturas y gastos recurrentes ═══════════════════════════════════════════

export interface RecurringChangesIn {
  nombre: string | null
  base: number | null
  total: number | null
  iva: number | null
  irpf: number | null
  proxima_fecha: string | null
  fecha_fin: string | null
  frecuencia: string | null
  cada: number | null
  concepto: string | null
  categoria: string | null
  contacto: string | null
  forma_pago: string | null
  deducible: number | null
  pagado: boolean | null
  automatico: boolean | null
  enviar_sola: boolean | null
  vaciar: string[] | null
}

type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly'
const FREQ_BY_ES: Readonly<Record<string, Frequency>> = Object.freeze({ semanal: 'weekly', mensual: 'monthly', trimestral: 'quarterly', anual: 'yearly' })
const FREQ_TEXT: Readonly<Record<string, string>> = Object.freeze({ weekly: 'semanal', monthly: 'mensual', quarterly: 'trimestral', yearly: 'anual' })

type RecurringRow = typeof tables.recurrings.$inferSelect

interface RecurringChangeSet {
  name?: string
  taxBase?: number
  total?: number
  vatRate?: number
  irpfRate?: number
  nextDate?: string
  endDate?: string | null
  frequency?: Frequency
  interval?: number
  description?: string | null
  categoryId?: number | null
  contactId?: number
  paymentMethod?: Pay
  deductiblePct?: number
  paid?: boolean
  autoIssue?: boolean
  autoSend?: boolean
}

// Lo que se guarda de cada recurrente para deshacer
const RECURRING_FIELDS = Object.freeze(['name', 'frequency', 'interval', 'startDate', 'nextDate', 'endDate', 'autoIssue', 'autoSend', 'template', 'active', 'lastError'] as const)
type RecurringSnapshot = Partial<Pick<RecurringRow, typeof RECURRING_FIELDS[number]>>

const recurringState = (r: RecurringRow) => {
  const s = recurringStatus(r)
  return s === 'active' ? `próxima ${fd(r.nextDate)}` : s === 'paused' ? 'en pausa' : 'terminado'
}

/** La plantilla de un recurrente con los cambios aplicados y validada como en su pantalla */
function nextRecurringInput(rec: RecurringRow, ch: RecurringChangeSet): RecurringInput {
  const input = recurringInputOf(rec)
  const irpf = input.irpfRate ?? 0
  if (ch.name) input.name = ch.name
  if (ch.nextDate) input.nextDate = ch.nextDate
  if (ch.endDate !== undefined) input.endDate = ch.endDate
  if (ch.frequency) input.frequency = ch.frequency
  if (ch.interval != null) input.interval = ch.interval
  if (ch.description !== undefined) input.description = ch.description
  if (ch.contactId) input.contactId = ch.contactId
  if (ch.paymentMethod) input.paymentMethod = ch.paymentMethod
  if (ch.autoIssue != null) input.autoIssue = ch.autoIssue
  if (ch.autoSend != null) {
    input.autoSend = ch.autoSend
    if (ch.autoSend) input.autoIssue = true
  }
  if (input.autoIssue === false) input.autoSend = false
  if (rec.kind === 'expense') {
    if (ch.categoryId !== undefined) input.categoryId = ch.categoryId
    if (ch.deductiblePct != null) {
      input.deductiblePct = ch.deductiblePct
      input.vatDeductiblePct = ch.deductiblePct
    }
    if (ch.paid != null) input.paid = ch.paid
    const lines = (input.taxLines ?? []).map(l => ({ base: l.base, vatRate: l.vatRate, vatAmount: l.vatAmount ?? null, surchargeRate: l.surchargeRate ?? 0 }))
    const now = expenseTotals({ taxLines: lines, irpfRate: irpf })
    const next = nextExpenseLines({ total: now.total, taxBase: now.taxBase, vatTotal: now.vatTotal, irpfRate: irpf }, lines, ch)
    if (next) {
      input.taxLines = next.taxLines
      input.irpfRate = next.irpfRate
    }
  }
  else {
    if (ch.irpfRate != null) input.irpfRate = ch.irpfRate
    if (ch.vatRate != null || ch.taxBase != null || ch.total != null) {
      const lines = (input.lines ?? []).map(l => ({ ...l, itemId: l.itemId ?? null, discountPct: l.discountPct ?? 0, surchargeRate: l.surchargeRate ?? 0, irpfApplies: l.irpfApplies ?? true }))
      input.lines = nextSalesLines(lines, input.irpfRate ?? 0, { vatRate: ch.vatRate, taxBase: ch.taxBase, total: ch.total }, null)
    }
  }
  const parsed = recurringInputSchema.safeParse(input)
  if (!parsed.success) throw new OpError(parsed.error.issues[0]?.message ?? 'Datos no válidos')
  return parsed.data
}

export async function planRecurrings(ctx: OpCtx, accion: string, de: string | null, rawFilter: unknown, cambios: RecurringChangesIn): Promise<OpPlan> {
  const f = cleanFilter(rawFilter)
  requireScope(f, 'recurrentes')
  const family = de === 'facturas' ? 'invoice' : de === 'gastos' ? 'expense' : null
  const found = await recurringTargets(ctx.company, f, family)
  if (!found.length) {
    const other = f.estado ? (await recurringTargets(ctx.company, { ...f, estado: null }, family)).length : 0
    throw new OpError('No hay facturas ni gastos recurrentes que coincidan con ese filtro', other ? { con_otro_estado: other, sugerencia: 'Sin el filtro de estado sí hay: repite sin él (p. ej. están en pausa)' } : {})
  }
  tooMany(found.length, 'recurrentes')
  const n = (k: number) => count(k, 'recurrente', 'recurrentes')
  const labels = (list: RecurringTarget[]) => labelsOf(list.map(r => ({ id: r.id, label: r.name })))
  const row = (r: RecurringTarget, extra: Partial<AiActionRow> = {}): AiActionRow => ({
    id: r.id,
    label: r.name,
    sub: [r.kind === 'invoice' ? 'Factura' : capital(EXPENSE_KIND_TEXT[r.template.expenseKind ?? 'invoice'] ?? 'gasto'), r.contact, FREQ_TEXT[r.frequency], recurringState(r)].filter(Boolean).join(' · '),
    amount: r.template.total ?? null,
    url: '/recurrentes',
    ...extra,
  })

  if (accion === 'eliminar') {
    return {
      kind: 'recurrentes.eliminar',
      title: found.length === 1 ? `Eliminar «${found[0]!.name}»` : `Eliminar ${n(found.length)}`,
      risk: 'high',
      params: { ids: found.map(r => r.id), labels: labels(found) },
      preview: preview(found.map(r => row(r)), { undoable: true, warnings: ['Dejan de generarse. Lo ya generado (facturas y gastos) se queda como está.'] }),
    }
  }

  if (accion === 'pausar' || accion === 'reanudar') {
    const active = accion === 'reanudar'
    const ok = found.filter(r => (active ? recurringStatus(r) === 'paused' : r.active))
    const finished = active ? found.filter(r => recurringStatus(r) === 'finished').length : 0
    if (!ok.length) throw new OpError(active ? (finished ? 'Ya terminaron: cambia su fecha final para que sigan' : 'No hay ninguno en pausa') : 'Ya están en pausa')
    return {
      kind: 'recurrentes.activar',
      title: `${active ? 'Reanudar' : 'Pausar'} ${n(ok.length)}`,
      risk: 'normal',
      params: { ids: ok.map(r => r.id), labels: labels(ok), active },
      preview: preview(ok.map(r => row(r, { before: active ? 'En pausa' : 'Activo', after: active ? 'Activo' : 'En pausa' })), {
        undoable: true,
        warnings: [
          active ? 'Lo atrasado no se genera: siguen desde hoy.' : 'No se genera nada hasta que se reanuden.',
          finished ? `${count(finished, 'ya terminó', 'ya terminaron')}: cambia su fecha final para que siga.` : '',
        ].filter(Boolean),
      }),
    }
  }

  if (accion !== 'modificar') throw new OpError(`Acción desconocida: ${accion}`)

  const ch: RecurringChangeSet = {}
  const parts: string[] = []
  const kinds = new Set(found.map(r => r.kind))
  if (cambios.nombre?.trim()) {
    if (found.length > 1) throw new OpError('El nombre se cambia de uno en uno: concreta el recurrente')
    ch.name = cambios.nombre.trim().slice(0, 160)
    parts.push(`nombre «${ch.name}»`)
  }
  if (cambios.base != null && cambios.total != null && kinds.has('invoice')) throw new OpError('Indica la base o el total, no los dos: el otro sale de los impuestos')
  if (cambios.base != null) {
    ch.taxBase = amount(cambios.base, 'la base')
    parts.push(`base ${eurText(ch.taxBase)}`)
  }
  if (cambios.total != null) {
    ch.total = amount(cambios.total, 'el total')
    parts.push(`total ${eurText(ch.total)}`)
  }
  if (cambios.iva != null) {
    if (!VALID_VAT.has(cambios.iva)) throw new OpError('Tipo de IVA no válido: 21, 10, 5, 4 o 0')
    ch.vatRate = cambios.iva
    parts.push(`IVA del ${pctText(cambios.iva)}`)
  }
  ch.irpfRate = checkRange(cambios.irpf, 0, 50, 'el porcentaje de retención')
  if (ch.irpfRate != null) parts.push(ch.irpfRate ? `retención del ${pctText(ch.irpfRate)}` : 'sin retención')
  ch.nextDate = date(cambios.proxima_fecha, 'próxima fecha')
  if (ch.nextDate) parts.push(`próxima ${fd(ch.nextDate)}`)
  ch.endDate = date(cambios.fecha_fin, 'fecha final')
  if (ch.endDate) parts.push(`hasta el ${fd(ch.endDate)}`)
  if (cambios.frecuencia) {
    const fq = FREQ_BY_ES[cambios.frecuencia]
    if (!fq) throw new OpError('Frecuencia no válida: semanal, mensual, trimestral o anual')
    ch.frequency = fq
    parts.push(FREQ_TEXT[fq]!)
  }
  if (cambios.cada != null) {
    ch.interval = Math.round(checkRange(cambios.cada, 1, 24, 'el intervalo')!)
    parts.push(`cada ${ch.interval}`)
  }
  if (cambios.concepto?.trim()) {
    ch.description = cambios.concepto.trim().slice(0, 255)
    parts.push('concepto nuevo')
  }
  if (cambios.categoria?.trim()) {
    if (kinds.has('invoice')) throw new OpError('La categoría de gasto solo se cambia en gastos recurrentes')
    const cat = await resolveExpenseCategory(ctx.company.id, cambios.categoria)
    ch.categoryId = cat?.id ?? null
    parts.push(cat ? `categoría ${cat.name}` : 'sin categoría')
  }
  if (cambios.contacto?.trim()) {
    if (kinds.size > 1) throw new OpError('Concreta si son facturas o gastos recurrentes para cambiar el cliente o proveedor')
    const c = await resolveContact(ctx.company.id, cambios.contacto, kinds.has('invoice') ? 'client' : 'supplier')
    ch.contactId = c.id
    parts.push(`${kinds.has('invoice') ? 'cliente' : 'proveedor'} ${c.name}`)
  }
  ch.paymentMethod = payMethod(cambios.forma_pago)
  if (ch.paymentMethod) parts.push(`pago por ${PAY_TEXT[ch.paymentMethod]}`)
  ch.deductiblePct = checkRange(cambios.deducible, 0, 100, 'el porcentaje deducible')
  if (ch.deductiblePct != null) parts.push(`deducible ${pctText(ch.deductiblePct)}`)
  if (cambios.pagado != null) {
    ch.paid = cambios.pagado
    parts.push(ch.paid ? 'se da por pagado' : 'queda pendiente de pago')
  }
  if (cambios.automatico != null) {
    ch.autoIssue = cambios.automatico
    parts.push(ch.autoIssue ? (kinds.has('invoice') ? 'se emite sola' : 'sin revisión') : (kinds.has('invoice') ? 'queda en borrador para revisar' : 'para revisar'))
  }
  if (cambios.enviar_sola != null) {
    if (kinds.has('expense')) throw new OpError('Solo las facturas recurrentes se envían')
    ch.autoSend = cambios.enviar_sola
    parts.push(ch.autoSend ? 'se envía sola' : 'no se envía sola')
  }
  for (const v of cambios.vaciar ?? []) {
    if (v === 'fecha_fin') ch.endDate = null
    else if (v === 'concepto') ch.description = null
    else if (v === 'categoria') ch.categoryId = null
    else throw new OpError(`«${v}» no se puede dejar en blanco`)
    parts.push(v === 'fecha_fin' ? 'sin fecha final' : `sin ${v === 'categoria' ? 'categoría' : v}`)
  }
  for (const k of Object.keys(ch) as Array<keyof RecurringChangeSet>) if (ch[k] === undefined) delete ch[k]
  if (!Object.keys(ch).length) throw new OpError('Indica qué quieres cambiar')

  const rows: AiActionRow[] = []
  const targets: RecurringTarget[] = []
  const failed = new Map<string, number>()
  let unchanged = 0
  for (const r of found) {
    let next: RecurringInput
    try {
      next = nextRecurringInput(r, ch)
    }
    catch (err) {
      if (!(err instanceof OpError)) throw err
      const why = err.message.charAt(0).toLowerCase() + err.message.slice(1)
      failed.set(why, (failed.get(why) ?? 0) + 1)
      continue
    }
    const tpl = buildTemplate(next)
    let current: string | null = null
    try {
      current = JSON.stringify(buildTemplate(nextRecurringInput(r, {})))
    }
    catch {
      // La plantilla guardada no pasa la validación: cualquier cambio la arregla
    }
    const same = next.name === r.name && next.frequency === r.frequency && next.interval === r.interval && next.nextDate === r.nextDate
      && next.endDate === r.endDate && next.autoIssue === r.autoIssue && next.autoSend === r.autoSend && JSON.stringify(tpl) === current
    if (same) {
      unchanged++
      continue
    }
    targets.push(r)
    const before = r.template.total ?? 0
    rows.push(row(r, Math.abs((tpl.total ?? 0) - before) > 0.004
      ? { before: eurText(before), after: eurText(tpl.total ?? 0), amount: tpl.total ?? null }
      : ch.nextDate ? { before: fd(r.nextDate), after: fd(ch.nextDate) } : {}))
  }
  if (!targets.length && failed.size) throw new OpError(capital([...failed.keys()][0]!))
  if (!targets.length) throw new OpError('Ya lo tienen así: no hay nada que cambiar')
  return {
    kind: 'recurrentes.modificar',
    title: targets.length === 1 ? `Modificar «${targets[0]!.name}»` : `Modificar ${n(targets.length)}`,
    risk: 'normal',
    params: { ids: targets.map(r => r.id), labels: labels(targets), changes: ch },
    preview: preview(rows, {
      change: capital(parts.join(' · ')),
      total: sum(rows.map(x => x.amount ?? 0)),
      undoable: true,
      warnings: [
        'Se aplica a lo que se genere a partir de ahora: las facturas y gastos ya generados no cambian.',
        ch.nextDate && ch.nextDate < today() ? 'La próxima fecha ya ha pasado: se generará en la próxima pasada del programador.' : '',
        ...skippedText(failed, n),
        unchanged ? `${count(unchanged, 'ya lo tenía y no se toca', 'ya lo tenían y no se tocan')}.` : '',
      ].filter(Boolean),
    }),
  }
}

const recurringSnapshot = (rec: RecurringRow) => Object.fromEntries(RECURRING_FIELDS.map(k => [k, rec[k]])) as RecurringSnapshot

async function recurringsModify(ctx: OpCtx, p: { ids: number[], labels: Record<string, string>, changes: RecurringChangeSet }): Promise<OpOutcome> {
  const t = new Tally(p.labels)
  const undo: Array<{ id: number, before: RecurringSnapshot }> = []
  for (const id of p.ids) {
    try {
      const rec = await getRecurring(ctx.company.id, id)
      await updateRecurring(ctx.company.id, rec, nextRecurringInput(rec, p.changes))
      undo.push({ id, before: recurringSnapshot(rec) })
      t.done++
    }
    catch (err) {
      t.skip(id, errText(err))
    }
  }
  return { result: t.result({ url: '/recurrentes' }), undo: { items: undo } }
}

async function recurringsActive(ctx: OpCtx, p: { ids: number[], labels: Record<string, string>, active: boolean }): Promise<OpOutcome> {
  const t = new Tally(p.labels)
  const undo: Array<{ id: number, before: RecurringSnapshot }> = []
  for (const id of p.ids) {
    try {
      const rec = await getRecurring(ctx.company.id, id)
      if (p.active ? recurringStatus(rec) !== 'paused' : !rec.active) {
        t.skip(id, p.active ? 'No estaba en pausa' : 'Ya estaba en pausa')
        continue
      }
      await setRecurringActive(rec, p.active)
      undo.push({ id, before: { active: rec.active, nextDate: rec.nextDate, lastError: rec.lastError } })
      t.done++
    }
    catch (err) {
      t.skip(id, errText(err))
    }
  }
  return { result: t.result({ url: '/recurrentes' }), undo: { items: undo } }
}

async function recurringsRevert(ctx: OpCtx, u: { items: Array<{ id: number, before: RecurringSnapshot }> }) {
  const t = new Tally()
  const r = tables.recurrings
  for (const item of u.items) {
    try {
      const res = await useDb().update(r).set(item.before).where(and(eq(r.id, item.id), eq(r.companyId, ctx.company.id)))
      if (!res[0].affectedRows) throw new OpError('Ya no existe')
      t.done++
    }
    catch (err) {
      t.skip(item.id, errText(err))
    }
  }
  return t.result()
}

async function recurringsDelete(ctx: OpCtx, p: { ids: number[], labels: Record<string, string> }): Promise<OpOutcome> {
  const t = new Tally(p.labels)
  const r = tables.recurrings
  const rows = await useDb().select().from(r).where(and(eq(r.companyId, ctx.company.id), inArray(r.id, p.ids)))
  if (rows.length) await useDb().delete(r).where(and(eq(r.companyId, ctx.company.id), inArray(r.id, rows.map(x => x.id))))
  t.done = rows.length
  const gone = new Set(rows.map(x => x.id))
  for (const id of p.ids) if (!gone.has(id)) t.skip(id, 'Ya no existía')
  return { result: t.result({ url: '/recurrentes' }), undo: { rows } }
}

async function recurringsDeleteRevert(ctx: OpCtx, u: { rows: RecurringRow[] }) {
  const t = new Tally()
  for (const x of u.rows) {
    try {
      if (x.companyId !== ctx.company.id) throw new OpError('No es de esta empresa')
      await useDb().insert(tables.recurrings).values({
        ...x,
        lastRunAt: x.lastRunAt ? new Date(x.lastRunAt) : null,
        createdAt: new Date(x.createdAt),
        updatedAt: new Date(x.updatedAt),
      })
      t.done++
    }
    catch (err) {
      t.skip(x.id, errText(err))
    }
  }
  return t.result()
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
  const all = await companyContacts(ctx.company.id)
  const existing = contactMatches(all, input.nif ?? input.name)
    .filter(c => (input.nif && c.nif && normalizeNif(c.nif) === input.nif) || comparableName(c.name) === comparableName(input.name))
  // También el mismo email o NIF escrito de otra forma: nunca dos fichas del mismo contacto
  const similar = existing.length ? null : await findContactDuplicate(ctx.company.id, input)
  const dup = existing[0] ?? all.find(c => c.id === similar?.id)
  if (dup) throw new OpError(`Ya existe «${dup.name}»`, { contacto: { nombre: dup.name, nif: dup.nif, url: contactUrl(dup) } })
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

// ═══ Envíos por email ═══════════════════════════════════════════════════════

export interface SalesEmailIn {
  para: string[]
  copia: string[] | null
  recordatorio: boolean | null
  asunto: string | null
  mensaje: string | null
  adjuntos: boolean | null
}

type EmailItem = { id: number, label: string, to: string[], cc: string[], subject: string, message: string, internal: boolean, attachmentIds: number[], url: string }

const MAX_EMAILS = 25
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}$/

/**
 * Envío de facturas o presupuestos por email. Destinatarios: «cliente» (el email de cada documento),
 * «empresa» (el de Ajustes), «yo» (el del usuario), «gestor» o direcciones concretas. Solo a la
 * empresa o al usuario es una copia interna: admite borradores (salen con la marca BORRADOR).
 */
export async function planSalesEmail(ctx: OpCtx, family: SalesFamily, rawFilter: unknown, o: SalesEmailIn): Promise<OpPlan> {
  if (!mailEnabled()) throw new OpError('El correo de la app no está configurado (GOOGLE_APP_EMAIL y GOOGLE_APP_PASSWORD): no se puede enviar nada')
  const f = cleanFilter(rawFilter)
  const [one, many] = family === 'quote' ? ['presupuesto', 'presupuestos'] : ['factura', 'facturas']
  requireScope(f, many)
  const reminder = !!o.recordatorio
  if (reminder && family === 'quote') throw new OpError('Los recordatorios de pago son para facturas')
  const { rows: found, matched } = await salesTargets(ctx.company, f, family)
  if (!found.length) throw new OpError(`No hay ${many} que coincidan con ese filtro`, { clientes_coincidentes: matched })
  if (found.length > MAX_EMAILS) throw new OpError(`Son ${found.length} ${many}: como mucho ${MAX_EMAILS} envíos de una vez. Acota la petición, por ejemplo por fechas o cliente.`)

  const db = useDb()
  const ids = found.map(r => r.id)
  const [contacts, snapshots, [user], files] = await Promise.all([
    companyContacts(ctx.company.id),
    db.select({ id: tables.salesDocuments.id, customer: tables.salesDocuments.customer }).from(tables.salesDocuments).where(inArray(tables.salesDocuments.id, ids)),
    db.select({ email: tables.users.email }).from(tables.users).where(eq(tables.users.id, ctx.actor.id)),
    o.adjuntos
      ? db.select({ id: tables.files.id, linkedId: tables.files.linkedId, name: tables.files.originalName }).from(tables.files)
          .where(and(eq(tables.files.companyId, ctx.company.id), eq(tables.files.linkedType, 'sales_document'), inArray(tables.files.linkedId, ids)))
      : Promise.resolve([]),
  ])
  const own = new Set([ctx.company.email, user?.email].filter((x): x is string => !!x).map(x => x.toLowerCase()))

  // Destinatarios fijos (todo menos «cliente», que depende de cada documento)
  const fixed = (list: string[], what: string) => {
    const out: string[] = []
    for (const raw of list.map(x => x.trim()).filter(Boolean)) {
      const key = raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      if (key === 'cliente') continue
      if (key === 'empresa') {
        if (!ctx.company.email) throw new OpError('La empresa no tiene email en Ajustes → Empresa: añádelo o dime a qué dirección lo envío')
        out.push(ctx.company.email)
      }
      else if (key === 'yo' || key === 'usuario') {
        if (!user?.email) throw new OpError('Tu usuario no tiene email')
        out.push(user.email)
      }
      else if (key === 'gestor' || key === 'asesor') {
        const a = advisorOf(ctx.company)
        if (!a?.email) throw new OpError('No hay gestor configurado: se añade en Ajustes → Gestoría (/ajustes?s=gestoria)')
        out.push(a.email)
      }
      else if (EMAIL_RE.test(raw)) out.push(raw)
      else throw new OpError(`«${raw}» no es un email válido ${what}`)
    }
    return out
  }
  const wantsClient = (list: string[]) => list.some(x => x.trim().toLowerCase() === 'cliente')
  const fixedTo = fixed(o.para, 'para el destinatario')
  const fixedCc = fixed(o.copia ?? [], 'para la copia')
  if (!fixedTo.length && !wantsClient(o.para)) throw new OpError('Falta el destinatario: el cliente, la empresa, tú o un email')

  const design = await getCompanyDesign(ctx.company)
  const items: EmailItem[] = []
  const skipped: AiActionRow[] = []
  for (const r of found) {
    const contact = contacts.find(c => c.id === r.contactId) ?? null
    const clientEmail = contact?.email || snapshots.find(s => s.id === r.id)?.customer?.email || null
    const uniq = (list: string[]) => [...new Map(list.map(x => [x.toLowerCase(), x])).values()]
    const to = uniq([...(wantsClient(o.para) && clientEmail ? [clientEmail] : []), ...fixedTo])
    const cc = uniq([...(wantsClient(o.copia ?? []) && clientEmail ? [clientEmail] : []), ...fixedCc]).filter(x => !to.some(t => t.toLowerCase() === x.toLowerCase()))
    const label = salesLabel(r)
    if (!to.length) {
      skipped.push(salesRow(r, { after: 'El cliente no tiene email' }))
      continue
    }
    const internal = [...to, ...cc].every(x => own.has(x.toLowerCase()))
    if (r.status === 'draft' && !internal) {
      throw new OpError(`${label} de ${r.client ?? 'sin cliente'} es un borrador: solo puede enviarse a la empresa o a ti para revisarla. Para mandarla al cliente hay que emitirla antes (operar_facturas emitir).`)
    }
    if (reminder && round2(r.total - r.paidTotal) <= 0) {
      skipped.push(salesRow(r, { after: 'Ya está cobrada' }))
      continue
    }
    const texts = salesEmailTexts(ctx.company, design, r, contact, { reminder, internal })
    items.push({
      id: r.id,
      label: `${label} · ${r.client ?? 'sin cliente'}`,
      to,
      cc,
      subject: o.asunto?.trim().slice(0, 200) || texts.subject,
      message: o.mensaje?.trim().slice(0, 5000) || texts.message,
      internal,
      attachmentIds: files.filter(x => x.linkedId === r.id).map(x => x.id).slice(0, 10),
      url: salesUrl(r),
    })
  }
  if (!items.length) throw new OpError(skipped.some(s => s.after === 'Ya está cobrada') ? 'Esas facturas ya están cobradas: no hay nada que recordar' : 'Ninguno tiene email del cliente: añádelo en su ficha o dime a qué dirección lo envío')

  const rows = found.filter(r => items.some(i => i.id === r.id)).map((r) => {
    const i = items.find(x => x.id === r.id)!
    return salesRow(r, { sub: [r.client, `Para ${i.to.join(', ')}`, i.cc.length ? `CC ${i.cc.join(', ')}` : ''].filter(Boolean).join(' · ') })
  })
  const drafts = found.filter(r => r.status === 'draft' && items.some(i => i.id === r.id)).length
  const allInternal = items.every(i => i.internal)
  const first = items[0]!
  const what = reminder ? count(items.length, 'recordatorio de pago', 'recordatorios de pago') : count(items.length, one, many)
  const recipients = [...new Set(items.flatMap(i => i.to))]
  const firstNumber = found.find(r => r.id === first.id)!.number
  const single = `${reminder ? 'el recordatorio de la' : family === 'quote' ? 'el' : 'la'} ${one} ${firstNumber ?? 'en borrador'}`
  return {
    kind: 'ventas.enviar',
    title: items.length === 1 && recipients.length === 1 ? `Enviar ${single} a ${recipients[0]}` : `Enviar ${what} por email`,
    risk: 'normal',
    params: { items, kind: reminder ? 'reminder' : 'document', labels: labelsOf(items) },
    preview: preview(rows, {
      scope: recipients.length === 1 ? `Para: ${recipients[0]}` : null,
      total: sum(found.filter(r => items.some(i => i.id === r.id)).map(r => r.total)),
      undoable: false,
      change: allInternal ? 'Copia para ti, con el PDF: no cuenta como enviada al cliente' : reminder ? 'Recordatorio de pago con el PDF' : 'Por email con el PDF',
      email: {
        subject: first.subject,
        message: first.message,
        attachments: [pdfFilename(found.find(r => r.id === first.id)!.kind, firstNumber), ...files.filter(x => first.attachmentIds.includes(x.id)).map(x => x.name)],
      },
      warnings: [
        drafts ? `${count(drafts, 'va', 'van')} con la marca BORRADOR: es solo para revisar, no se emite ni se envía al cliente.` : '',
        allInternal ? '' : 'El correo sale en cuanto confirmes y no se puede deshacer.',
        skipped.length ? `${count(skipped.length, 'documento se queda', 'documentos se quedan')} fuera: ${names(skipped.map(s => `${s.label} (${s.after})`), 3)}.` : '',
        items.length > 1 ? 'El texto de abajo es el del primero: cada envío lleva sus datos.' : '',
      ].filter(Boolean),
    }),
  }
}

async function salesSend(ctx: OpCtx, p: { items: EmailItem[], kind: 'document' | 'reminder', labels: Record<string, string> }): Promise<OpOutcome> {
  const t = new Tally(p.labels)
  const site = String(useRuntimeConfig().siteUrl || '')
  const sentTo = new Set<string>()
  for (const i of p.items) {
    try {
      await sendSalesEmail(ctx.company, ctx.actor.id, i.id, {
        to: i.to, cc: i.cc, subject: i.subject, message: i.message, kind: p.kind, attachPdf: true, attachmentIds: i.attachmentIds, internal: i.internal,
      }, site)
      i.to.forEach(x => sentTo.add(x))
      t.done++
    }
    catch (err) {
      t.skip(i.id, errText(err))
    }
  }
  return {
    result: t.result({ message: sentTo.size ? `Enviado a ${names([...sentTo], 3)}` : null, url: p.items.length === 1 ? p.items[0]!.url : null }),
    undo: null,
  }
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
    case 'ventas.estado': return salesSetStatus(ctx, params)
    case 'ventas.borrador': return salesBackToDraft(ctx, params)
    case 'ventas.convertir': return salesConvert(ctx, params)
    case 'ventas.enviar': return salesSend(ctx, params)
    case 'gastos.modificar': return expensesModify(ctx, params)
    case 'gastos.eliminar': return expensesDelete(ctx, params)
    case 'gastos.pagar': return expensesPay(ctx, params)
    case 'gastos.pendiente': return expensesUnpay(ctx, params)
    case 'gastos.aprobar': return expensesDecide(ctx, params, 'approve')
    case 'gastos.rechazar': return expensesDecide(ctx, params, 'reject')
    case 'gastos.crear': return expenseCreate(ctx, params)
    case 'recurrentes.modificar': return recurringsModify(ctx, params)
    case 'recurrentes.activar': return recurringsActive(ctx, params)
    case 'recurrentes.eliminar': return recurringsDelete(ctx, params)
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
    case 'ventas.estado': return salesSetStatusRevert(ctx, undo)
    case 'ventas.convertir': return salesConvertRevert(ctx, undo)
    case 'gastos.modificar': return expensesModifyRevert(ctx, undo)
    case 'gastos.pagar': return expensesPayRevert(ctx, undo)
    case 'gastos.pendiente': return expensesUnpayRevert(ctx, undo)
    case 'gastos.aprobar':
    case 'gastos.rechazar': return expensesDecideRevert(ctx, undo)
    case 'gastos.crear': return expenseCreateRevert(ctx, undo)
    case 'recurrentes.modificar':
    case 'recurrentes.activar': return recurringsRevert(ctx, undo)
    case 'recurrentes.eliminar': return recurringsDeleteRevert(ctx, undo)
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
