import type { SQL } from 'drizzle-orm'
import { and, desc, eq, gte, inArray, isNull, like, lt, lte, notInArray, or, sql } from 'drizzle-orm'

/**
 * Qué registros toca una petición del asistente («las facturas de Galván», «los cargos de Mercadona»).
 * El modelo describe un filtro; aquí se convierte en filas concretas, siempre de la empresa activa.
 */

type Company = typeof tables.companies.$inferSelect
type Contact = typeof tables.contacts.$inferSelect

/** Error de una petición que el modelo debe resolver con el usuario (no encontrado, ambiguo…) */
export class OpError extends Error {
  constructor(message: string, readonly data: Record<string, unknown> = {}) {
    super(message)
  }
}

export interface OpFilter {
  ids: number[] | null
  todos: boolean
  nombres: string[] | null
  texto: string | null
  estado: string | null
  tipo: string | null
  categoria: string | null
  desde: string | null
  hasta: string | null
  importe_min: number | null
  importe_max: number | null
  numeros: string[] | null
}

/** Máximo de registros en una sola operación (igual que las acciones en lote de la app) */
export const MAX_TARGETS = 500

export function isISODate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v
}

/** Filtro limpio: textos recortados, fechas válidas y nada que no sea del tipo esperado */
export function cleanFilter(raw: unknown): OpFilter {
  const f = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const strs = (v: unknown) => {
    const list = Array.isArray(v) ? v.map(x => String(x ?? '').trim()).filter(Boolean).slice(0, 30) : []
    return list.length ? list : null
  }
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null)
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const date = (v: unknown, field: string) => {
    if (v == null || v === '') return null
    if (!isISODate(v)) throw new OpError(`La fecha «${String(v)}» de ${field} no es válida: usa AAAA-MM-DD`)
    return v
  }
  const ids = Array.isArray(f.ids) ? [...new Set(f.ids.map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 2000) : []
  return {
    ids: ids.length ? ids : null,
    todos: f.todos === true,
    nombres: strs(f.nombres),
    texto: str(f.texto),
    estado: str(f.estado),
    tipo: str(f.tipo),
    categoria: str(f.categoria),
    desde: date(f.desde, 'desde'),
    hasta: date(f.hasta, 'hasta'),
    importe_min: num(f.importe_min),
    importe_max: num(f.importe_max),
    numeros: strs(f.numeros),
  }
}

export function hasCriteria(f: OpFilter) {
  return !!(f.ids || f.nombres || f.texto || f.estado || f.tipo || f.categoria || f.desde || f.hasta || f.importe_min != null || f.importe_max != null || f.numeros)
}

/** Una operación sin filtro tocaría todo: solo si el modelo lo pide expresamente */
export function requireScope(f: OpFilter, what: string) {
  if (!hasCriteria(f) && !f.todos) {
    throw new OpError(`Indica qué ${what}: un nombre, fechas, estado, números… Para tocar todos, usa todos: true solo si el usuario lo ha pedido así`)
  }
}

const likeTerm = (s: string) => `%${s.trim().slice(0, 80).replace(/[\\%_]/g, m => `\\${m}`)}%`

// ─── Contactos ───────────────────────────────────────────────────────────────

export async function companyContacts(companyId: number, withArchived = true) {
  const c = tables.contacts
  return useDb().select().from(c).where(and(eq(c.companyId, companyId), withArchived ? undefined : isNull(c.archivedAt)))
}

/** Contactos que encajan con un nombre o NIF: primero el NIF, después el nombre exacto y por último el parcial */
export function contactMatches<T extends Pick<Contact, 'name' | 'tradeName' | 'nif'>>(contacts: T[], q: string): T[] {
  const query = q.trim()
  const nif = normalizeNif(query)
  if (nif.length >= 8) {
    const byNif = contacts.filter(c => c.nif && normalizeNif(c.nif) === nif)
    if (byNif.length) return byNif
  }
  const target = comparableName(query)
  if (!target) return []
  const names = (c: T) => [comparableName(c.name), comparableName(c.tradeName)].filter(Boolean)
  const exact = contacts.filter(c => names(c).includes(target))
  if (exact.length) return exact
  const words = target.split(' ').filter(w => w.length > 1)
  return contacts.filter(c => names(c).some(n => n.includes(target) || (words.length > 1 && words.every(w => n.includes(w)))))
}

/** Un único contacto (destino de un cambio): si no hay o hay varios, el modelo pregunta */
export async function resolveContact(companyId: number, q: string, role: 'client' | 'supplier' | 'any') {
  const all = await companyContacts(companyId, false)
  const pool = role === 'client' ? all.filter(x => x.isClient) : role === 'supplier' ? all.filter(x => x.isSupplier) : all
  let hits = contactMatches(pool, q)
  if (!hits.length && role !== 'any') hits = contactMatches(all, q)
  const what = role === 'client' ? 'cliente' : role === 'supplier' ? 'proveedor' : 'contacto'
  if (!hits.length) throw new OpError(`No hay ningún ${what} que coincida con «${q}»`, { sugerencia: 'Pregunta si es otro nombre o si quiere crearlo (crear_contacto)' })
  if (hits.length > 1) {
    throw new OpError(`Hay ${hits.length} contactos que coinciden con «${q}»: pregunta cuál`, {
      candidatos: hits.slice(0, 8).map(x => ({ nombre: x.name, nif: x.nif, cliente: x.isClient, proveedor: x.isSupplier })),
    })
  }
  return hits[0]!
}

// ─── Categorías ──────────────────────────────────────────────────────────────

const CATEGORY_HINTS: ReadonlyArray<{ re: RegExp, code: string | null, name: RegExp }> = Object.freeze([
  { re: /asesor|gestor|abogad|notar|profesional/, code: '623', name: /asesor|profesional/i },
  { re: /suministro|luz|agua|gas|electric/, code: '628', name: /suministro/i },
  { re: /nomina|sueldo|salario/, code: '640', name: /sueldo|n[oó]mina/i },
  { re: /seguridad social|reta|autonomo/, code: '642', name: /seguridad social|aut[oó]nomo/i },
  { re: /banco|comision/, code: '626', name: /bancari|comisi/i },
  { re: /combustible|gasolina|gasoil|diesel/, code: null, name: /combustible|transporte/i },
  { re: /software|informatic|servidor|hosting/, code: null, name: /software|inform[aá]tic/i },
  { re: /alquiler|arrendamiento|local|oficina/, code: '621', name: /arrendamiento|alquiler/i },
  { re: /seguro/, code: '625', name: /seguro/i },
  { re: /publicidad|marketing|anuncio/, code: '627', name: /publicidad|marketing/i },
  { re: /comida|restaurante|dieta|viaje|hotel/, code: null, name: /dieta|viaje|restaura/i },
])

/** Categoría de gasto por nombre o cuenta. null = «sin categoría» pedido expresamente */
export async function resolveExpenseCategory(companyId: number, name: string) {
  const target = comparableName(name)
  if (/^(ninguna|sin categoria|quitar|ninguno)$/.test(target)) return null
  const all = await useDb().select().from(tables.categories)
    .where(and(eq(tables.categories.companyId, companyId), eq(tables.categories.kind, 'expense')))
  let hit = all.find(c => comparableName(c.name) === target || c.accountCode === name.trim())
    ?? all.find(c => comparableName(c.name).includes(target) || target.includes(comparableName(c.name)))
  if (!hit) {
    const hint = CATEGORY_HINTS.find(h => h.re.test(target))
    if (hint) hit = all.find(c => (hint.code && c.accountCode === hint.code) || hint.name.test(c.name))
  }
  if (!hit) throw new OpError(`No hay ninguna categoría de gasto «${name}»`, { categorias: all.map(c => c.name) })
  return hit
}

export async function resolveItemCategory(companyId: number, name: string) {
  const target = comparableName(name)
  if (/^(ninguna|sin categoria|quitar|ninguno)$/.test(target)) return null
  const all = await useDb().select().from(tables.itemCategories).where(eq(tables.itemCategories.companyId, companyId))
  const hit = all.find(c => comparableName(c.name) === target) ?? all.find(c => comparableName(c.name).includes(target))
  if (!hit) throw new OpError(`No hay ninguna categoría de productos «${name}»`, { categorias: all.map(c => c.name) })
  return hit
}

// ─── Ventas ──────────────────────────────────────────────────────────────────

export type SalesFamily = 'invoice' | 'quote'

function salesStatus(estado: string | null, family: SalesFamily): SQL | undefined {
  const s = tables.salesDocuments
  const open = ['issued', 'sent', 'partial'] as const
  switch (estado) {
    case 'borrador': return eq(s.status, 'draft')
    case 'emitida': return family === 'quote' ? inArray(s.status, ['issued', 'sent']) : notInArray(s.status, ['draft', 'cancelled'])
    case 'pendiente': return family === 'quote' ? inArray(s.status, ['issued', 'sent']) : inArray(s.status, [...open])
    case 'cobrada': return eq(s.status, 'paid')
    case 'vencida': return and(inArray(s.status, [...open]), lt(s.dueDate, toISODate(new Date())))
    case 'anulada': return eq(s.status, 'cancelled')
    case 'aceptado': return eq(s.status, 'accepted')
    case 'rechazado': return eq(s.status, 'rejected')
    case 'facturado': return eq(s.status, 'invoiced')
    case 'caducado': return eq(s.status, 'expired')
    default: return undefined
  }
}

export async function salesTargets(company: Company, f: OpFilter, family: SalesFamily, limit = MAX_TARGETS + 1) {
  const s = tables.salesDocuments
  const c = tables.contacts
  const conds: Array<SQL | undefined> = [
    eq(s.companyId, company.id),
    inArray(s.kind, family === 'quote' ? ['quote', 'proforma'] : f.tipo === 'rectificativa' ? ['rectifying'] : ['invoice', 'rectifying']),
    salesStatus(f.estado, family),
  ]
  if (f.ids) conds.push(inArray(s.id, f.ids))
  if (f.numeros) conds.push(inArray(s.number, f.numeros))
  if (f.desde) conds.push(gte(s.issueDate, f.desde))
  if (f.hasta) conds.push(lte(s.issueDate, f.hasta))
  if (f.importe_min != null) conds.push(gte(s.total, f.importe_min))
  if (f.importe_max != null) conds.push(lte(s.total, f.importe_max))
  const matched = new Map<number, string>()
  if (f.nombres) {
    const contacts = await companyContacts(company.id)
    const ors: Array<SQL | undefined> = []
    for (const name of f.nombres) {
      const hits = contactMatches(contacts, name)
      for (const h of hits) matched.set(h.id, h.name)
      if (hits.length) ors.push(inArray(s.contactId, hits.map(h => h.id)))
      // Documentos sin ficha (importados o de un contacto borrado): por el nombre guardado
      ors.push(and(isNull(s.contactId), sql`JSON_UNQUOTE(JSON_EXTRACT(${s.customer}, '$.name')) LIKE ${likeTerm(name)}`))
    }
    conds.push(or(...ors))
  }
  if (f.texto) {
    const term = likeTerm(f.texto)
    conds.push(or(
      sql`EXISTS (SELECT 1 FROM sales_document_lines l WHERE l.document_id = ${s.id} AND l.description LIKE ${term})`,
      like(s.notes, term),
      like(s.customerReference, term),
    ))
  }
  const rows = await useDb().select({
    id: s.id, kind: s.kind, status: s.status, number: s.number, issueDate: s.issueDate, dueDate: s.dueDate,
    total: s.total, paidTotal: s.paidTotal, irpfRate: s.irpfRate, contactId: s.contactId,
    client: sql<string | null>`COALESCE(${c.name}, JSON_UNQUOTE(JSON_EXTRACT(${s.customer}, '$.name')))`,
  }).from(s).leftJoin(c, eq(c.id, s.contactId))
    .where(and(...conds))
    .orderBy(desc(s.issueDate), desc(s.id))
    .limit(limit)
  return { rows, matched: [...matched.values()] }
}

export type SalesTarget = Awaited<ReturnType<typeof salesTargets>>['rows'][number]

// ─── Gastos ──────────────────────────────────────────────────────────────────

export const EXPENSE_KIND_BY_ES: Readonly<Record<string, 'invoice' | 'ticket' | 'payroll' | 'social_security' | 'tax' | 'other'>> = Object.freeze({
  factura: 'invoice', ticket: 'ticket', nomina: 'payroll', seguridad_social: 'social_security', impuesto: 'tax', otro: 'other',
})

export async function expenseTargets(company: Company, f: OpFilter, limit = MAX_TARGETS + 1) {
  const e = tables.expenses
  const c = tables.contacts
  const k = tables.categories
  const conds: Array<SQL | undefined> = [eq(e.companyId, company.id)]
  if (f.ids) conds.push(inArray(e.id, f.ids))
  if (f.numeros) conds.push(inArray(e.number, f.numeros))
  if (f.desde) conds.push(gte(e.issueDate, f.desde))
  if (f.hasta) conds.push(lte(e.issueDate, f.hasta))
  if (f.importe_min != null) conds.push(gte(e.total, f.importe_min))
  if (f.importe_max != null) conds.push(lte(e.total, f.importe_max))
  if (f.estado === 'pendiente') conds.push(inArray(e.status, ['pending', 'partial']))
  else if (f.estado === 'pagada' || f.estado === 'cobrada') conds.push(eq(e.status, 'paid'))
  const kind = f.tipo ? EXPENSE_KIND_BY_ES[f.tipo] : undefined
  if (kind) conds.push(eq(e.kind, kind))
  if (f.categoria) {
    const cat = await resolveExpenseCategory(company.id, f.categoria)
    conds.push(cat ? eq(e.categoryId, cat.id) : isNull(e.categoryId))
  }
  const matched = new Map<number, string>()
  if (f.nombres) {
    const contacts = await companyContacts(company.id)
    const ors: Array<SQL | undefined> = []
    for (const name of f.nombres) {
      const hits = contactMatches(contacts, name)
      for (const h of hits) matched.set(h.id, h.name)
      if (hits.length) ors.push(inArray(e.supplierId, hits.map(h => h.id)))
      const term = likeTerm(name)
      ors.push(sql`JSON_UNQUOTE(JSON_EXTRACT(${e.supplier}, '$.name')) LIKE ${term}`, like(e.description, term))
    }
    conds.push(or(...ors))
  }
  if (f.texto) {
    const term = likeTerm(f.texto)
    conds.push(or(like(e.description, term), like(e.notes, term), like(e.number, term)))
  }
  const rows = await useDb().select({
    id: e.id, kind: e.kind, status: e.status, number: e.number, issueDate: e.issueDate, description: e.description,
    total: e.total, paidTotal: e.paidTotal, taxBase: e.taxBase, vatTotal: e.vatTotal, irpfRate: e.irpfRate,
    deductiblePct: e.deductiblePct, vatDeductiblePct: e.vatDeductiblePct, fileId: e.fileId,
    supplierId: e.supplierId, categoryId: e.categoryId, category: k.name,
    supplier: sql<string | null>`COALESCE(${c.name}, JSON_UNQUOTE(JSON_EXTRACT(${e.supplier}, '$.name')))`,
  }).from(e).leftJoin(c, eq(c.id, e.supplierId)).leftJoin(k, eq(k.id, e.categoryId))
    .where(and(...conds))
    .orderBy(desc(e.issueDate), desc(e.id))
    .limit(limit)
  return { rows, matched: [...matched.values()] }
}

export type ExpenseTarget = Awaited<ReturnType<typeof expenseTargets>>['rows'][number]

// ─── Banco ───────────────────────────────────────────────────────────────────

/** ¿Aparece el texto (o todas sus palabras) en el concepto, el ordenante o la referencia? */
export function txMatches(tx: { description: string, counterparty: string | null, reference: string | null }, q: string) {
  const text = comparableName(`${tx.description} ${tx.counterparty ?? ''} ${tx.reference ?? ''}`)
  const target = comparableName(q)
  if (!target) return false
  if (text.includes(target)) return true
  const words = target.split(' ').filter(w => w.length > 2)
  return words.length > 0 && words.every(w => text.includes(w))
}

export async function bankTargets(company: Company, f: OpFilter) {
  const t = tables.bankTransactions
  const conds: Array<SQL | undefined> = [eq(t.companyId, company.id)]
  if (f.ids) conds.push(inArray(t.id, f.ids))
  if (f.desde) conds.push(gte(t.date, f.desde))
  if (f.hasta) conds.push(lte(t.date, f.hasta))
  if (f.importe_min != null) conds.push(sql`ABS(${t.amount}) >= ${f.importe_min}`)
  if (f.importe_max != null) conds.push(sql`ABS(${t.amount}) <= ${f.importe_max}`)
  if (f.tipo === 'cargo') conds.push(lt(t.amount, 0))
  else if (f.tipo === 'abono') conds.push(gte(t.amount, 0.005))
  if (f.estado === 'pendiente') conds.push(eq(t.status, 'pending'))
  else if (f.estado === 'conciliado') conds.push(eq(t.status, 'matched'))
  else if (f.estado === 'ignorado') conds.push(eq(t.status, 'ignored'))
  const rows = await useDb().select().from(t).where(and(...conds)).orderBy(desc(t.date), desc(t.id)).limit(20_000)
  const texts = [...(f.nombres ?? []), ...(f.texto ? [f.texto] : [])]
  return texts.length ? rows.filter(tx => texts.some(q => txMatches(tx, q))) : rows
}

export type BankTarget = Awaited<ReturnType<typeof bankTargets>>[number]

// ─── Contactos y productos ───────────────────────────────────────────────────

export async function contactTargets(company: Company, f: OpFilter) {
  let rows = (await companyContacts(company.id, false))
  if (f.ids) rows = rows.filter(c => f.ids!.includes(c.id))
  if (f.nombres) {
    const hit = new Set(f.nombres.flatMap(n => contactMatches(rows, n).map(c => c.id)))
    rows = rows.filter(c => hit.has(c.id))
  }
  if (f.tipo === 'cliente') rows = rows.filter(c => c.isClient)
  else if (f.tipo === 'proveedor') rows = rows.filter(c => c.isSupplier)
  if (f.texto) {
    const q = comparableName(f.texto)
    rows = rows.filter(c => comparableName([c.email, c.city, c.province, c.notes, c.phone].filter(Boolean).join(' ')).includes(q))
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

export async function itemTargets(company: Company, f: OpFilter) {
  const i = tables.items
  let rows = await useDb().select().from(i).where(and(eq(i.companyId, company.id), isNull(i.archivedAt)))
  if (f.ids) rows = rows.filter(x => f.ids!.includes(x.id))
  if (f.nombres) {
    const names = f.nombres.map(n => comparableName(n)).filter(Boolean)
    rows = rows.filter(x => names.some(n => comparableName(x.name).includes(n) || (x.sku && comparableName(x.sku) === n)))
  }
  if (f.texto) {
    const q = comparableName(f.texto)
    rows = rows.filter(x => comparableName(`${x.name} ${x.description ?? ''}`).includes(q))
  }
  if (f.tipo === 'servicio') rows = rows.filter(x => x.kind === 'service')
  else if (f.tipo === 'producto') rows = rows.filter(x => x.kind === 'product')
  if (f.categoria) {
    const cat = await resolveItemCategory(company.id, f.categoria)
    rows = rows.filter(x => (cat ? x.categoryId === cat.id : x.categoryId == null))
  }
  if (f.importe_min != null) rows = rows.filter(x => x.unitPrice >= f.importe_min!)
  if (f.importe_max != null) rows = rows.filter(x => x.unitPrice <= f.importe_max!)
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'es'))
}
