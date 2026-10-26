import { createHash } from 'node:crypto'
import { and, desc, eq, gte, inArray, isNotNull, lte, ne } from 'drizzle-orm'
import type { BankSuggestion } from '../db/schema'
import { bankContactMatcher, learnContactFromTx, type BankContactHit } from './bank-contacts'
import { nameInText, significantWords, similarNames } from '../../shared/utils/duplicate-matching'

type Company = typeof tables.companies.$inferSelect
type BankTx = typeof tables.bankTransactions.$inferSelect

const DAY = 86_400_000
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY)
const shiftDay = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10)
/** Texto comparable: sin tildes, mayúsculas ni signos */
const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const compact = (s: string) => plain(s).replace(/\s/g, '')
const LEGAL = new Set(['sl', 'slu', 'sa', 'slp', 'sll', 'scp', 'cb', 'sociedad', 'limitada', 'anonima', 'del', 'las', 'los', 'and', 'the', 'grupo'])

/** Tolerancia para discrepancias de redondeo o ajustes bancarios al conciliar (en euros) */
export const MATCH_TOLERANCE = 1.00

/**
 * ¿Aparece el nombre en el concepto del banco? Parte de las palabras significativas que salen (también
 * abreviadas: «LUMEN ARQUIT» por «Lumen Arquitectura») o, si sale entero con erratas o en siglas, 1.
 */
function nameScore(name: string | null | undefined, text: string) {
  if (!name) return 0
  const words = plain(name).split(' ').filter(w => w.length > 2 && !LEGAL.has(w))
  if (!words.length) return 0
  const t = ` ${plain(text)} `
  const tokens = t.trim().split(' ')
  const hits = words.filter(w => t.includes(` ${w} `) || (w.length >= 5 && t.includes(w)) || (w.length >= 6 && tokens.some(tk => tk.length >= 4 && w.startsWith(tk)))).length
  const whole = nameInText(name, text)
  return Math.max(hits / words.length, whole > 0 ? Math.min(1, whole / Math.max(1, significantWords(name).length)) : 0)
}

/** Palabras que en un concepto anuncian el número de una factura: «FRA 46», «FACTURA Nº 46», «INV-46» */
const INVOICE_WORD = 'fra|fras|fact|facts|factura|facturas|fac|fct|ft|inv|invoice|n|no|num|numero|ref|referencia|recibo'

/**
 * ¿Aparece el número del documento en el concepto?
 * 2 = sin dudas: entero (F2026-0046) o con su año (46/2026, 2026-46).
 * 1 = probable: tras «fra», «factura nº», su serie («F-46»), con el año corto (46/26) o en una lista
 *     de facturas («FRAS 45 Y 46»).
 */
function numberInText(number: string | null | undefined, text: string): 0 | 1 | 2 {
  if (!number || number.length < 3) return 0
  const n = compact(number)
  if (n.length >= 4 && compact(text).includes(n)) return 2
  const tail = number.match(/(\d+)\D*$/)?.[1]?.replace(/^0+/, '')
  const year = number.match(/(20\d{2})/)?.[1]
  if (!tail || tail === year) return 0
  // plain() deja los números separados por espacios: "fra 42/2026" → "fra 42 2026"
  const p = plain(text)
  if (year && tail.length >= 2 && new RegExp(`\\b0*${tail} ${year}\\b|\\b${year} 0*${tail}\\b`).test(p)) return 2
  if (year && tail.length >= 2 && new RegExp(`\\b0*${tail} ${year.slice(2)}\\b|\\b${year.slice(2)} 0*${tail}\\b`).test(p)) return 1
  // Tras «fra», «factura nº» o su serie, también en listas: «FRAS 45 Y 46», «FACTURAS 8, 9 Y 10»
  const series = plain(number.match(/^[A-Za-z]{1,4}/)?.[0] ?? '')
  const lead = new Set([...INVOICE_WORD.split('|'), ...(series ? [series] : [])])
  const tokens = p.split(' ')
  for (let i = 0; i < tokens.length; i++) {
    if (!lead.has(tokens[i]!)) continue
    for (let j = i + 1; j < tokens.length; j++) {
      const tk = tokens[j]!
      if (/^\d+$/.test(tk)) {
        if (tk.replace(/^0+/, '') === tail) return 1
      }
      else if (!LIST_GLUE.has(tk)) break
    }
  }
  return 0
}

/** Palabras que unen los números de una lista de facturas */
const LIST_GLUE = new Set(['y', 'e', 'n', 'no', 'num', 'numero', 'and'])

/** Reglas sin IA para los cargos más típicos de un autónomo o pyme */
interface Rule { re: RegExp, sign: -1 | 1 | 0, make: (cat: (code: string, name: RegExp) => number | null, bank: string | null) => Omit<BankSuggestion, 'confidence' | 'source'> }
const RULES: ReadonlyArray<Rule> = Object.freeze([
  {
    re: /seg(uridad)? ?soc|tgss|tesoreria general|cuota (de )?autonom|\breta\b|regimen especial (de )?trabajadores/,
    sign: -1,
    make: cat => ({ kind: 'new_expense', label: 'Cuota de autónomos', detail: 'Seguridad Social (sin IVA)', expenseKind: 'social_security', categoryId: cat('642', /aut[oó]nomo|seguridad social/i), supplier: 'Tesorería General de la Seguridad Social', vatRate: 0 }),
  },
  {
    re: /\baeat\b|agencia (estatal (de )?administracion )?tributaria|hacienda publica|\bmod(elo)? ?(303|130|131|111|115|200|202|390)\b|impuesto/,
    sign: 0,
    make: () => ({ kind: 'ignore', label: 'Pago o devolución de impuestos', detail: 'No es un gasto: se anota en Impuestos' }),
  },
  {
    re: /comision|cuota (de )?mantenimiento|gastos? (de )?(correo|mantenimiento|gestion)|cuota (anual )?tarjeta|liquidacion (de )?intereses|intereses deudores|descubierto/,
    sign: -1,
    make: (cat, bank) => ({ kind: 'new_expense', label: 'Comisión bancaria', detail: 'Servicio financiero exento de IVA', expenseKind: 'other', categoryId: cat('626', /comisi|bancari/i), supplier: bank, vatRate: 0 }),
  },
  {
    re: /traspaso|transferencia (entre cuentas|propia|interna)|ahorro/,
    sign: 0,
    make: () => ({ kind: 'ignore', label: 'Traspaso entre tus cuentas', detail: 'No es ingreso ni gasto' }),
  },
  {
    re: /\bnomina\b/,
    sign: -1,
    make: cat => ({ kind: 'new_expense', label: 'Nómina', detail: 'Sueldos y salarios', expenseKind: 'payroll', categoryId: cat('640', /sueldo|salario|n[oó]mina/i), supplier: null, vatRate: 0 }),
  },
])

/**
 * Propuestas de conciliación de los movimientos pendientes:
 * 1. Cobros y pagos ya anotados (mismo importe, fechas cercanas) → solo se enlazan.
 * 2. Facturas emitidas con cobro pendiente: por su número en el concepto, su cliente (IBAN, NIF, lo aprendido
 *    o el nombre) y el importe; también un abono que paga varias facturas del mismo cliente a la vez.
 * 3. Gastos sin pagar por el importe exacto y gastos ya pagados sin movimiento.
 * 4. Reglas (cuota de autónomos, comisiones, impuestos, traspasos) y, si hay IA, categoría para el resto de
 *    cargos y la factura que pagan los abonos que no casan solos.
 * Cada factura o gasto va a un solo movimiento: se reparten de la propuesta más segura a la menos.
 */
export async function suggestMatches(company: Company, ids?: number[]) {
  const db = useDb()
  const t = tables.bankTransactions
  const txs = await db.select().from(t).where(and(eq(t.companyId, company.id), eq(t.status, 'pending'), ...(ids?.length ? [inArray(t.id, ids)] : [])))
  if (!txs.length) return 0
  const since = toISODate(new Date(Date.now() - 600 * DAY))

  const [linked, invoices, expenses, payments, categories, accounts, contactsOf] = await Promise.all([
    db.select({ paymentId: t.paymentId, expenseId: t.expenseId, salesDocumentId: t.salesDocumentId }).from(t)
      .where(and(eq(t.companyId, company.id), eq(t.status, 'matched'))),
    db.select({
      id: tables.salesDocuments.id, number: tables.salesDocuments.number, customer: tables.salesDocuments.customer, contactId: tables.salesDocuments.contactId, issueDate: tables.salesDocuments.issueDate,
      dueDate: tables.salesDocuments.dueDate, total: tables.salesDocuments.total, paidTotal: tables.salesDocuments.paidTotal, kind: tables.salesDocuments.kind, description: tables.salesDocuments.description,
    }).from(tables.salesDocuments).where(and(
      eq(tables.salesDocuments.companyId, company.id), inArray(tables.salesDocuments.kind, ['invoice', 'rectifying']),
      inArray(tables.salesDocuments.status, ['issued', 'sent', 'partial']),
    )),
    db.select({
      id: tables.expenses.id, number: tables.expenses.number, supplier: tables.expenses.supplier, supplierId: tables.expenses.supplierId, description: tables.expenses.description,
      issueDate: tables.expenses.issueDate, dueDate: tables.expenses.dueDate, total: tables.expenses.total, paidTotal: tables.expenses.paidTotal, status: tables.expenses.status,
    }).from(tables.expenses).where(and(eq(tables.expenses.companyId, company.id), gte(tables.expenses.issueDate, since))),
    db.select({
      id: tables.payments.id, direction: tables.payments.direction, amount: tables.payments.amount, date: tables.payments.date,
      salesDocumentId: tables.payments.salesDocumentId, expenseId: tables.payments.expenseId,
    }).from(tables.payments).where(and(eq(tables.payments.companyId, company.id), gte(tables.payments.date, since))),
    db.select({ id: tables.categories.id, name: tables.categories.name, accountCode: tables.categories.accountCode }).from(tables.categories)
      .where(and(eq(tables.categories.companyId, company.id), eq(tables.categories.kind, 'expense'))),
    db.select({ id: tables.bankAccounts.id, bankName: tables.bankAccounts.bankName }).from(tables.bankAccounts).where(eq(tables.bankAccounts.companyId, company.id)),
    bankContactMatcher(company.id),
  ])
  const usedPayments = new Set(linked.map(l => l.paymentId).filter(Boolean))
  const usedExpenses = new Set(linked.map(l => l.expenseId).filter(Boolean))
  const docNames = new Map<number, { number: string | null, name: string | null, contactId: number | null }>()
  for (const inv of invoices) docNames.set(inv.id, { number: inv.number, name: inv.customer?.name ?? null, contactId: inv.contactId })
  // Documentos de los cobros ya registrados (facturas cobradas): número y cliente para el texto
  const paidDocIds = [...new Set(payments.map(p => p.salesDocumentId).filter((x): x is number => !!x && !docNames.has(x)))]
  if (paidDocIds.length) {
    const rows = await db.select({ id: tables.salesDocuments.id, number: tables.salesDocuments.number, customer: tables.salesDocuments.customer, contactId: tables.salesDocuments.contactId })
      .from(tables.salesDocuments).where(inArray(tables.salesDocuments.id, paidDocIds))
    for (const r of rows) docNames.set(r.id, { number: r.number, name: r.customer?.name ?? null, contactId: r.contactId })
  }
  const expenseById = new Map(expenses.map(e => [e.id, e]))
  const cat = (code: string, name: RegExp) => categories.find(c => c.accountCode === code && name.test(c.name))?.id ?? categories.find(c => name.test(c.name))?.id ?? null
  // Facturas con algo por cobrar, de la más antigua a la más reciente (así se reparten los pagos iguales)
  const open = invoices.map(inv => ({ ...inv, pending: round2(inv.total - inv.paidTotal) })).filter(inv => inv.pending > 0)
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.id - b.id)

  /** Propuestas posibles de cada movimiento, con lo que ocupan y lo necesario para desempatar */
  const pool = new Map<number, Candidate[]>()
  /** Cliente o proveedor reconocido en cada movimiento (IBAN, NIF, lo aprendido o el nombre) */
  const who = new Map<number, BankContactHit>()
  for (const tx of txs) {
    const amount = Math.abs(tx.amount)
    const text = `${tx.description} ${tx.counterparty ?? ''} ${tx.reference ?? ''}`
    const candidates: Candidate[] = []
    const near = (d: string) => Math.abs(daysBetween(d, tx.date))
    const contact = contactsOf.identify(tx)
    if (contact) who.set(tx.id, contact)
    /** Puntos por ser de ese cliente o proveedor: lo que da su nombre en el concepto, o más si le reconocen su IBAN, su NIF o el historial */
    const party = (contactId: number | null | undefined, name: string | null | undefined, weight: number) =>
      Math.max(Math.round(nameScore(name, text) * weight), contact && contactId === contact.id ? Math.round(weight * Math.min(1, contact.score / 90)) : 0)

    if (tx.amount > 0) {
      for (const p of payments) {
        const diff = Math.abs(p.amount - amount)
        if (p.direction !== 'in' || usedPayments.has(p.id) || diff > MATCH_TOLERANCE || near(p.date) > 10) continue
        const doc = p.salesDocumentId ? docNames.get(p.salesDocumentId) : null
        const exact = diff <= 0.01
        const num = numberInText(doc?.number, text)
        const score = (exact ? 72 : 64) + (num === 2 ? 20 : num ? 12 : 0) + party(doc?.contactId, doc?.name, 15) - near(p.date)
        candidates.push({ kind: 'payment', id: p.id, label: `Cobro ya anotado${doc?.number ? ` · ${doc.number}` : ''}${exact ? '' : ' (±1 €)'}`, detail: doc?.name ?? null, confidence: score, source: 'match', keys: [`payment:${p.id}`], date: p.date })
      }
      const numbered = new Map(open.map(inv => [inv.id, numberInText(inv.number, text)]))
      const ofClient = (inv: typeof open[number]) => (!!contact && inv.contactId === contact.id) || nameScore(inv.customer?.name, text) >= 0.5
      for (const inv of open) {
        const num = numbered.get(inv.id)!
        const diff = Math.abs(inv.pending - amount)
        const exact = diff <= 0.01
        const nearAmount = diff <= MATCH_TOLERANCE
        // Su cliente pagó un poco menos: comisión de la transferencia o redondeo (hasta 15 € o el 3 %)
        const shortBy = ofClient(inv) && amount < inv.pending && inv.pending - amount <= Math.max(15, inv.pending * 0.03)
        if (!exact && !nearAmount && !shortBy && !(num === 2 && amount < inv.pending)) continue
        let score = exact ? 62 : nearAmount ? 58 : shortBy ? 52 : 50
        score += num === 2 ? 26 : num ? 14 : 0
        score += party(inv.contactId, inv.customer?.name, 18)
        // Cobrada antes de emitirla: raro (un anticipo), salvo por un par de días
        if (daysBetween(inv.issueDate, tx.date) < -2) score -= 25
        if (inv.dueDate && Math.abs(daysBetween(inv.dueDate, tx.date)) <= 7) score += 3
        const missing = exact || nearAmount ? '' : shortBy ? ` (faltan ${eurText(round2(inv.pending - amount))})` : ' (cobro parcial)'
        candidates.push({
          kind: 'invoice', id: inv.id, label: `Factura ${inv.number}${exact ? '' : nearAmount ? ' (±1 €)' : missing}`, detail: inv.customer?.name ?? null,
          confidence: score, source: 'match', contactId: inv.contactId, keys: [`invoice:${inv.id}`], date: inv.issueDate, pending: inv.pending, num,
        })
      }
      candidates.push(...invoiceGroups(tx, amount, open.filter(inv => (ofClient(inv) || numbered.get(inv.id)) && daysBetween(inv.issueDate, tx.date) >= -2), party))
    }
    else {
      for (const p of payments) {
        const diff = Math.abs(p.amount - amount)
        if (p.direction !== 'out' || usedPayments.has(p.id) || diff > MATCH_TOLERANCE || near(p.date) > 10) continue
        const e = p.expenseId ? expenseById.get(p.expenseId) : null
        const exact = diff <= 0.01
        const score = (exact ? 72 : 64) + party(e?.supplierId, e?.supplier?.name, 18) - near(p.date)
        candidates.push({ kind: 'payment', id: p.id, label: `Pago ya anotado${e?.supplier?.name ? ` · ${e.supplier.name}` : ''}${exact ? '' : ' (±1 €)'}`, detail: e?.description ?? null, confidence: score, source: 'match', keys: [`payment:${p.id}`], date: p.date })
      }
      for (const e of expenses) {
        if (usedExpenses.has(e.id)) continue
        const pending = round2(e.total - e.paidTotal)
        const unpaid = e.status !== 'paid'
        // Pendiente: lo que falta; pagado (sin movimiento): el total
        const target = unpaid ? pending : e.total
        const diff = Math.abs(target - amount)
        const exact = diff <= 0.01
        const nearAmount = diff <= MATCH_TOLERANCE
        if (!exact && !nearAmount) continue
        const gap = daysBetween(e.issueDate, tx.date)
        if (gap < -7 || gap > (unpaid ? 120 : 45)) continue
        // Sin proveedor (tickets, cuota de autónomos…) la descripción también identifica el gasto
        const name = Math.max(nameScore(e.supplier?.name, text), nameScore(e.description, text), contact && e.supplierId === contact.id ? Math.min(1, contact.score / 90) : 0)
        let score = (unpaid ? (exact ? 62 : 56) : (exact ? 55 : 50)) + Math.round(name * 22) + (numberInText(e.number, text) ? 15 : 0)
        // Pagado y sin nombre en común: solo cuenta si la fecha casi coincide (evita duplicar gastos ya anotados)
        if (!unpaid && name === 0 && Math.abs(gap) > 3) score -= 15
        // Gastos que se repiten cada mes por el mismo importe: manda la fecha más cercana
        score -= unpaid ? Math.min(12, Math.floor(Math.abs(gap) / 5)) : Math.min(25, Math.round(Math.abs(gap) * 0.8))
        if (Math.abs(gap) <= 5 && name >= 0.5) score += 10
        candidates.push({ kind: 'expense', id: e.id, label: `${unpaid ? 'Gasto pendiente' : 'Gasto'} · ${e.supplier?.name ?? e.description ?? 'sin proveedor'}${exact ? '' : ' (±1 €)'}`, detail: e.number ? `Factura ${e.number}` : e.description ?? null, confidence: score, source: 'match', contactId: e.supplierId, keys: [`expense:${e.id}`], date: e.issueDate })
      }
    }
    pool.set(tx.id, candidates)
  }

  const results = assignCandidates(txs, pool)

  for (const tx of txs) {
    if (results.get(tx.id)) continue
    const contact = who.get(tx.id)
    const text = `${tx.description} ${tx.counterparty ?? ''} ${tx.reference ?? ''}`
    const p = plain(text)
    const rule = RULES.find(r => r.re.test(p) && (r.sign === 0 || Math.sign(tx.amount) === r.sign))
    const bank = accounts.find(a => a.id === tx.accountId)?.bankName ?? null
    let best: BankSuggestion | null = null
    if (rule) best = { ...rule.make(cat, bank), confidence: 95, source: 'rule' }
    else if (tx.bankCode === '17' && tx.amount < 0) best = { ...RULES[2]!.make(cat, bank), confidence: 90, source: 'rule' }
    // Cargo de un proveedor conocido con gastos anteriores: el mismo tipo, categoría e IVA que la última vez
    else if (contact?.usual && tx.amount < 0 && contact.usual.vatRate != null) {
      const usual = contact.usual
      const category = categories.find(c => c.id === usual.categoryId)
      best = {
        kind: 'new_expense', label: `${contact.name}${category ? ` · ${category.name}` : ''}`, detail: `${contact.reason}. Como su último gasto`,
        confidence: Math.min(90, contact.score), source: 'rule', expenseKind: usual.kind,
        categoryId: usual.categoryId, supplier: contact.name, vatRate: usual.vatRate, contactId: contact.id,
      }
    }
    results.set(tx.id, best)
  }

  if (await aiEnabled()) {
    // IA: la factura (o facturas) que paga cada abono sin propuesta clara, entre las que nadie más se lleva
    const unsure = txs.filter((tx) => {
      const s = results.get(tx.id)
      return tx.amount > 0 && (!s || ((s.kind === 'invoice' || s.kind === 'payment') && s.confidence <= 60))
    })
    if (unsure.length && open.length) {
      try {
        const held = new Map<string, number>()
        for (const [txId, s] of results) {
          if (s?.kind === 'invoice') for (const id of s.ids?.length ? s.ids : [s.id!]) held.set(`invoice:${id}`, txId)
        }
        const ai = await invoicesWithAi(company, unsure, open, held, who)
        for (const [id, s] of ai) if (s.confidence > (results.get(id)?.confidence ?? 0)) results.set(id, s)
      }
      catch (err) {
        console.warn('[banco] facturas IA', (err as Error).message)
      }
    }

    // IA: categoría para los cargos que no casan con nada, eligiendo entre tus proveedores si es uno de ellos
    const rest = txs.filter(tx => !results.get(tx.id) && tx.amount < 0)
    if (rest.length) {
      try {
        const ai = await categorizeWithAi(company, rest, categories, contactsOf.suppliers, who)
        for (const [id, s] of ai) results.set(id, s)
      }
      catch (err) {
        console.warn('[banco] categorías IA', (err as Error).message)
      }
    }
  }

  // Gasto nuevo de un proveedor reconocido: su ficha (no otra con el nombre del banco) y lo que se le suele anotar
  for (const [id, s] of results) {
    const contact = who.get(id)
    if (s?.kind !== 'new_expense' || !contact || s.contactId) continue
    // Comisiones y cuotas de las reglas llevan su propio proveedor: solo si es él (el propio banco)
    if (s.source === 'rule' && s.supplier && !similarNames(s.supplier, contact.name)) continue
    s.contactId = contact.id
    s.supplier = contact.name
    if (contact.usual?.categoryId && !s.categoryId) s.categoryId = contact.usual.categoryId
    s.detail = [contact.reason, s.detail].filter(Boolean).join('. ')
  }

  // Gastos nuevos: con la deducibilidad que el usuario suele marcar para ese proveedor o categoría
  const fresh = [...results.values()].filter((s): s is BankSuggestion => s?.kind === 'new_expense')
  if (fresh.length) {
    const guess = await deductibleGuesser(company.id)
    for (const s of fresh) {
      const g = guess({ supplierId: s.contactId, supplierName: s.supplier, categoryId: s.categoryId })
      s.deductiblePct = g.deductiblePct
      s.vatDeductiblePct = g.vatDeductiblePct
    }
  }

  await Promise.all([...results].map(([id, suggestion]) => db.update(t).set({ suggestion }).where(eq(t.id, id))))
  return [...results.values()].filter(Boolean).length
}

/** Propuesta en estudio: lo que ocupa (`invoice:12`, `expense:4`…) y datos para desempatar */
type Candidate = BankSuggestion & {
  keys: string[]
  /** Fecha del documento o del cobro: a igualdad, el más antiguo primero */
  date: string
  /** Factura suelta: lo que tiene pendiente y si su número sale en el concepto */
  pending?: number
  num?: number
}

type OpenInvoice = { id: number, number: string | null, customer: { name?: string | null } | null, contactId: number | null, issueDate: string, dueDate: string | null, pending: number }

/** ¿Son del mismo cliente? Por su ficha o, sin ficha, por el nombre de la factura */
function sameCustomer(a: OpenInvoice, b: OpenInvoice) {
  return a.contactId && b.contactId ? a.contactId === b.contactId : !!a.customer?.name && plain(a.customer.name) === plain(b.customer?.name ?? '')
}

/**
 * Un abono que paga de una vez varias facturas del mismo cliente: combinaciones de 2 a 5 de sus facturas
 * pendientes cuya suma es el importe. Solo de un cliente reconocido o con los números en el concepto.
 */
function invoiceGroups(
  tx: BankTx, amount: number, pool: OpenInvoice[],
  party: (contactId: number | null | undefined, name: string | null | undefined, weight: number) => number,
): Candidate[] {
  const out: Candidate[] = []
  // Por cliente: nunca se mezclan facturas de dos clientes en un mismo pago
  const byCustomer: OpenInvoice[][] = []
  for (const inv of pool.filter(inv => inv.pending < amount + MATCH_TOLERANCE)) {
    const group = byCustomer.find(g => sameCustomer(g[0]!, inv))
    if (group) group.push(inv)
    else byCustomer.push([inv])
  }
  for (const all of byCustomer) {
    if (all.length < 2) continue
    // Las más recientes primero si son muchas: el cliente suele pagar lo último que se le ha facturado
    const list = all.length > 22 ? all.slice(-22) : all
    const maxSize = list.length > 14 ? 4 : 5
    const found: OpenInvoice[][] = []
    const walk = (start: number, picked: OpenInvoice[], sum: number) => {
      if (found.length > 40) return
      if (picked.length >= 2 && Math.abs(round2(sum) - amount) <= MATCH_TOLERANCE) found.push([...picked])
      if (picked.length >= maxSize) return
      for (let i = start; i < list.length; i++) {
        const next = sum + list[i]!.pending
        if (next > amount + MATCH_TOLERANCE) continue
        picked.push(list[i]!)
        walk(i + 1, picked, next)
        picked.pop()
      }
    }
    walk(0, [], 0)
    for (const group of found) {
      const sum = round2(group.reduce((s, inv) => s + inv.pending, 0))
      const exact = Math.abs(sum - amount) <= 0.01
      const nums = group.map(inv => numberInText(inv.number, `${tx.description} ${tx.counterparty ?? ''} ${tx.reference ?? ''}`))
      const allNumbered = nums.every(Boolean)
      const someNumbered = nums.some(Boolean)
      const first = group[0]!
      const who = party(first.contactId, first.customer?.name, 18)
      // Sin cliente reconocido, solo si el concepto nombra todas las facturas
      if (!who && !allNumbered) continue
      // Salda justo todo lo que el cliente tenía pendiente: lo más habitual al pagar varias
      const clears = group.length === all.length
      let score = (exact ? 60 : 55) + who + (allNumbered ? 26 : someNumbered ? 8 : 0) + (clears ? 8 : 0) - (group.length - 2) * 3
      out.push({
        kind: 'invoice', id: first.id, ids: group.map(inv => inv.id),
        label: `Facturas ${group.map(inv => inv.number).join(' + ')}${exact ? '' : ' (±1 €)'}`,
        detail: `${first.customer?.name ?? 'Mismo cliente'} · ${clears ? `todas sus facturas pendientes (${group.length})` : `${group.length} facturas`} en un solo pago`,
        confidence: score, source: 'match', contactId: first.contactId,
        keys: group.map(inv => `invoice:${inv.id}`), date: first.issueDate,
      })
    }
  }
  return out
}

/**
 * Reparte las propuestas: de la más segura a la menos, cada factura, gasto o cobro va a un solo movimiento.
 * A igualdad, la factura más antigua al movimiento más antiguo. Si a un movimiento le queda otra opción casi
 * igual de buena, la confianza baja para que lo decida el usuario; salvo que sean facturas idénticas del mismo
 * cliente (cuotas mensuales): entonces se cobra la más antigua.
 */
function assignCandidates(txs: BankTx[], pool: Map<number, Candidate[]>) {
  const dateOf = new Map(txs.map(tx => [tx.id, tx.date]))
  const pairs = [...pool].flatMap(([txId, list]) => list.map(c => ({ txId, c })))
  pairs.sort((a, b) => b.c.confidence - a.c.confidence || a.c.date.localeCompare(b.c.date) || dateOf.get(a.txId)!.localeCompare(dateOf.get(b.txId)!) || a.txId - b.txId)
  const taken = new Set<string>()
  const results = new Map<number, BankSuggestion | null>()
  const twins = (a: Candidate, b: Candidate) => a.kind === 'invoice' && b.kind === 'invoice' && !a.ids && !b.ids && !a.num && !b.num
    && a.contactId != null && a.contactId === b.contactId && a.pending === b.pending
  for (const { txId, c } of pairs) {
    if (results.get(txId) || c.keys.some(k => taken.has(k))) continue
    const second = pool.get(txId)!.filter(o => o !== c && !o.keys.some(k => taken.has(k))).sort((a, b) => b.confidence - a.confidence)[0]
    let confidence = c.confidence
    let detail = c.detail
    if (second && second.confidence >= confidence - 5) {
      if (twins(c, second)) {
        confidence = Math.min(confidence, 78)
        detail = [detail, 'La más antigua de sus facturas iguales'].filter(Boolean).join(' · ')
      }
      else confidence = Math.min(confidence, 60)
    }
    confidence = Math.max(1, Math.min(99, confidence))
    if (confidence < 50) continue
    const { keys, date: _date, pending: _pending, num: _num, ...suggestion } = c
    results.set(txId, { ...suggestion, detail, confidence })
    for (const k of keys) taken.add(k)
  }
  return results
}

const AI_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'type', 'categoryId', 'contactId', 'supplier', 'vatRate', 'confidence', 'note'],
        properties: {
          id: { type: 'integer' },
          contactId: { type: ['integer', 'null'], description: 'Id del proveedor de la lista si el cargo es suyo (AMZN Mktp = Amazon, PAYPAL *ADOBE = Adobe…); null si no está' },
          type: { type: 'string', enum: ['expense', 'social_security', 'tax_payment', 'payroll', 'transfer', 'loan', 'personal', 'unknown'] },
          categoryId: { type: ['integer', 'null'] },
          supplier: { type: ['string', 'null'], description: 'Nombre limpio del comercio o proveedor (Endesa, Amazon, Repsol…)' },
          vatRate: { type: ['number', 'null'], description: 'IVA habitual en España para ese gasto: 21, 10, 4 o 0' },
          confidence: { type: 'integer', description: '0-100' },
          note: { type: 'string', description: 'Explicación breve en español' },
        },
      },
    },
  },
}

const AI_IGNORE: Record<string, string> = {
  tax_payment: 'Pago de impuestos',
  transfer: 'Traspaso entre tus cuentas',
  loan: 'Préstamo o financiación',
  personal: 'Gasto personal',
}

async function categorizeWithAi(company: Company, txs: BankTx[], categories: Array<{ id: number, name: string }>, suppliers: Array<{ id: number, name: string, tradeName: string | null }>, known: Map<number, BankContactHit>) {
  const out = new Map<number, BankSuggestion>()
  const supplierById = new Map(suppliers.map(s => [s.id, s]))
  // Los proveedores más habituales: suficientes para reconocerlos sin alargar demasiado la petición
  const list = suppliers.slice(0, 250).map(s => `${s.id}: ${s.name}${s.tradeName && s.tradeName !== s.name ? ` (${s.tradeName})` : ''}`).join('; ')
  for (let i = 0; i < txs.length; i += 60) {
    const chunk = txs.slice(i, i + 60)
    const { data } = await aiJson<{ items: Array<{ id: number, type: string, categoryId: number | null, contactId: number | null, supplier: string | null, vatRate: number | null, confidence: number, note: string }> }>({
      name: 'bank_categories',
      schema: AI_SCHEMA,
      effort: 'low',
      system: [
        'Clasificas cargos de un extracto bancario de una empresa española para su contabilidad.',
        `Empresa: ${company.tradeName || company.legalName} (${company.kind === 'autonomo' ? 'autónomo' : 'sociedad'}${company.activityDescription ? `, ${company.activityDescription}` : ''}).`,
        `Categorías de gasto (id: nombre): ${categories.map(c => `${c.id}: ${c.name}`).join('; ')}.`,
        'Para cada movimiento indica el tipo, la categoría más adecuada (o null), el proveedor limpio y el IVA habitual en España.',
        ...(list ? [`Proveedores que ya tiene (id: nombre): ${list}.`, 'Si el cargo es de uno de ellos, aunque el banco lo escriba abreviado o distinto, pon su id en contactId; si dudas o no está, null. Nunca un id que no esté en la lista.'] : []),
        'Seguridad Social, nóminas, comisiones bancarias, seguros y alquileres de vivienda no llevan IVA (0). Suministros, software y compras: 21 salvo que sepas otro.',
        'Si no lo ves claro, type "unknown" y confianza baja. No inventes.',
      ].join('\n'),
      parts: [{ type: 'input_text', text: JSON.stringify(chunk.map(tx => ({ id: tx.id, fecha: tx.date, importe: tx.amount, concepto: tx.description, ordenante: tx.counterparty, ...(known.has(tx.id) ? { proveedorReconocido: known.get(tx.id)!.id } : {}) }))) }],
    })
    for (const item of data.items) {
      if (!chunk.some(tx => tx.id === item.id) || item.type === 'unknown' || item.confidence < 40) continue
      const confidence = Math.min(85, item.confidence)
      // Lo reconocido sin IA (IBAN, NIF, historial, nombre) manda; la IA solo elige ids de la lista
      const supplier = known.get(item.id) ?? (item.contactId ? supplierById.get(item.contactId) : undefined)
      if (AI_IGNORE[item.type]) {
        out.set(item.id, { kind: 'ignore', label: AI_IGNORE[item.type]!, detail: item.note, confidence, source: 'ai' })
        continue
      }
      const category = categories.find(c => c.id === item.categoryId)
      const name = supplier?.name ?? item.supplier
      out.set(item.id, {
        kind: 'new_expense',
        label: name ? `${name}${category ? ` · ${category.name}` : ''}` : category?.name ?? 'Nuevo gasto',
        detail: item.note,
        confidence,
        source: 'ai',
        expenseKind: item.type === 'social_security' ? 'social_security' : item.type === 'payroll' ? 'payroll' : 'ticket',
        categoryId: category?.id ?? null,
        supplier: name,
        contactId: supplier?.id ?? null,
        vatRate: item.vatRate != null && [0, 4, 5, 10, 21].includes(item.vatRate) ? item.vatRate : 21,
      })
    }
  }
  return out
}

const AI_INVOICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'invoiceIds', 'confidence', 'note'],
        properties: {
          id: { type: 'integer', description: 'Id del abono' },
          invoiceIds: { type: 'array', items: { type: 'integer' }, description: 'Ids de las facturas que paga (varias solo si son del mismo cliente); vacío si ninguna' },
          confidence: { type: 'integer', description: '0-100' },
          note: { type: 'string', description: 'Por qué, en pocas palabras y en español' },
        },
      },
    },
  },
}

/**
 * Abonos sin propuesta clara: la IA busca qué factura pagan con lo que no se puede comparar con reglas (el
 * concepto de la factura, otra razón social del cliente, abreviaturas). Lo que proponga se comprueba: facturas
 * que existan y nadie más se lleve, del mismo cliente y cuya suma pendiente sea el importe del abono.
 */
async function invoicesWithAi(company: Company, txs: BankTx[], open: Array<OpenInvoice & { description: Parameters<typeof salesConcepts>[0][number]['description'] }>, held: Map<string, number>, known: Map<number, BankContactHit>) {
  const out = new Map<number, BankSuggestion>()
  // Las 200 más recientes: suficientes y la petición no se dispara
  const list = open.slice(-200)
  const byId = new Map(list.map(inv => [inv.id, inv]))
  const concepts = await salesConcepts(list.map(inv => ({ id: inv.id, description: inv.description })))
  const facturas = list.map(inv => ({
    id: inv.id, numero: inv.number, cliente: inv.customer?.name ?? null, pendiente: inv.pending, emitida: inv.issueDate, vence: inv.dueDate,
    concepto: concepts.get(inv.id)?.conceptPreview?.slice(0, 90) ?? null,
  }))
  for (let i = 0; i < txs.length; i += 40) {
    const chunk = txs.slice(i, i + 40)
    const { data } = await aiJson<{ items: Array<{ id: number, invoiceIds: number[], confidence: number, note: string }> }>({
      name: 'bank_invoices',
      schema: AI_INVOICE_SCHEMA,
      effort: 'low',
      system: [
        'Concilias abonos (dinero que entra) del extracto bancario de una empresa española con sus facturas emitidas pendientes de cobro.',
        `Empresa: ${company.tradeName || company.legalName}.`,
        'Para cada abono indica qué factura o facturas paga. Puede pagar varias del mismo cliente a la vez: la suma de lo pendiente debe ser el importe. El cliente puede pagar unos euros de menos por comisiones.',
        'Pistas: el número de factura en el concepto aunque venga abreviado ("FRA 52", "52/26", "FACT 0052"), el nombre del cliente en el ordenante (abreviado, en siglas o con la razón social de su grupo), el concepto de la factura y las fechas (el cobro llega tras la emisión, a menudo cerca del vencimiento).',
        'Si no lo ves claro o el abono no es el cobro de una factura (préstamo, devolución, aportación de un socio, traspaso entre cuentas), invoiceIds vacío. Usa solo ids de la lista; nunca los inventes.',
      ].join('\n'),
      parts: [{ type: 'input_text', text: JSON.stringify({
        facturas,
        abonos: chunk.map(tx => ({ id: tx.id, fecha: tx.date, importe: tx.amount, concepto: tx.description, ordenante: tx.counterparty, referencia: tx.reference, ...(known.has(tx.id) ? { clienteReconocido: known.get(tx.id)!.name } : {}) })),
      }) }],
    })
    for (const item of data.items) {
      const tx = chunk.find(x => x.id === item.id)
      const ids = [...new Set(item.invoiceIds)]
      if (!tx || !ids.length || ids.length > 6 || item.confidence < 50) continue
      const invs = ids.map(id => byId.get(id))
      if (invs.some(inv => !inv)) continue
      const picked = invs as OpenInvoice[]
      if (picked.some(inv => (held.get(`invoice:${inv.id}`) ?? tx.id) !== tx.id)) continue
      if (picked.some(inv => !sameCustomer(inv, picked[0]!))) continue
      const sum = round2(picked.reduce((s, inv) => s + inv.pending, 0))
      const diff = Math.abs(sum - tx.amount)
      const exact = diff <= 0.01
      const short = picked.length === 1 && tx.amount < sum && sum - tx.amount <= Math.max(15, sum * 0.03)
      if (diff > MATCH_TOLERANCE && !short) continue
      const first = picked[0]!
      const suffix = exact ? '' : diff <= MATCH_TOLERANCE ? ' (±1 €)' : ` (faltan ${eurText(round2(sum - tx.amount))})`
      out.set(tx.id, {
        kind: 'invoice', id: first.id, ...(picked.length > 1 ? { ids } : {}),
        label: `${picked.length > 1 ? 'Facturas' : 'Factura'} ${picked.map(inv => inv.number).join(' + ')}${suffix}`,
        detail: item.note || first.customer?.name || null,
        // Nunca se acepta sola en bloque: la IA propone y el usuario confirma
        confidence: Math.min(80, item.confidence) - (exact ? 0 : 4), source: 'ai', contactId: first.contactId,
      })
      for (const inv of picked) held.set(`invoice:${inv.id}`, tx.id)
    }
  }
  return out
}

/** Propuestas que se pueden aceptar en bloque sin revisarlas una a una */
export function isSafeSuggestion(s: BankSuggestion | null | undefined) {
  if (!s) return false
  if (s.kind === 'invoice' || s.kind === 'expense' || s.kind === 'payment') return s.source === 'match' && s.confidence >= 85
  return s.source === 'rule' && s.confidence >= 90
}

type StoredTx = Pick<BankTx, 'id' | 'hash' | 'date' | 'valueDate' | 'amount' | 'description' | 'counterparty' | 'reference' | 'balance'>

/** ¿Es el mismo movimiento? Mismo día (de operación o de valor) e importe y, además, el mismo saldo o un concepto compatible */
function sameMovement(row: BankRow, tx: StoredTx) {
  if (Math.round(row.amount * 100) !== Math.round(tx.amount * 100)) return false
  const rowDays = [row.date, row.valueDate].filter(Boolean)
  if (![tx.date, tx.valueDate].some(d => d && rowDays.includes(d))) return false
  // El saldo tras el movimiento lo identifica sin dudas
  if (row.balance != null && tx.balance != null) return Math.round(row.balance * 100) === Math.round(tx.balance * 100)
  if (row.reference && tx.reference && plain(row.reference) === plain(tx.reference)) return true
  const a = [row.description, row.counterparty].filter((x): x is string => !!x)
  const b = [tx.description, tx.counterparty].filter((x): x is string => !!x)
  if (a.some(x => b.some(y => plain(x) === plain(y) || similarNames(x, y)))) return true
  // Un concepto genérico («Recibo», «Transferencia») no contradice al otro
  return !a.some(x => significantWords(x).length) || !b.some(y => significantWords(y).length)
}

/**
 * Movimientos del extracto que ya estaban en la cuenta, aunque llegaran en otro formato (Norma 43 y luego
 * Excel) o con el concepto escrito de otra forma. Cada movimiento guardado empareja con uno solo del
 * extracto: dos cafés iguales el mismo día siguen siendo dos.
 */
export async function knownMovements(companyId: number, accountId: number, rows: BankRow[], hashes: string[]) {
  const dates = rows.flatMap(r => [r.date, r.valueDate]).filter((d): d is string => !!d).sort()
  if (!dates.length) return rows.map(() => false)
  const t = tables.bankTransactions
  const stored: StoredTx[] = await useDb().select({ id: t.id, hash: t.hash, date: t.date, valueDate: t.valueDate, amount: t.amount, description: t.description, counterparty: t.counterparty, reference: t.reference, balance: t.balance })
    .from(t).where(and(eq(t.companyId, companyId), eq(t.accountId, accountId), gte(t.date, shiftDay(dates[0]!, -3)), lte(t.date, shiftDay(dates.at(-1)!, 3))))
  // Primero las huellas exactas (el mismo extracto otra vez); después, por datos, lo que quede
  const byHash = new Map(stored.map(s => [s.hash, s]))
  const used = new Set<number>()
  const known = rows.map((_, i) => {
    const same = byHash.get(hashes[i]!)
    if (same) used.add(same.id)
    return !!same
  })
  rows.forEach((row, i) => {
    if (known[i]) return
    const same = stored.find(s => !used.has(s.id) && sameMovement(row, s))
    if (same) {
      used.add(same.id)
      known[i] = true
    }
  })
  return known
}

/** Cuántos movimientos del extracto (mismo día e importe) tiene ya cada cuenta: dice de qué cuenta es un extracto sin IBAN */
export async function overlapByAccount(companyId: number, rows: BankRow[]) {
  const dates = rows.map(r => r.date).sort()
  const out = new Map<number, number>()
  if (!dates.length) return out
  const t = tables.bankTransactions
  const stored = await useDb().select({ accountId: t.accountId, date: t.date, valueDate: t.valueDate, amount: t.amount }).from(t)
    .where(and(eq(t.companyId, companyId), gte(t.date, shiftDay(dates[0]!, -3)), lte(t.date, shiftDay(dates.at(-1)!, 3))))
  const keys = new Map<number, Set<string>>()
  for (const s of stored) {
    const set = keys.get(s.accountId) ?? new Set<string>()
    for (const d of [s.date, s.valueDate]) if (d) set.add(`${d}|${Math.round(s.amount * 100)}`)
    keys.set(s.accountId, set)
  }
  for (const [accountId, set] of keys) {
    out.set(accountId, rows.filter(r => [r.date, r.valueDate].some(d => d && set.has(`${d}|${Math.round(r.amount * 100)}`))).length)
  }
  return out
}

/** Huellas de los movimientos: iguales en el mismo día se distinguen por su orden */
export function txHashes(accountId: number, rows: BankRow[]) {
  const seen = new Map<string, number>()
  return rows.map((r) => {
    const key = `${accountId}|${r.date}|${r.amount.toFixed(2)}|${plain(r.description)}`
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    return createHash('sha256').update(`${key}|${n}`).digest('hex')
  })
}

type PayMethod = 'transfer' | 'card' | 'direct_debit' | 'bizum'

function methodFor(tx: BankTx): PayMethod {
  if (tx.bankCode === '12' || /tarjeta|\bcompra\b|pago con/i.test(tx.description)) return 'card'
  if (tx.bankCode === '03' || /recibo|adeudo|domicili/i.test(tx.description)) return 'direct_debit'
  return /bizum/i.test(tx.description) ? 'bizum' : 'transfer'
}

async function loadTx(companyId: number, id: number) {
  const [tx] = await useDb().select().from(tables.bankTransactions)
    .where(and(eq(tables.bankTransactions.id, id), eq(tables.bankTransactions.companyId, companyId)))
  if (!tx) throw createError({ statusCode: 404, statusMessage: 'Movimiento no encontrado' })
  return tx
}

/**
 * Concilia un movimiento con una factura, un gasto o un cobro/pago ya anotado. La ficha del cliente o
 * proveedor aprende el IBAN o el NIF que traía el movimiento, para reconocerle la próxima vez.
 */
export async function confirmMatch(company: Company, userId: number, txId: number, target: MatchTarget) {
  await linkTx(company, userId, txId, target)
  await learnContactFromTx(company, await loadTx(company.id, txId)).catch(err => console.warn('[banco] aprender contacto', (err as Error).message))
}

/** Con qué se concilia un movimiento; un abono puede cobrar varias facturas a la vez (`ids`) */
export type MatchTarget = { kind: 'invoice' | 'expense' | 'payment', id: number, ids?: number[] | null }

/** La propuesta de un movimiento como destino de la conciliación */
export const suggestionTarget = (s: BankSuggestion): MatchTarget => ({ kind: s.kind as MatchTarget['kind'], id: s.id!, ...(s.ids?.length ? { ids: s.ids } : {}) })

async function linkTx(company: Company, userId: number, txId: number, target: MatchTarget): Promise<void> {
  const db = useDb()
  let tx = await loadTx(company.id, txId)
  if (tx.status === 'matched') {
    // Si ya estaba conciliado con otro documento, deshacer la asignación previa para reasignar al nuevo
    await unmatch(company, txId, { suggest: false })
    tx = await loadTx(company.id, txId)
  }
  const group = target.kind === 'invoice' ? [...new Set([target.id, ...(target.ids ?? [])])] : []
  if (group.length > 1) return linkInvoices(company, userId, tx, group)
  const amount = Math.abs(tx.amount)
  const t = tables.bankTransactions
  const [dupe] = await db.select({ id: t.id }).from(t).where(and(
    eq(t.companyId, company.id), eq(t.status, 'matched'), ne(t.id, tx.id),
    target.kind === 'payment' ? eq(t.paymentId, target.id) : target.kind === 'expense' ? eq(t.expenseId, target.id) : eq(t.salesDocumentId, target.id),
    ...(target.kind === 'invoice' ? [eq(t.amount, tx.amount)] : []),
  ))
  if (dupe && target.kind !== 'invoice') throw createError({ statusCode: 409, statusMessage: 'Ya está conciliado con otro movimiento' })
  const done: { status: 'matched', matchedAt: Date, matchedBy: number, ignoreReason: null } = { status: 'matched', matchedAt: new Date(), matchedBy: userId, ignoreReason: null }

  if (target.kind === 'payment') {
    const [p] = await db.select().from(tables.payments).where(and(eq(tables.payments.id, target.id), eq(tables.payments.companyId, company.id)))
    if (!p) throw createError({ statusCode: 404, statusMessage: 'Cobro o pago no encontrado' })
    const diff = Math.abs(round2(p.amount - amount))
    if (diff > MATCH_TOLERANCE) {
      throw createError({ statusCode: 400, statusMessage: `El importe no coincide con el del movimiento (${eurText(amount)} vs ${eurText(p.amount)}, diferencia de ${eurText(diff)})` })
    }
    const updatePayload: { bankAccountId: number, notes?: string } = { bankAccountId: tx.accountId }
    if (diff > 0.01) {
      const noteDiff = `Conciliado con mov. bancario de ${eurText(amount)}`
      updatePayload.notes = p.notes ? `${p.notes} (${noteDiff})` : noteDiff
    }
    await db.update(tables.payments).set(updatePayload).where(eq(tables.payments.id, p.id))
    await db.update(t).set({ ...done, paymentId: p.id, salesDocumentId: p.salesDocumentId, expenseId: p.expenseId, ownsPayment: false }).where(eq(t.id, tx.id))
    return
  }

  if (target.kind === 'invoice') {
    if (tx.amount <= 0) throw createError({ statusCode: 400, statusMessage: 'Un cargo no puede cobrar una factura' })
    const [doc] = await db.select().from(tables.salesDocuments).where(and(eq(tables.salesDocuments.id, target.id), eq(tables.salesDocuments.companyId, company.id)))
    if (!doc) throw createError({ statusCode: 404, statusMessage: 'Factura no encontrada' })
    if (!isOpenStatus(doc.status)) {
      // Ya cobrada a mano: se enlaza su cobro con este ingreso en vez de anotar otro
      const used = (await db.select({ id: t.paymentId }).from(t).where(and(eq(t.companyId, company.id), eq(t.status, 'matched'), isNotNull(t.paymentId)))).map(r => r.id)
      const paid = await db.select({ id: tables.payments.id, amount: tables.payments.amount, date: tables.payments.date }).from(tables.payments)
        .where(and(eq(tables.payments.companyId, company.id), eq(tables.payments.salesDocumentId, doc.id), eq(tables.payments.direction, 'in')))
      const same = paid.filter(p => !used.includes(p.id) && Math.abs(p.amount - amount) <= MATCH_TOLERANCE)
        .sort((a, b) => Math.abs(daysBetween(a.date, tx.date)) - Math.abs(daysBetween(b.date, tx.date)))[0]
      if (same) return linkTx(company, userId, tx.id, { kind: 'payment', id: same.id })
      throw createError({ statusCode: 409, statusMessage: 'Esta factura no tiene cobros pendientes' })
    }
    const pending = round2(doc.total - doc.paidTotal)
    if (amount > pending + MATCH_TOLERANCE) throw createError({ statusCode: 400, statusMessage: `El movimiento supera lo pendiente de la factura (${eurText(pending)})` })
    const [res] = await db.insert(tables.payments).values({
      companyId: company.id, direction: 'in', salesDocumentId: doc.id, amount, date: tx.date, method: methodFor(tx), bankAccountId: tx.accountId, notes: 'Conciliado con el banco',
    }).$returningId()
    await refreshPaidStatus(doc.id)
    await db.update(t).set({ ...done, paymentId: res!.id, salesDocumentId: doc.id, expenseId: null, ownsPayment: true }).where(eq(t.id, tx.id))
    return
  }

  if (tx.amount >= 0) throw createError({ statusCode: 400, statusMessage: 'Un abono no puede pagar un gasto' })
  const [e] = await db.select().from(tables.expenses).where(and(eq(tables.expenses.id, target.id), eq(tables.expenses.companyId, company.id)))
  if (!e) throw createError({ statusCode: 404, statusMessage: 'Gasto no encontrado' })
  if (e.status === 'paid') {
    // Ya marcado como pagado a mano: solo se enlaza y vincula cuenta bancaria si tenía cobro/pago
    const [prevP] = await db.select({ id: tables.payments.id }).from(tables.payments)
      .where(and(eq(tables.payments.companyId, company.id), eq(tables.payments.expenseId, e.id), eq(tables.payments.direction, 'out'))).limit(1)
    if (prevP) {
      await db.update(tables.payments).set({ bankAccountId: tx.accountId }).where(eq(tables.payments.id, prevP.id))
    }
    await db.update(t).set({ ...done, expenseId: e.id, salesDocumentId: null, paymentId: prevP?.id ?? null, ownsPayment: false }).where(eq(t.id, tx.id))
    return
  }
  const pendingExpense = round2(e.total - e.paidTotal)
  const paidTotal = round2(e.paidTotal + amount)
  if (paidTotal > e.total + MATCH_TOLERANCE) throw createError({ statusCode: 400, statusMessage: `El movimiento supera lo pendiente del gasto (${eurText(pendingExpense)})` })
  const method = methodFor(tx)
  const [res] = await db.insert(tables.payments).values({
    companyId: company.id, direction: 'out', expenseId: e.id, amount, date: tx.date, method, bankAccountId: tx.accountId, notes: 'Conciliado con el banco',
  }).$returningId()
  const expDiff = round2(e.total - paidTotal)
  const full = expDiff <= 0.005 || (expDiff <= MATCH_TOLERANCE && paidTotal >= e.total * 0.95)
  await db.update(tables.expenses).set({ paidTotal, status: full ? 'paid' : 'partial', paidAt: full ? new Date(`${tx.date}T12:00:00`) : null, paymentMethod: e.paymentMethod ?? method })
    .where(eq(tables.expenses.id, e.id))
  await db.update(t).set({ ...done, paymentId: res!.id, expenseId: e.id, salesDocumentId: null, ownsPayment: true }).where(eq(t.id, tx.id))
}

/**
 * Un abono que paga varias facturas del mismo cliente: cada una recibe su cobro por lo que tenía pendiente
 * (la última, lo que quede, para que la suma sea el importe del banco) y todas pasan a cobradas.
 */
async function linkInvoices(company: Company, userId: number, tx: BankTx, ids: number[]) {
  const db = useDb()
  const s = tables.salesDocuments
  if (tx.amount <= 0) throw createError({ statusCode: 400, statusMessage: 'Un cargo no puede cobrar facturas' })
  const rows = await db.select().from(s).where(and(eq(s.companyId, company.id), inArray(s.id, ids)))
  const docs = ids.map(id => rows.find(r => r.id === id)).filter((d): d is NonNullable<typeof d> => !!d)
  if (docs.length !== ids.length) throw createError({ statusCode: 404, statusMessage: 'Alguna de las facturas ya no existe' })
  const closed = docs.find(d => !isOpenStatus(d.status) || round2(d.total - d.paidTotal) <= 0)
  if (closed) throw createError({ statusCode: 409, statusMessage: `La factura ${closed.number} no tiene cobros pendientes` })
  const owner = (d: typeof docs[number]) => d.contactId ? `c${d.contactId}` : `n${plain(d.customer?.name ?? '')}`
  if (new Set(docs.map(owner)).size > 1) throw createError({ statusCode: 400, statusMessage: 'Un pago solo puede cobrar facturas del mismo cliente' })
  const amount = round2(tx.amount)
  const pending = docs.map(d => round2(d.total - d.paidTotal))
  const sum = round2(pending.reduce((a, b) => a + b, 0))
  if (Math.abs(sum - amount) > MATCH_TOLERANCE) {
    throw createError({ statusCode: 400, statusMessage: `Lo pendiente de las facturas (${eurText(sum)}) no coincide con el movimiento (${eurText(amount)})` })
  }
  const method = methodFor(tx)
  const paymentIds: number[] = []
  let left = amount
  for (const [i, d] of docs.entries()) {
    const value = i === docs.length - 1 ? round2(left) : pending[i]!
    left = round2(left - value)
    const [res] = await db.insert(tables.payments).values({
      companyId: company.id, direction: 'in', salesDocumentId: d.id, amount: value, date: tx.date, method, bankAccountId: tx.accountId,
      notes: `Conciliado con el banco (un pago de ${docs.length} facturas)`,
    }).$returningId()
    paymentIds.push(res!.id)
    await refreshPaidStatus(d.id)
  }
  await db.update(tables.bankTransactions).set({
    status: 'matched', matchedAt: new Date(), matchedBy: userId, ignoreReason: null,
    paymentId: paymentIds[0]!, salesDocumentId: docs[0]!.id, expenseId: null, ownsPayment: true, groupPaymentIds: paymentIds.slice(1),
  }).where(eq(tables.bankTransactions.id, tx.id))
}

type DbLike = Pick<ReturnType<typeof useDb>, 'select' | 'update' | 'delete'>

/**
 * Movimientos que cobran varias facturas a la vez y pierden uno de sus cobros (se borra la factura o el
 * cobro): vuelven a estar por revisar y se quitan los cobros que creó la conciliación en las demás facturas.
 */
export async function releaseBankGroups(db: DbLike, companyId: number, paymentIds: number[]) {
  if (!paymentIds.length) return [] as number[]
  const t = tables.bankTransactions
  const gone = new Set(paymentIds)
  const rows = await db.select({ id: t.id, paymentId: t.paymentId, groupPaymentIds: t.groupPaymentIds, ownsPayment: t.ownsPayment }).from(t)
    .where(and(eq(t.companyId, companyId), eq(t.status, 'matched'), isNotNull(t.groupPaymentIds)))
  const hit = rows.filter(r => r.groupPaymentIds?.length && [r.paymentId, ...r.groupPaymentIds].some(id => id != null && gone.has(id)))
  for (const r of hit) {
    const others = [r.paymentId, ...(r.groupPaymentIds ?? [])].filter((id): id is number => id != null && !gone.has(id))
    if (r.ownsPayment && others.length) {
      const docs = (await db.select({ doc: tables.payments.salesDocumentId }).from(tables.payments).where(and(eq(tables.payments.companyId, companyId), inArray(tables.payments.id, others)))).map(p => p.doc)
      await db.delete(tables.payments).where(and(eq(tables.payments.companyId, companyId), inArray(tables.payments.id, others)))
      for (const doc of new Set(docs)) if (doc) await refreshPaidStatus(doc, db)
    }
    await db.update(t).set({ status: 'pending', paymentId: null, salesDocumentId: null, expenseId: null, groupPaymentIds: null, ownsPayment: false, matchedAt: null, matchedBy: null, ignoreReason: null, suggestion: null })
      .where(eq(t.id, r.id))
  }
  return hit.map(r => r.id)
}

/**
 * Gasto ya anotado que corresponde a un cargo: el mismo importe, fecha cercana (la factura hasta 60 días
 * antes del cargo o poco después) y algo en común: proveedor, concepto, número de factura o tipo (cuota de
 * autónomos, nómina, impuestos). Los gastos ya unidos a otro movimiento no cuentan: son otro pago.
 */
async function recordedExpenseFor(company: Company, tx: BankTx, input: { kind?: string | null, supplier: string | null, description: string | null, contactId?: number | null }) {
  const db = useDb()
  const e = tables.expenses
  const t = tables.bankTransactions
  const amount = Math.abs(tx.amount)
  const rows = await db.select({ id: e.id, kind: e.kind, number: e.number, supplier: e.supplier, supplierId: e.supplierId, description: e.description, issueDate: e.issueDate, total: e.total, paidTotal: e.paidTotal, status: e.status })
    .from(e).where(and(
      eq(e.companyId, company.id), ne(e.approval, 'rejected'),
      gte(e.issueDate, shiftDay(tx.date, -60)), lte(e.issueDate, shiftDay(tx.date, 10)),
      gte(e.total, round2(amount - 0.01)), lte(e.total, round2(amount + 0.01)),
    ))
  if (!rows.length) return null
  const linked = new Set((await db.select({ id: t.expenseId }).from(t)
    .where(and(eq(t.companyId, company.id), eq(t.status, 'matched'), ne(t.id, tx.id), inArray(t.expenseId, rows.map(r => r.id))))).map(r => r.id))
  const text = `${tx.description} ${tx.counterparty ?? ''} ${tx.reference ?? ''}`
  const typed = !!input.kind && ['social_security', 'payroll', 'tax'].includes(input.kind)
  const found = rows.filter(r => !linked.has(r.id) && (r.status !== 'partial' || Math.abs(round2(r.total - r.paidTotal) - amount) <= 0.01)).filter(r =>
    (!!input.contactId && r.supplierId === input.contactId) || nameScore(r.supplier?.name, text) >= 0.5 || nameScore(r.description, text) >= 0.5 || numberInText(r.number, text)
    || similarNames(input.supplier, r.supplier?.name) || similarNames(input.supplier, r.description) || similarNames(input.description, r.description)
    || (typed && r.kind === input.kind))
  // El más cercano en fecha
  return found.sort((a, b) => Math.abs(daysBetween(a.issueDate, tx.date)) - Math.abs(daysBetween(b.issueDate, tx.date)))[0]?.id ?? null
}

/**
 * Crea el gasto de un cargo (comisión, cuota de autónomos, suministro…) ya pagado y lo concilia.
 * Si ese gasto ya estaba anotado (escaneado, importado o a mano), lo concilia con él en vez de duplicarlo.
 */
export async function expenseFromTx(company: Company, userId: number, txId: number, input: {
  kind: BankSuggestion['expenseKind']
  categoryId: number | null
  supplier: string | null
  vatRate: number
  description: string | null
  /** Sin indicar: la que se marcó la última vez con ese proveedor o la de la categoría */
  deductiblePct?: number | null
  vatDeductiblePct?: number | null
  /** Proveedor ya guardado (reconocido en el movimiento): se usa su ficha en vez de buscarla por el nombre */
  contactId?: number | null
}) {
  const db = useDb()
  const tx = await loadTx(company.id, txId)
  if (tx.status === 'matched') throw createError({ statusCode: 409, statusMessage: 'Este movimiento ya está conciliado' })
  if (tx.amount >= 0) throw createError({ statusCode: 400, statusMessage: 'Solo los cargos pueden ser gastos' })
  const recorded = await recordedExpenseFor(company, tx, input)
  if (recorded) {
    await confirmMatch(company, userId, tx.id, { kind: 'expense', id: recorded })
    return { expenseId: recorded, linked: true }
  }
  const [known] = input.contactId
    ? await db.select({ id: tables.contacts.id, isSupplier: tables.contacts.isSupplier }).from(tables.contacts).where(and(eq(tables.contacts.id, input.contactId), eq(tables.contacts.companyId, company.id)))
    : []
  if (known && !known.isSupplier) await db.update(tables.contacts).set({ isSupplier: true }).where(eq(tables.contacts.id, known.id))
  const guess = input.deductiblePct == null ? (await deductibleGuesser(company.id))({ supplierId: known?.id, supplierName: input.supplier, categoryId: input.categoryId }) : null
  const deductiblePct = guess?.deductiblePct ?? input.deductiblePct ?? 100
  // Sin IVA el % de IVA no importa: se guarda igual que el del gasto para que se lea «no deducible» o «50 %»
  const vatDeductiblePct = input.vatRate ? guess?.vatDeductiblePct ?? input.vatDeductiblePct ?? deductiblePct : deductiblePct
  const total = Math.abs(tx.amount)
  const base = round2(total / (1 + input.vatRate / 100))
  const method = methodFor(tx)
  const expenseId = await saveExpense(company.id, userId, {
    kind: input.kind ?? 'ticket',
    issueDate: tx.date,
    categoryId: input.categoryId,
    description: (input.description || tx.description).slice(0, 255),
    taxLines: [{ base, vatRate: input.vatRate, vatAmount: round2(total - base), surchargeRate: 0 }],
    irpfRate: 0,
    deductiblePct,
    vatDeductiblePct,
    reverseCharge: false,
    isInvestment: false,
    paymentMethod: method,
    paid: true,
    notes: `Creado desde el banco: ${tx.description}`.slice(0, 5000),
    supplierId: known?.id ?? null,
    newSupplier: !known && input.supplier ? { name: input.supplier.slice(0, 200), nif: null, address: null, postalCode: null, city: null, province: null, country: 'ES', email: null, phone: null, isPerson: false } : null,
  }, undefined, { checkDuplicates: false })
  const [res] = await db.insert(tables.payments).values({
    companyId: company.id, direction: 'out', expenseId, amount: total, date: tx.date, method, bankAccountId: tx.accountId, notes: 'Conciliado con el banco',
  }).$returningId()
  await db.update(tables.bankTransactions).set({
    status: 'matched', matchedAt: new Date(), matchedBy: userId, expenseId, paymentId: res!.id, salesDocumentId: null, ownsPayment: true, ignoreReason: null,
  }).where(eq(tables.bankTransactions.id, tx.id))
  return { expenseId, linked: false }
}

/**
 * Deshace la conciliación: borra el cobro/pago que creó (no los documentos).
 * En lote se pasa `suggest: false` y las propuestas se recalculan una vez para todos.
 */
export async function unmatch(company: Company, txId: number, opts: { suggest?: boolean } = {}) {
  const db = useDb()
  const tx = await loadTx(company.id, txId)
  // Un pago de varias facturas: los cobros de las demás
  if (tx.status === 'matched' && tx.ownsPayment && tx.groupPaymentIds?.length) {
    const rows = await db.select({ id: tables.payments.id, doc: tables.payments.salesDocumentId }).from(tables.payments)
      .where(and(eq(tables.payments.companyId, company.id), inArray(tables.payments.id, tx.groupPaymentIds)))
    if (rows.length) await db.delete(tables.payments).where(inArray(tables.payments.id, rows.map(r => r.id)))
    for (const doc of new Set(rows.map(r => r.doc))) if (doc) await refreshPaidStatus(doc)
  }
  if (tx.status === 'matched' && tx.ownsPayment && tx.paymentId) {
    const [p] = await db.select().from(tables.payments).where(eq(tables.payments.id, tx.paymentId))
    if (p) {
      await db.delete(tables.payments).where(eq(tables.payments.id, p.id))
      if (p.salesDocumentId) await refreshPaidStatus(p.salesDocumentId)
      if (p.expenseId) {
        const [e] = await db.select().from(tables.expenses).where(eq(tables.expenses.id, p.expenseId))
        // Gasto creado desde este cargo y sin documento adjunto: se quita con la conciliación
        if (e && e.notes?.startsWith('Creado desde el banco') && !e.fileId) {
          await db.delete(tables.expenseTaxLines).where(eq(tables.expenseTaxLines.expenseId, e.id))
          await db.delete(tables.expenses).where(eq(tables.expenses.id, e.id))
        }
        else if (e) {
          const paidTotal = Math.max(0, round2(e.paidTotal - p.amount))
          const expDiff = round2(e.total - paidTotal)
          const full = expDiff <= 0.005 || (expDiff <= MATCH_TOLERANCE && paidTotal >= e.total * 0.95)
          await db.update(tables.expenses).set({ paidTotal, status: full ? 'paid' : paidTotal <= 0.005 ? 'pending' : 'partial', paidAt: full ? e.paidAt : null }).where(eq(tables.expenses.id, e.id))
        }
      }
    }
  }
  await db.update(tables.bankTransactions).set({
    status: 'pending', paymentId: null, salesDocumentId: null, expenseId: null, groupPaymentIds: null, ownsPayment: false, ignoreReason: null, matchedAt: null, matchedBy: null,
  }).where(eq(tables.bankTransactions.id, tx.id))
  if (opts.suggest !== false) await suggestMatches(company, [tx.id])
}

/** Documentos que podrían corresponder a un movimiento (búsqueda manual) */
export async function matchCandidates(company: Company, txId: number, q: string) {
  const db = useDb()
  const tx = await loadTx(company.id, txId)
  const amount = Math.abs(tx.amount)
  const query = plain(q)
  const hit = (...texts: Array<string | null | undefined>) => !query || texts.some(x => x && plain(x).includes(query))
  const items: Array<{ kind: 'invoice' | 'expense' | 'payment', id: number, title: string, subtitle: string, amount: number, date: string, exact: boolean }> = []
  if (tx.amount > 0) {
    const docs = await db.select().from(tables.salesDocuments).where(and(
      eq(tables.salesDocuments.companyId, company.id), inArray(tables.salesDocuments.kind, ['invoice', 'rectifying']), inArray(tables.salesDocuments.status, ['issued', 'sent', 'partial']),
    )).orderBy(desc(tables.salesDocuments.issueDate)).limit(300)
    for (const d of docs) {
      const pending = round2(d.total - d.paidTotal)
      if (!hit(d.number, d.customer?.name) || pending <= 0) continue
      const diff = Math.abs(pending - amount)
      items.push({ kind: 'invoice', id: d.id, title: `Factura ${d.number}`, subtitle: d.customer?.name ?? '', amount: pending, date: d.issueDate, exact: diff <= MATCH_TOLERANCE })
    }

    // Cobros ya anotados no enlazados a otro movimiento de banco
    const usedPayments = new Set((await db.select({ paymentId: tables.bankTransactions.paymentId }).from(tables.bankTransactions)
      .where(and(eq(tables.bankTransactions.companyId, company.id), eq(tables.bankTransactions.status, 'matched'), isNotNull(tables.bankTransactions.paymentId))))
      .map(p => p.paymentId).filter((x): x is number => x !== tx.paymentId))

    const payments = await db.select().from(tables.payments)
      .where(and(eq(tables.payments.companyId, company.id), eq(tables.payments.direction, 'in'), isNotNull(tables.payments.salesDocumentId)))
      .orderBy(desc(tables.payments.date)).limit(100)

    for (const p of payments) {
      if (usedPayments.has(p.id)) continue
      const [doc] = await db.select({ number: tables.salesDocuments.number, customer: tables.salesDocuments.customer })
        .from(tables.salesDocuments).where(eq(tables.salesDocuments.id, p.salesDocumentId!))
      if (!doc || !hit(doc.number, doc.customer?.name, p.notes)) continue
      const diff = Math.abs(p.amount - amount)
      items.push({ kind: 'payment', id: p.id, title: `Cobro ya anotado · Factura ${doc.number}`, subtitle: doc.customer?.name ?? (p.notes || ''), amount: p.amount, date: p.date, exact: diff <= MATCH_TOLERANCE })
    }
  }
  else {
    const linked = await db.select({ expenseId: tables.bankTransactions.expenseId }).from(tables.bankTransactions)
      .where(and(eq(tables.bankTransactions.companyId, company.id), eq(tables.bankTransactions.status, 'matched'), isNotNull(tables.bankTransactions.expenseId)))
    const used = new Set(linked.map(l => l.expenseId))
    const rows = await db.select().from(tables.expenses).where(eq(tables.expenses.companyId, company.id)).orderBy(desc(tables.expenses.issueDate)).limit(400)
    for (const e of rows) {
      if (used.has(e.id) || !hit(e.number, e.supplier?.name, e.description)) continue
      const target = e.status === 'paid' ? e.total : round2(e.total - e.paidTotal)
      const diff = Math.abs(target - amount)
      items.push({ kind: 'expense', id: e.id, title: e.supplier?.name ?? e.description ?? 'Gasto', subtitle: [e.number ? `Factura ${e.number}` : null, e.status === 'paid' ? 'pagado' : 'pendiente'].filter(Boolean).join(' · '), amount: target, date: e.issueDate, exact: diff <= MATCH_TOLERANCE })
    }

    // Pagos de gastos ya anotados no enlazados a otro movimiento de banco
    const usedPayments = new Set((await db.select({ paymentId: tables.bankTransactions.paymentId }).from(tables.bankTransactions)
      .where(and(eq(tables.bankTransactions.companyId, company.id), eq(tables.bankTransactions.status, 'matched'), isNotNull(tables.bankTransactions.paymentId))))
      .map(p => p.paymentId).filter((x): x is number => x !== tx.paymentId))

    const payments = await db.select().from(tables.payments)
      .where(and(eq(tables.payments.companyId, company.id), eq(tables.payments.direction, 'out'), isNotNull(tables.payments.expenseId)))
      .orderBy(desc(tables.payments.date)).limit(100)

    for (const p of payments) {
      if (usedPayments.has(p.id)) continue
      const [e] = await db.select({ number: tables.expenses.number, supplier: tables.expenses.supplier, description: tables.expenses.description })
        .from(tables.expenses).where(eq(tables.expenses.id, p.expenseId!))
      if (!e || !hit(e.number, e.supplier?.name, e.description, p.notes)) continue
      const diff = Math.abs(p.amount - amount)
      items.push({ kind: 'payment', id: p.id, title: `Pago ya anotado · ${e.supplier?.name ?? e.description ?? 'Gasto'}`, subtitle: [e.number ? `Factura ${e.number}` : null, p.notes].filter(Boolean).join(' · '), amount: p.amount, date: p.date, exact: diff <= MATCH_TOLERANCE })
    }
  }
  return items
    .sort((a, b) => Number(b.exact) - Number(a.exact) || Math.abs(daysBetween(a.date, tx.date)) - Math.abs(daysBetween(b.date, tx.date)))
    .slice(0, 40)
}
