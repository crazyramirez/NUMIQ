import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { ibansInText, nameInText, significantWords, taxIdKey, taxIdsInText } from '../../shared/utils/duplicate-matching'

type BankTx = Pick<typeof tables.bankTransactions.$inferSelect, 'id' | 'amount' | 'description' | 'counterparty' | 'reference'>

/** Cliente o proveedor reconocido en un movimiento del banco, con lo que le identifica */
export interface BankContactHit {
  id: number
  name: string
  isClient: boolean
  isSupplier: boolean
  /** 0-100: IBAN o NIF ~99, lo aprendido de otros movimientos ~92, el nombre 70-88 */
  score: number
  reason: string
  /** Lo que se le anotó la última vez (gasto nuevo del mismo proveedor) */
  usual: SupplierUsual | null
}

/** Último gasto de un proveedor: tipo, categoría e IVA que se repiten en sus cargos */
export interface SupplierUsual {
  kind: 'invoice' | 'ticket' | 'payroll' | 'social_security' | 'tax' | 'other'
  categoryId: number | null
  vatRate: number | null
}

const bankKey = (s?: string | null) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/**
 * Lo que identifica a quien paga o cobra en un movimiento: el ordenante o beneficiario si el banco lo da
 * y, si no, el concepto sin cifras ni referencias («RECIBO ENDESA ENERGIA 0034521 OCT» → «endesa energia»).
 */
export function bankPartyKey(tx: Pick<BankTx, 'description' | 'counterparty'>) {
  const pick = (s?: string | null) => significantWords(s).filter(w => !/\d/.test(w)).slice(0, 4).join(' ')
  return pick(tx.counterparty) || pick(tx.description)
}

/**
 * Reconoce a los clientes y proveedores ya guardados en los movimientos del banco. Por orden de certeza:
 * 1. Su IBAN o su NIF en el concepto (los recibos SEPA llevan el NIF del acreedor).
 * 2. Lo aprendido: movimientos del mismo ordenante que ya se conciliaron con una factura o gasto suyo.
 * 3. Su nombre en el ordenante o el concepto, con erratas, abreviaturas o siglas; si varios encajan, el
 *    que nombra más palabras y, a igualdad, el del papel que toca (cliente si entra dinero, proveedor si sale).
 */
export async function bankContactMatcher(companyId: number) {
  const db = useDb()
  const c = tables.contacts
  const t = tables.bankTransactions
  const e = tables.expenses
  const s = tables.salesDocuments
  const [contacts, learnedExpenses, learnedSales, usualRows] = await Promise.all([
    db.select({ id: c.id, name: c.name, tradeName: c.tradeName, nif: c.nif, iban: c.iban, isClient: c.isClient, isSupplier: c.isSupplier, defaultCategoryId: c.defaultCategoryId, archivedAt: c.archivedAt })
      .from(c).where(eq(c.companyId, companyId)),
    db.select({ description: t.description, counterparty: t.counterparty, contactId: e.supplierId }).from(t)
      .innerJoin(e, eq(e.id, t.expenseId))
      .where(and(eq(t.companyId, companyId), eq(t.status, 'matched'), isNotNull(e.supplierId))).orderBy(desc(t.date)).limit(3000),
    db.select({ description: t.description, counterparty: t.counterparty, contactId: s.contactId }).from(t)
      .innerJoin(s, eq(s.id, t.salesDocumentId))
      .where(and(eq(t.companyId, companyId), eq(t.status, 'matched'), isNotNull(s.contactId))).orderBy(desc(t.date)).limit(3000),
    db.select({ id: e.id, supplierId: e.supplierId, kind: e.kind, categoryId: e.categoryId }).from(e)
      .where(and(eq(e.companyId, companyId), isNotNull(e.supplierId), eq(e.approval, 'approved'))).orderBy(desc(e.issueDate), desc(e.id)).limit(3000),
  ])
  // Las fichas archivadas solo cuentan por IBAN o NIF: el nombre ya no basta para traerlas de vuelta
  const active = contacts.filter(x => !x.archivedAt)
  const byId = new Map(contacts.map(x => [x.id, x]))
  const byIban = new Map<string, number[]>()
  const byNif = new Map<string, number[]>()
  for (const x of contacts) {
    if (x.iban) byIban.set(bankKey(x.iban), [...(byIban.get(bankKey(x.iban)) ?? []), x.id])
    if (taxIdKey(x.nif)) byNif.set(taxIdKey(x.nif), [...(byNif.get(taxIdKey(x.nif)) ?? []), x.id])
  }

  // Ordenantes ya conciliados: la misma clave con dos contactos distintos no enseña nada
  const learned = new Map<string, number | null>()
  for (const r of [...learnedExpenses, ...learnedSales]) {
    const key = bankPartyKey(r)
    if (!key || !r.contactId || !byId.has(r.contactId)) continue
    const prev = learned.get(key)
    learned.set(key, prev === undefined || prev === r.contactId ? r.contactId : null)
  }
  const learnedKeys = [...learned].filter((x): x is [string, number] => x[1] != null)

  // Lo último que se anotó a cada proveedor, con el IVA de su línea principal
  const usualBySupplier = new Map<number, { id: number, kind: SupplierUsual['kind'], categoryId: number | null }>()
  for (const r of usualRows) if (r.supplierId && !usualBySupplier.has(r.supplierId)) usualBySupplier.set(r.supplierId, { id: r.id, kind: r.kind, categoryId: r.categoryId })
  const vatByExpense = new Map<number, number>()
  const lastIds = [...usualBySupplier.values()].map(u => u.id)
  for (let i = 0; i < lastIds.length; i += 500) {
    const lines = await db.select({ expenseId: tables.expenseTaxLines.expenseId, base: tables.expenseTaxLines.base, vatRate: tables.expenseTaxLines.vatRate })
      .from(tables.expenseTaxLines).where(inArray(tables.expenseTaxLines.expenseId, lastIds.slice(i, i + 500)))
    const best = new Map<number, { base: number, vatRate: number }>()
    for (const l of lines) if (!best.has(l.expenseId) || Math.abs(l.base) > Math.abs(best.get(l.expenseId)!.base)) best.set(l.expenseId, l)
    for (const [id, l] of best) vatByExpense.set(id, l.vatRate)
  }
  const usual = (id: number): SupplierUsual | null => {
    const u = usualBySupplier.get(id)
    const contact = byId.get(id)
    if (!u) return contact?.defaultCategoryId ? { kind: 'invoice', categoryId: contact.defaultCategoryId, vatRate: null } : null
    return { kind: u.kind, categoryId: contact?.defaultCategoryId ?? u.categoryId, vatRate: vatByExpense.get(u.id) ?? null }
  }

  const hit = (id: number, score: number, reason: string): BankContactHit | null => {
    const x = byId.get(id)
    return x ? { id, name: x.name, isClient: x.isClient, isSupplier: x.isSupplier, score, reason, usual: usual(id) } : null
  }
  const unique = (ids?: number[]) => (ids && new Set(ids).size === 1 ? ids[0]! : null)

  // Proveedores por uso (los que más gastos tienen, primero) para que la IA elija entre ellos
  const uses = new Map<number, number>()
  for (const r of usualRows) uses.set(r.supplierId!, (uses.get(r.supplierId!) ?? 0) + 1)
  const suppliers = active.filter(x => x.isSupplier).sort((x, y) => (uses.get(y.id) ?? 0) - (uses.get(x.id) ?? 0))
    .map(x => ({ id: x.id, name: x.name, tradeName: x.tradeName }))

  const identify = (tx: BankTx): BankContactHit | null => {
    const text = [tx.description, tx.counterparty, tx.reference].filter(Boolean).join(' ')
    for (const iban of ibansInText(text)) {
      const id = unique(byIban.get(bankKey(iban)))
      if (id) return hit(id, 99, 'Su IBAN aparece en el movimiento')
    }
    for (const nif of taxIdsInText(text)) {
      const id = unique(byNif.get(taxIdKey(nif)))
      if (id) return hit(id, 98, `Su NIF (${nif}) aparece en el movimiento`)
    }
    const key = bankPartyKey(tx)
    if (key) {
      const same = learned.get(key)
      if (same) return hit(same, 92, 'Como sus movimientos ya conciliados')
      // Lo aprendido dentro de un concepto más largo («ENDESA ENERGIA» en «RECIBO ENDESA ENERGIA LUZ»)
      const within = [...new Set(learnedKeys.filter(([k]) => k.includes(' ') && nameInText(k, text) >= k.split(' ').length).map(([, id]) => id))]
      if (within.length === 1) return hit(within[0]!, 90, 'Como sus movimientos ya conciliados')
    }
    const role = tx.amount > 0 ? 'isClient' : 'isSupplier'
    // Primero el ordenante (lo más limpio); después el concepto entero
    for (const [source, value] of [['ordenante', tx.counterparty], ['concepto', text]] as const) {
      if (!value) continue
      const ranked = active.map(x => ({ x, n: Math.max(nameInText(x.name, value), nameInText(x.tradeName, value)) }))
        .filter(r => r.n > 0)
        .sort((a, b) => b.n - a.n || Number(b.x[role]) - Number(a.x[role]))
      const [first, second] = ranked
      if (!first) continue
      // Empate real (mismas palabras, mismo papel): mejor no adivinar
      if (second && second.n === first.n && second.x[role] === first.x[role]) return null
      const score = Math.min(88, 70 + Math.round(first.n * 6) + (first.x[role] ? 4 : -6) + (source === 'ordenante' ? 4 : 0))
      return hit(first.x.id, score, `Su nombre aparece en el ${source}`)
    }
    return null
  }
  return { identify, suppliers }
}

/**
 * Tras conciliar: el IBAN o el NIF que traía el movimiento pasan a la ficha de su cliente o proveedor si
 * no los tenía (y ninguna otra ficha los tiene). Nunca los de la propia empresa ni sus cuentas.
 */
export async function learnContactFromTx(company: { id: number, nif: string | null }, tx: typeof tables.bankTransactions.$inferSelect) {
  if (tx.status !== 'matched') return
  const db = useDb()
  const contactId = tx.salesDocumentId
    ? (await db.select({ id: tables.salesDocuments.contactId }).from(tables.salesDocuments).where(eq(tables.salesDocuments.id, tx.salesDocumentId)))[0]?.id
    : tx.expenseId ? (await db.select({ id: tables.expenses.supplierId }).from(tables.expenses).where(eq(tables.expenses.id, tx.expenseId)))[0]?.id : null
  if (!contactId) return
  const text = [tx.description, tx.counterparty, tx.reference].filter(Boolean).join(' ')
  const own = new Set((await db.select({ iban: tables.bankAccounts.iban }).from(tables.bankAccounts).where(eq(tables.bankAccounts.companyId, company.id))).map(a => bankKey(a.iban)))
  const ibans = ibansInText(text).filter(i => !own.has(bankKey(i)))
  const nifs = taxIdsInText(text).filter(n => taxIdKey(n) !== taxIdKey(company.nif))
  // Uno solo de cada: con dos no se sabe cuál es suyo
  const iban = ibans.length === 1 ? ibans[0]! : null
  const nif = nifs.length === 1 ? nifs[0]! : null
  if (!iban && !nif) return
  const c = tables.contacts
  const [contact] = await db.select({ id: c.id, iban: c.iban, nif: c.nif }).from(c).where(and(eq(c.id, contactId), eq(c.companyId, company.id)))
  if (!contact) return
  if (iban && !contact.iban) {
    const [other] = await db.select({ id: c.id }).from(c).where(and(eq(c.companyId, company.id), eq(c.iban, iban))).limit(1)
    if (!other) await db.update(c).set({ iban }).where(eq(c.id, contact.id))
  }
  if (nif && !contact.nif) await fillContactGaps(company.id, contact.id, { nif })
}
