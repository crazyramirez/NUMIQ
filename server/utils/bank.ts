import { createHash } from 'node:crypto'
import { and, desc, eq, gte, inArray, isNotNull, ne } from 'drizzle-orm'
import type { BankSuggestion } from '../db/schema'

type Company = typeof tables.companies.$inferSelect
type BankTx = typeof tables.bankTransactions.$inferSelect

const DAY = 86_400_000
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY)
/** Texto comparable: sin tildes, mayúsculas ni signos */
const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const compact = (s: string) => plain(s).replace(/\s/g, '')
const LEGAL = new Set(['sl', 'slu', 'sa', 'slp', 'sll', 'scp', 'cb', 'sociedad', 'limitada', 'anonima', 'del', 'las', 'los', 'and', 'the', 'grupo'])

/** Tolerancia para discrepancias de redondeo o ajustes bancarios al conciliar (en euros) */
export const MATCH_TOLERANCE = 1.00

/** ¿Aparece el nombre (alguna palabra significativa) en el concepto del banco? */
function nameScore(name: string | null | undefined, text: string) {
  if (!name) return 0
  const words = plain(name).split(' ').filter(w => w.length > 2 && !LEGAL.has(w))
  if (!words.length) return 0
  const t = ` ${plain(text)} `
  const hits = words.filter(w => t.includes(` ${w} `) || (w.length >= 5 && t.includes(w))).length
  return hits / words.length
}

/** ¿Aparece el número del documento (F2026-0046, 2026/46…) en el concepto? */
function numberInText(number: string | null | undefined, text: string) {
  if (!number || number.length < 3) return false
  const n = compact(number)
  const t = compact(text)
  if (t.includes(n)) return true
  // "F2026-0046" escrito como "fra 46/2026" o "factura 46": número final sin ceros
  const tail = number.match(/(\d+)\D*$/)?.[1]?.replace(/^0+/, '')
  const year = number.match(/(20\d{2})/)?.[1]
  // plain() deja los números separados por espacios: "fra 42/2026" → "fra 42 2026"
  return !!tail && tail.length >= 2 && !!year && new RegExp(`\\b0*${tail} ${year}\\b|\\b${year} 0*${tail}\\b`).test(plain(text))
}

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
 * 2. Facturas emitidas con cobro pendiente y gastos sin pagar por el importe exacto.
 * 3. Gastos ya pagados sin movimiento (la mayoría se marcan pagados a mano).
 * 4. Reglas (cuota de autónomos, comisiones, impuestos, traspasos) y, si hay IA, categoría para el resto.
 */
export async function suggestMatches(company: Company, ids?: number[]) {
  const db = useDb()
  const t = tables.bankTransactions
  const txs = await db.select().from(t).where(and(eq(t.companyId, company.id), eq(t.status, 'pending'), ...(ids?.length ? [inArray(t.id, ids)] : [])))
  if (!txs.length) return 0
  const since = toISODate(new Date(Date.now() - 600 * DAY))

  const [linked, invoices, expenses, payments, categories, accounts] = await Promise.all([
    db.select({ paymentId: t.paymentId, expenseId: t.expenseId, salesDocumentId: t.salesDocumentId }).from(t)
      .where(and(eq(t.companyId, company.id), eq(t.status, 'matched'))),
    db.select({
      id: tables.salesDocuments.id, number: tables.salesDocuments.number, customer: tables.salesDocuments.customer, issueDate: tables.salesDocuments.issueDate,
      dueDate: tables.salesDocuments.dueDate, total: tables.salesDocuments.total, paidTotal: tables.salesDocuments.paidTotal, kind: tables.salesDocuments.kind,
    }).from(tables.salesDocuments).where(and(
      eq(tables.salesDocuments.companyId, company.id), inArray(tables.salesDocuments.kind, ['invoice', 'rectifying']),
      inArray(tables.salesDocuments.status, ['issued', 'sent', 'partial']),
    )),
    db.select({
      id: tables.expenses.id, number: tables.expenses.number, supplier: tables.expenses.supplier, description: tables.expenses.description,
      issueDate: tables.expenses.issueDate, dueDate: tables.expenses.dueDate, total: tables.expenses.total, paidTotal: tables.expenses.paidTotal, status: tables.expenses.status,
    }).from(tables.expenses).where(and(eq(tables.expenses.companyId, company.id), gte(tables.expenses.issueDate, since))),
    db.select({
      id: tables.payments.id, direction: tables.payments.direction, amount: tables.payments.amount, date: tables.payments.date,
      salesDocumentId: tables.payments.salesDocumentId, expenseId: tables.payments.expenseId,
    }).from(tables.payments).where(and(eq(tables.payments.companyId, company.id), gte(tables.payments.date, since))),
    db.select({ id: tables.categories.id, name: tables.categories.name, accountCode: tables.categories.accountCode }).from(tables.categories)
      .where(and(eq(tables.categories.companyId, company.id), eq(tables.categories.kind, 'expense'))),
    db.select({ id: tables.bankAccounts.id, bankName: tables.bankAccounts.bankName }).from(tables.bankAccounts).where(eq(tables.bankAccounts.companyId, company.id)),
  ])
  const usedPayments = new Set(linked.map(l => l.paymentId).filter(Boolean))
  const usedExpenses = new Set(linked.map(l => l.expenseId).filter(Boolean))
  const docNames = new Map<number, { number: string | null, name: string | null }>()
  for (const inv of invoices) docNames.set(inv.id, { number: inv.number, name: inv.customer?.name ?? null })
  // Documentos de los cobros ya registrados (facturas cobradas): número y cliente para el texto
  const paidDocIds = [...new Set(payments.map(p => p.salesDocumentId).filter((x): x is number => !!x && !docNames.has(x)))]
  if (paidDocIds.length) {
    const rows = await db.select({ id: tables.salesDocuments.id, number: tables.salesDocuments.number, customer: tables.salesDocuments.customer })
      .from(tables.salesDocuments).where(inArray(tables.salesDocuments.id, paidDocIds))
    for (const r of rows) docNames.set(r.id, { number: r.number, name: r.customer?.name ?? null })
  }
  const expenseById = new Map(expenses.map(e => [e.id, e]))
  const cat = (code: string, name: RegExp) => categories.find(c => c.accountCode === code && name.test(c.name))?.id ?? categories.find(c => name.test(c.name))?.id ?? null
  const taken = new Set<string>()

  const results = new Map<number, BankSuggestion | null>()
  // Primero los movimientos con más información (número en el concepto) para que no les quiten el documento
  for (const tx of txs) {
    const amount = Math.abs(tx.amount)
    const text = `${tx.description} ${tx.counterparty ?? ''} ${tx.reference ?? ''}`
    const candidates: BankSuggestion[] = []
    const near = (d: string) => Math.abs(daysBetween(d, tx.date))

    if (tx.amount > 0) {
      for (const p of payments) {
        const diff = Math.abs(p.amount - amount)
        if (p.direction !== 'in' || usedPayments.has(p.id) || diff > MATCH_TOLERANCE || near(p.date) > 10) continue
        const doc = p.salesDocumentId ? docNames.get(p.salesDocumentId) : null
        const exact = diff <= 0.01
        const score = (exact ? 72 : 64) + (numberInText(doc?.number, text) ? 20 : 0) + Math.round(nameScore(doc?.name, text) * 15) - near(p.date)
        candidates.push({ kind: 'payment', id: p.id, label: `Cobro ya anotado${doc?.number ? ` · ${doc.number}` : ''}${exact ? '' : ' (±1 €)'}`, detail: doc?.name ?? null, confidence: score, source: 'match' })
      }
      for (const inv of invoices) {
        const pending = round2(inv.total - inv.paidTotal)
        const byNumber = numberInText(inv.number, text)
        const diff = Math.abs(pending - amount)
        const exact = diff <= 0.01
        const nearAmount = diff <= MATCH_TOLERANCE
        if (!exact && !nearAmount && !(byNumber && amount < pending)) continue
        let score = exact ? 62 : nearAmount ? 58 : 50
        if (byNumber) score += 26
        score += Math.round(nameScore(inv.customer?.name, text) * 18)
        if (tx.date < inv.issueDate) score -= 25
        candidates.push({ kind: 'invoice', id: inv.id, label: `Factura ${inv.number}${exact ? '' : nearAmount ? ' (±1 €)' : ' (cobro parcial)'}`, detail: inv.customer?.name ?? null, confidence: score, source: 'match' })
      }
    }
    else {
      for (const p of payments) {
        const diff = Math.abs(p.amount - amount)
        if (p.direction !== 'out' || usedPayments.has(p.id) || diff > MATCH_TOLERANCE || near(p.date) > 10) continue
        const e = p.expenseId ? expenseById.get(p.expenseId) : null
        const exact = diff <= 0.01
        const score = (exact ? 72 : 64) + Math.round(nameScore(e?.supplier?.name, text) * 18) - near(p.date)
        candidates.push({ kind: 'payment', id: p.id, label: `Pago ya anotado${e?.supplier?.name ? ` · ${e.supplier.name}` : ''}${exact ? '' : ' (±1 €)'}`, detail: e?.description ?? null, confidence: score, source: 'match' })
      }
      for (const e of expenses) {
        if (usedExpenses.has(e.id)) continue
        const pending = round2(e.total - e.paidTotal)
        const open = e.status !== 'paid'
        // Pendiente: lo que falta; pagado (sin movimiento): el total
        const target = open ? pending : e.total
        const diff = Math.abs(target - amount)
        const exact = diff <= 0.01
        const nearAmount = diff <= MATCH_TOLERANCE
        if (!exact && !nearAmount) continue
        const gap = daysBetween(e.issueDate, tx.date)
        if (gap < -7 || gap > (open ? 120 : 45)) continue
        // Sin proveedor (tickets, cuota de autónomos…) la descripción también identifica el gasto
        const name = Math.max(nameScore(e.supplier?.name, text), nameScore(e.description, text))
        let score = (open ? (exact ? 62 : 56) : (exact ? 55 : 50)) + Math.round(name * 22) + (numberInText(e.number, text) ? 15 : 0)
        // Pagado y sin nombre en común: solo cuenta si la fecha casi coincide (evita duplicar gastos ya anotados)
        if (!open && name === 0 && Math.abs(gap) > 3) score -= 15
        // Gastos que se repiten cada mes por el mismo importe: manda la fecha más cercana
        score -= open ? Math.min(12, Math.floor(Math.abs(gap) / 5)) : Math.min(25, Math.round(Math.abs(gap) * 0.8))
        if (Math.abs(gap) <= 5 && name >= 0.5) score += 10
        candidates.push({ kind: 'expense', id: e.id, label: `${open ? 'Gasto pendiente' : 'Gasto'} · ${e.supplier?.name ?? e.description ?? 'sin proveedor'}${exact ? '' : ' (±1 €)'}`, detail: e.number ? `Factura ${e.number}` : e.description ?? null, confidence: score, source: 'match' })
      }
    }

    candidates.sort((a, b) => b.confidence - a.confidence)
    let best = candidates.find(c => !taken.has(`${c.kind}:${c.id}`)) ?? null
    if (best) {
      const second = candidates.find(c => c !== best && !taken.has(`${c.kind}:${c.id}`))
      // Empate: baja la confianza para que el usuario elija
      if (second && second.confidence >= best.confidence - 5) best = { ...best, confidence: Math.min(best.confidence, 60) }
      best = { ...best, confidence: Math.max(1, Math.min(99, best.confidence)) }
      if (best.confidence >= 50) taken.add(`${best.kind}:${best.id}`)
      else best = null
    }
    if (!best) {
      const p = plain(text)
      const rule = RULES.find(r => r.re.test(p) && (r.sign === 0 || Math.sign(tx.amount) === r.sign))
      const bank = accounts.find(a => a.id === tx.accountId)?.bankName ?? null
      if (rule) best = { ...rule.make(cat, bank), confidence: 95, source: 'rule' }
      else if (tx.bankCode === '17' && tx.amount < 0) best = { ...RULES[2]!.make(cat, bank), confidence: 90, source: 'rule' }
    }
    results.set(tx.id, best)
  }

  // IA: categoría para los cargos que no casan con nada
  const rest = txs.filter(tx => !results.get(tx.id) && tx.amount < 0)
  if (rest.length && aiEnabled()) {
    try {
      const ai = await categorizeWithAi(company, rest, categories)
      for (const [id, s] of ai) results.set(id, s)
    }
    catch (err) {
      console.warn('[banco] categorías IA', (err as Error).message)
    }
  }

  // Gastos nuevos: con la deducibilidad que el usuario suele marcar para ese proveedor o categoría
  const fresh = [...results.values()].filter((s): s is BankSuggestion => s?.kind === 'new_expense')
  if (fresh.length) {
    const guess = await deductibleGuesser(company.id)
    for (const s of fresh) {
      const g = guess({ supplierName: s.supplier, categoryId: s.categoryId })
      s.deductiblePct = g.deductiblePct
      s.vatDeductiblePct = g.vatDeductiblePct
    }
  }

  await Promise.all([...results].map(([id, suggestion]) => db.update(t).set({ suggestion }).where(eq(t.id, id))))
  return [...results.values()].filter(Boolean).length
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
        required: ['id', 'type', 'categoryId', 'supplier', 'vatRate', 'confidence', 'note'],
        properties: {
          id: { type: 'integer' },
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

async function categorizeWithAi(company: Company, txs: BankTx[], categories: Array<{ id: number, name: string }>) {
  const out = new Map<number, BankSuggestion>()
  for (let i = 0; i < txs.length; i += 60) {
    const chunk = txs.slice(i, i + 60)
    const { data } = await aiJson<{ items: Array<{ id: number, type: string, categoryId: number | null, supplier: string | null, vatRate: number | null, confidence: number, note: string }> }>({
      name: 'bank_categories',
      schema: AI_SCHEMA,
      effort: 'low',
      system: [
        'Clasificas cargos de un extracto bancario de una empresa española para su contabilidad.',
        `Empresa: ${company.tradeName || company.legalName} (${company.kind === 'autonomo' ? 'autónomo' : 'sociedad'}${company.activityDescription ? `, ${company.activityDescription}` : ''}).`,
        `Categorías de gasto (id: nombre): ${categories.map(c => `${c.id}: ${c.name}`).join('; ')}.`,
        'Para cada movimiento indica el tipo, la categoría más adecuada (o null), el proveedor limpio y el IVA habitual en España.',
        'Seguridad Social, nóminas, comisiones bancarias, seguros y alquileres de vivienda no llevan IVA (0). Suministros, software y compras: 21 salvo que sepas otro.',
        'Si no lo ves claro, type "unknown" y confianza baja. No inventes.',
      ].join('\n'),
      parts: [{ type: 'input_text', text: JSON.stringify(chunk.map(tx => ({ id: tx.id, fecha: tx.date, importe: tx.amount, concepto: tx.description, ordenante: tx.counterparty }))) }],
    })
    for (const item of data.items) {
      if (!chunk.some(tx => tx.id === item.id) || item.type === 'unknown' || item.confidence < 40) continue
      const confidence = Math.min(85, item.confidence)
      if (AI_IGNORE[item.type]) {
        out.set(item.id, { kind: 'ignore', label: AI_IGNORE[item.type]!, detail: item.note, confidence, source: 'ai' })
        continue
      }
      const category = categories.find(c => c.id === item.categoryId)
      out.set(item.id, {
        kind: 'new_expense',
        label: item.supplier ? `${item.supplier}${category ? ` · ${category.name}` : ''}` : category?.name ?? 'Nuevo gasto',
        detail: item.note,
        confidence,
        source: 'ai',
        expenseKind: item.type === 'social_security' ? 'social_security' : item.type === 'payroll' ? 'payroll' : 'ticket',
        categoryId: category?.id ?? null,
        supplier: item.supplier,
        vatRate: item.vatRate != null && [0, 4, 5, 10, 21].includes(item.vatRate) ? item.vatRate : 21,
      })
    }
  }
  return out
}

/** Propuestas que se pueden aceptar en bloque sin revisarlas una a una */
export function isSafeSuggestion(s: BankSuggestion | null | undefined) {
  if (!s) return false
  if (s.kind === 'invoice' || s.kind === 'expense' || s.kind === 'payment') return s.confidence >= 85
  return s.source === 'rule' && s.confidence >= 90
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

/** Concilia un movimiento con una factura, un gasto o un cobro/pago ya anotado */
export async function confirmMatch(company: Company, userId: number, txId: number, target: { kind: 'invoice' | 'expense' | 'payment', id: number }) {
  const db = useDb()
  let tx = await loadTx(company.id, txId)
  if (tx.status === 'matched') {
    // Si ya estaba conciliado con otro documento, deshacer la asignación previa para reasignar al nuevo
    await unmatch(company, txId)
    tx = await loadTx(company.id, txId)
  }
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
    if (!isOpenStatus(doc.status)) throw createError({ statusCode: 409, statusMessage: 'Esta factura no tiene cobros pendientes' })
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

/** Crea el gasto de un cargo (comisión, cuota de autónomos, suministro…) ya pagado y lo concilia */
export async function expenseFromTx(company: Company, userId: number, txId: number, input: {
  kind: BankSuggestion['expenseKind']
  categoryId: number | null
  supplier: string | null
  vatRate: number
  description: string | null
  /** Sin indicar: la que se marcó la última vez con ese proveedor o la de la categoría */
  deductiblePct?: number | null
  vatDeductiblePct?: number | null
}) {
  const db = useDb()
  const tx = await loadTx(company.id, txId)
  if (tx.status === 'matched') throw createError({ statusCode: 409, statusMessage: 'Este movimiento ya está conciliado' })
  if (tx.amount >= 0) throw createError({ statusCode: 400, statusMessage: 'Solo los cargos pueden ser gastos' })
  const guess = input.deductiblePct == null ? (await deductibleGuesser(company.id))({ supplierName: input.supplier, categoryId: input.categoryId }) : null
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
    newSupplier: input.supplier ? { name: input.supplier.slice(0, 200), nif: null, address: null, postalCode: null, city: null, province: null, country: 'ES', email: null, phone: null, isPerson: false } : null,
  })
  const [res] = await db.insert(tables.payments).values({
    companyId: company.id, direction: 'out', expenseId, amount: total, date: tx.date, method, bankAccountId: tx.accountId, notes: 'Conciliado con el banco',
  }).$returningId()
  await db.update(tables.bankTransactions).set({
    status: 'matched', matchedAt: new Date(), matchedBy: userId, expenseId, paymentId: res!.id, salesDocumentId: null, ownsPayment: true, ignoreReason: null,
  }).where(eq(tables.bankTransactions.id, tx.id))
  return expenseId
}

/**
 * Deshace la conciliación: borra el cobro/pago que creó (no los documentos).
 * En lote se pasa `suggest: false` y las propuestas se recalculan una vez para todos.
 */
export async function unmatch(company: Company, txId: number, opts: { suggest?: boolean } = {}) {
  const db = useDb()
  const tx = await loadTx(company.id, txId)
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
    status: 'pending', paymentId: null, salesDocumentId: null, expenseId: null, ownsPayment: false, ignoreReason: null, matchedAt: null, matchedBy: null,
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
