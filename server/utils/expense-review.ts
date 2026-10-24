import { and, eq, inArray, isNotNull, isNull, like, ne } from 'drizzle-orm'
import { reviewCurrency, reviewKind, reviewNotesOf } from '../../shared/utils/review'

/**
 * Gastos «por revisar»: guardan el motivo (review_notes) y la app vuelve a mirarlos sola. Lo que ya está
 * resuelto en los datos (el proveedor se identificó, los importes cuadran, otro gasto del mismo
 * proveedor ya se dio por bueno…) deja de pedir revisión sin abrir cada gasto.
 */

type Expense = typeof tables.expenses.$inferSelect
type TaxLine = Pick<typeof tables.expenseTaxLines.$inferSelect, 'base' | 'vatRate' | 'vatAmount' | 'surchargeRate' | 'surchargeAmount'>

const nifKey = (v?: string | null) => (v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/**
 * Proveedor de las facturas con el mismo prefijo de numeración: «9BF0758D-0042» y «9BF0758D-0043» son
 * del mismo comercio (Stripe y similares numeran así por cliente). Solo si todas apuntan al mismo.
 */
export async function supplierByNumber(companyId: number, number: string | null | undefined, excludeId?: number) {
  const prefix = number?.trim().match(/^([A-Z0-9]{8,})-\d+$/i)?.[1]
  if (!prefix || !/\d/.test(prefix) || !/[A-Z]/i.test(prefix)) return null
  const e = tables.expenses
  const rows = await useDb().selectDistinct({ supplierId: e.supplierId }).from(e)
    .where(and(eq(e.companyId, companyId), like(e.number, `${prefix}-%`), isNotNull(e.supplierId), excludeId ? ne(e.id, excludeId) : undefined))
  return rows.length === 1 ? rows[0]!.supplierId : null
}

/** Proveedores con algún gasto ya dado por bueno: sus documentos son de la empresa aunque el destinatario no cuadre */
async function trustedSuppliers(companyId: number, ids: number[]) {
  if (!ids.length) return new Set<number>()
  const e = tables.expenses
  const rows = await useDb().selectDistinct({ id: e.supplierId }).from(e)
    .where(and(eq(e.companyId, companyId), inArray(e.supplierId, ids), eq(e.reviewed, true)))
  return new Set(rows.map(r => r.id!))
}

export async function isTrustedSupplier(companyId: number, supplierId: number | null) {
  return !!supplierId && (await trustedSuppliers(companyId, [supplierId])).has(supplierId)
}

/** El motivo sigue en pie con los datos de ahora (lo que solo puede confirmar una persona, sí) */
function stillOpen(note: string, x: Pick<Expense, 'supplierId' | 'number' | 'total' | 'irpfTotal'>, lines: TaxLine[], supplierNif: string | null, trusted: Set<number>) {
  switch (reviewKind(note)) {
    case 'supplier': return !x.supplierId
    case 'parties': return !(x.supplierId && trusted.has(x.supplierId))
    case 'number': return !x.number
    case 'nif': {
      const read = note.match(/^El NIF (\S+)/)?.[1]
      return !!supplierNif && nifKey(supplierNif) === nifKey(read) && !validateNif(supplierNif).valid
    }
    case 'amounts': {
      const sum = round2(lines.reduce((s, l) => s + l.base + l.vatAmount + l.surchargeAmount, 0) - x.irpfTotal)
      return Math.abs(sum - x.total) > 0.05
        || lines.some(l => Math.abs(l.vatAmount - pctOf(l.base, l.vatRate)) > Math.max(0.05, Math.abs(l.base) * 0.002))
    }
    default: return true
  }
}

/** Motivos de un gasto marcado antes de guardarlos: los avisos de su importación o el gasto fijo que lo creó */
async function legacyNotes(companyId: number, rows: Expense[]) {
  const missing = rows.filter(r => r.reviewNotes == null)
  if (!missing.length) return new Map<number, string[]>()
  const ii = tables.importItems
  const items = await useDb().select({ resultId: ii.resultId, warnings: ii.warnings }).from(ii)
    .where(and(eq(ii.companyId, companyId), eq(ii.type, 'expense'), inArray(ii.resultId, missing.map(r => r.id))))
  const warnings = new Map(items.map(i => [i.resultId!, i.warnings ?? []]))
  return new Map(missing.map(r => [r.id, warnings.has(r.id)
    ? reviewNotesOf(warnings.get(r.id))
    : r.recurringId ? ['Creado por el gasto fijo: confirma el importe de este periodo'] : ['Revisa los datos con el documento original']]))
}

/**
 * Vuelve a mirar los gastos por revisar (todos, unos concretos o los de un proveedor): identifica el
 * proveedor que falte por la numeración de sus facturas y quita la marca a lo que ya está resuelto.
 */
export async function recheckExpenseReviews(companyId: number, scope: { ids?: number[], supplierId?: number } = {}) {
  const db = useDb()
  const e = tables.expenses
  let resolved = 0
  // Varias pasadas: dar por bueno un gasto de un proveedor resuelve los demás suyos
  for (let pass = 0; pass < 3; pass++) {
    const rows = await db.select().from(e).where(and(
      eq(e.companyId, companyId),
      eq(e.reviewed, false),
      scope.ids ? inArray(e.id, scope.ids.length ? scope.ids : [0]) : undefined,
      scope.supplierId ? eq(e.supplierId, scope.supplierId) : undefined,
    ))
    if (!rows.length) break
    const legacy = await legacyNotes(companyId, rows)

    for (const r of rows) {
      if (r.supplierId || !r.number) continue
      const supplierId = await supplierByNumber(companyId, r.number, r.id)
      if (!supplierId) continue
      const [c] = await db.select().from(tables.contacts).where(and(eq(tables.contacts.id, supplierId), eq(tables.contacts.companyId, companyId)))
      if (!c) continue
      r.supplierId = c.id
      r.supplier = contactSnapshot(c)
      await db.update(e).set({ supplierId: c.id, supplier: r.supplier }).where(eq(e.id, r.id))
    }

    const supplierIds = [...new Set(rows.map(r => r.supplierId).filter((x): x is number => !!x))]
    const [lines, contacts, trusted] = await Promise.all([
      db.select().from(tables.expenseTaxLines).where(inArray(tables.expenseTaxLines.expenseId, rows.map(r => r.id))),
      supplierIds.length ? db.select({ id: tables.contacts.id, nif: tables.contacts.nif }).from(tables.contacts).where(inArray(tables.contacts.id, supplierIds)) : Promise.resolve([]),
      trustedSuppliers(companyId, supplierIds),
    ])
    const nifOf = new Map(contacts.map(c => [c.id, c.nif]))
    let changed = false
    for (const r of rows) {
      const notes = r.reviewNotes ?? legacy.get(r.id) ?? []
      const own = lines.filter(l => l.expenseId === r.id)
      const open = notes.filter(n => stillOpen(n, r, own, r.supplierId ? nifOf.get(r.supplierId) ?? null : r.supplier?.nif ?? null, trusted))
      if (!open.length) {
        await db.update(e).set({ reviewed: true, reviewNotes: null }).where(eq(e.id, r.id))
        resolved++
        changed = true
      }
      else if (JSON.stringify(open) !== JSON.stringify(r.reviewNotes)) {
        await db.update(e).set({ reviewNotes: open }).where(eq(e.id, r.id))
      }
    }
    if (!changed) break
  }
  return resolved
}

/** Gastos marcados antes de guardar el motivo: se vuelven a mirar una vez, al consultar la empresa */
export async function ensureReviewNotes(companyId: number) {
  const e = tables.expenses
  const [legacy] = await useDb().select({ id: e.id }).from(e)
    .where(and(eq(e.companyId, companyId), eq(e.reviewed, false), isNull(e.reviewNotes))).limit(1)
  if (legacy) await recheckExpenseReviews(companyId)
}

/** El usuario da por buenos estos gastos; los demás del mismo proveedor se vuelven a mirar */
export async function confirmExpenseReviews(companyId: number, ids: number[]) {
  const db = useDb()
  const e = tables.expenses
  const rows = await db.select({ id: e.id, supplierId: e.supplierId }).from(e)
    .where(and(eq(e.companyId, companyId), inArray(e.id, ids.length ? ids : [0]), eq(e.reviewed, false)))
  if (!rows.length) return { confirmed: 0, resolved: 0 }
  await db.update(e).set({ reviewed: true, reviewNotes: null }).where(inArray(e.id, rows.map(r => r.id)))
  let resolved = 0
  for (const supplierId of new Set(rows.map(r => r.supplierId).filter((x): x is number => !!x))) {
    resolved += await recheckExpenseReviews(companyId, { supplierId })
  }
  return { confirmed: rows.length, resolved }
}

// ─── Moneda extranjera → euros ───────────────────────────────────────────────

const rates = new Map<string, Promise<{ rate: number, date: string }>>()

/** Cambio oficial del BCE de ese día (o del último día hábil anterior) */
export function ecbRate(currency: string, date: string) {
  const key = `${currency}|${date}`
  let p = rates.get(key)
  if (!p) {
    p = (async () => {
      const res = await fetch(`https://api.frankfurter.dev/v1/${date}?base=${encodeURIComponent(currency)}&symbols=EUR`, {
        headers: { 'accept': 'application/json', 'user-agent': 'NUMIQ' },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) throw new Error(`No hay cambio oficial del BCE para ${currency}`)
      const j = await res.json() as { date?: string, rates?: { EUR?: number } }
      if (!j.rates?.EUR || !j.date) throw new Error(`No hay cambio oficial del BCE para ${currency}`)
      return { rate: j.rates.EUR, date: j.date }
    })()
    p.catch(() => rates.delete(key))
    rates.set(key, p)
  }
  return p
}

const dmy = (iso: string) => iso.split('-').reverse().join('/')
const amountText = (n: number) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }).format(n)

/** Nota que deja la conversión, para saber siempre de dónde sale el importe en euros */
export function conversionNote(currency: string, originalTotal: number, how: { rate: number, date: string } | { bank: number }) {
  return 'bank' in how
    ? `Importes originales en ${currency}: ${amountText(originalTotal)} ${currency}. Convertidos con el cargo real del banco (${eurText(how.bank)}).`
    : `Importes originales en ${currency}: ${amountText(originalTotal)} ${currency}. Cambio oficial del BCE del ${dmy(how.date)}: 1 ${currency} = ${how.rate.toLocaleString('es-ES', { maximumFractionDigits: 6 })} €.`
}

/** Escala bases, cuotas y retención; con un total de destino (el cargo del banco), el redondeo va a la primera base */
export function scaleTaxLines<T extends { base: number, vatAmount: number, surchargeAmount: number }>(lines: T[], irpf: number, factor: number, target?: number) {
  const scaled = lines.map(l => ({ ...l, base: round2(l.base * factor), vatAmount: round2(l.vatAmount * factor), surchargeAmount: round2(l.surchargeAmount * factor) }))
  const irpfTotal = round2(irpf * factor)
  let total = round2(scaled.reduce((s, l) => s + l.base + l.vatAmount + l.surchargeAmount, 0) - irpfTotal)
  if (target != null && scaled.length && Math.abs(target - total) <= 0.05) {
    scaled[0]!.base = round2(scaled[0]!.base + target - total)
    total = target
  }
  return { lines: scaled, irpfTotal, total }
}

/**
 * Pasa a euros un gasto que se importó con los importes en otra moneda: con el cargo del banco si
 * está conciliado (lo que se pagó de verdad) o, si no, con el cambio oficial del BCE de su fecha.
 */
export async function convertExpenseToEur(companyId: number, id: number) {
  const db = useDb()
  const e = tables.expenses
  const [x] = await db.select().from(e).where(and(eq(e.id, id), eq(e.companyId, companyId)))
  if (!x) throw createError({ statusCode: 404, statusMessage: 'Gasto no encontrado' })
  const currency = reviewCurrency(x.reviewNotes)
  if (!currency || !x.total) return { converted: false, total: x.total }
  const [bank] = await db.select({ amount: tables.bankTransactions.amount }).from(tables.bankTransactions)
    .where(and(eq(tables.bankTransactions.companyId, companyId), eq(tables.bankTransactions.expenseId, id), eq(tables.bankTransactions.status, 'matched')))
  const how = bank?.amount ? { bank: Math.abs(bank.amount) } : await ecbRate(currency, x.issueDate)
  const factor = 'bank' in how ? how.bank / Math.abs(x.total) : how.rate
  const lines = await db.select().from(tables.expenseTaxLines).where(eq(tables.expenseTaxLines.expenseId, id))
  const s = scaleTaxLines(lines, x.irpfTotal, factor, 'bank' in how ? Math.sign(x.total) * how.bank : undefined)
  const reviewNotes = (x.reviewNotes ?? []).filter(n => reviewKind(n) !== 'currency')
  await db.transaction(async (tx) => {
    await tx.update(e).set({
      taxBase: round2(s.lines.reduce((t, l) => t + l.base, 0)),
      vatTotal: round2(s.lines.reduce((t, l) => t + l.vatAmount, 0)),
      surchargeTotal: round2(s.lines.reduce((t, l) => t + l.surchargeAmount, 0)),
      irpfTotal: s.irpfTotal,
      total: s.total,
      paidTotal: x.status === 'paid' ? s.total : round2(x.paidTotal * factor),
      notes: [conversionNote(currency, x.total, how), x.notes].filter(Boolean).join('\n\n').slice(0, 5000),
      reviewNotes: reviewNotes.length ? reviewNotes : null,
      reviewed: !reviewNotes.length,
    }).where(eq(e.id, id))
    for (const l of s.lines) {
      await tx.update(tables.expenseTaxLines).set({ base: l.base, vatAmount: l.vatAmount, surchargeAmount: l.surchargeAmount }).where(eq(tables.expenseTaxLines.id, l.id))
    }
    // Pagos anotados en la moneda original; el del banco ya está en euros
    if (!bank) {
      const pays = await tx.select({ id: tables.payments.id, amount: tables.payments.amount }).from(tables.payments).where(eq(tables.payments.expenseId, id))
      for (const p of pays) await tx.update(tables.payments).set({ amount: pays.length === 1 && x.status === 'paid' ? s.total : round2(p.amount * factor) }).where(eq(tables.payments.id, p.id))
    }
  })
  return { converted: true, total: s.total }
}
