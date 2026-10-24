import { and, desc, eq, gte, inArray, lte, notInArray, sql } from 'drizzle-orm'

/**
 * Cifras de negocio y estimaciones fiscales. Criterio de devengo: cuentan las facturas por su
 * fecha de expedición (no por el cobro), como en el 303 y el 130 del régimen general.
 */

const s = () => tables.salesDocuments
const e = () => tables.expenses

const salesWhere = (companyId: number, from: string, to: string) => and(
  eq(s().companyId, companyId),
  inArray(s().kind, ['invoice', 'rectifying']),
  notInArray(s().status, ['draft', 'cancelled']),
  gte(s().issueDate, from),
  lte(s().issueDate, to),
)

const expensesWhere = (companyId: number, from: string, to: string) => and(
  eq(e().companyId, companyId),
  approvedExpense(),
  gte(e().issueDate, from),
  lte(e().issueDate, to),
)

export interface PeriodSummary {
  income: number
  /** Importe total de las facturas (con impuestos), para mostrar */
  incomeTotal: number
  vatCharged: number
  irpfWithheld: number
  /** Base de ventas con retención (para la regla del 70 % del modelo 130) */
  incomeWithRetention: number
  expenses: number
  /** Importe total de los gastos (con impuestos), para mostrar */
  expensesTotal: number
  deductibleExpenses: number
  vatDeductible: number
  profit: number
}

export async function periodSummary(companyId: number, from: string, to: string): Promise<PeriodSummary> {
  const db = useDb()
  const [[inc], [exp]] = await Promise.all([
    db.select({
      income: sql<number>`COALESCE(SUM(${s().taxBase}), 0)`.mapWith(Number),
      incomeTotal: sql<number>`COALESCE(SUM(${s().total}), 0)`.mapWith(Number),
      vatCharged: sql<number>`COALESCE(SUM(${s().vatTotal} + ${s().surchargeTotal}), 0)`.mapWith(Number),
      irpfWithheld: sql<number>`COALESCE(SUM(${s().irpfTotal}), 0)`.mapWith(Number),
      incomeWithRetention: sql<number>`COALESCE(SUM(CASE WHEN ${s().irpfTotal} <> 0 THEN ${s().taxBase} ELSE 0 END), 0)`.mapWith(Number),
    }).from(s()).where(salesWhere(companyId, from, to)),
    db.select({
      expenses: sql<number>`COALESCE(SUM(${e().taxBase}), 0)`.mapWith(Number),
      expensesTotal: sql<number>`COALESCE(SUM(${e().total}), 0)`.mapWith(Number),
      deductibleExpenses: sql<number>`COALESCE(SUM(CASE WHEN ${e().isInvestment} THEN 0 ELSE ${e().taxBase} * ${e().deductiblePct} / 100 END), 0)`.mapWith(Number),
      vatDeductible: sql<number>`COALESCE(SUM(${e().vatTotal} * ${e().vatDeductiblePct} / 100), 0)`.mapWith(Number),
    }).from(e()).where(expensesWhere(companyId, from, to)),
  ])
  const income = round2(inc!.income)
  const deductibleExpenses = round2(exp!.deductibleExpenses)
  return {
    income,
    incomeTotal: round2(inc!.incomeTotal),
    vatCharged: round2(inc!.vatCharged),
    irpfWithheld: round2(inc!.irpfWithheld),
    incomeWithRetention: round2(inc!.incomeWithRetention),
    expenses: round2(exp!.expenses),
    expensesTotal: round2(exp!.expensesTotal),
    deductibleExpenses,
    vatDeductible: round2(exp!.vatDeductible),
    profit: round2(income - round2(exp!.expenses)),
  }
}

/** Retenciones practicadas a proveedores: alquileres (cuenta 621) → 115, resto → 111 */
export async function withholdings(companyId: number, from: string, to: string) {
  const e = tables.expenses
  const cat = tables.categories
  const rows = await useDb().select({
    rent: sql<boolean>`COALESCE(${cat.accountCode} = '621', 0)`.mapWith(Boolean),
    base: sql<number>`SUM(${e.taxBase})`.mapWith(Number),
    amount: sql<number>`SUM(${e.irpfTotal})`.mapWith(Number),
    recipients: sql<number>`COUNT(DISTINCT ${e.supplierId})`.mapWith(Number),
  }).from(e).leftJoin(cat, eq(cat.id, e.categoryId))
    .where(and(eq(e.companyId, companyId), approvedExpense(), gte(e.issueDate, from), lte(e.issueDate, to), sql`${e.irpfTotal} > 0`))
    .groupBy(sql`COALESCE(${cat.accountCode} = '621', 0)`)
  const pick = (rent: boolean) => {
    const r = rows.find(x => x.rent === rent)
    return { base: round2(r?.base ?? 0), result: round2(r?.amount ?? 0), recipients: r?.recipients ?? 0 }
  }
  return { m111: pick(false), m115: pick(true) }
}

/** Modelo 303: IVA devengado − IVA deducible del trimestre */
export async function estimate303(companyId: number, year: number, q: Quarter) {
  const { from, to } = quarterRange(year, q)
  const p = await periodSummary(companyId, from, to)
  return { accrued: p.vatCharged, deductible: p.vatDeductible, result: round2(p.vatCharged - p.vatDeductible) }
}

/**
 * Modelo 130 (estimación directa): 20 % del rendimiento neto acumulado del año, menos retenciones
 * soportadas y pagos de trimestres anteriores. Nunca sale negativo a ingresar.
 */
export async function estimate130(companyId: number, year: number, q: Quarter) {
  let paidBefore = 0
  let last = { income: 0, expenses: 0, netIncome: 0, withheld: 0, result: 0 }
  for (let i = 1 as Quarter; i <= q; i = (i + 1) as Quarter) {
    const p = await periodSummary(companyId, `${year}-01-01`, quarterRange(year, i).to)
    const netIncome = round2(p.income - p.deductibleExpenses)
    const gross = round2(Math.max(0, netIncome) * 0.2 - p.irpfWithheld - paidBefore)
    const result = Math.max(0, gross)
    last = { income: p.income, expenses: p.deductibleExpenses, netIncome, withheld: p.irpfWithheld, result }
    paidBefore = round2(paidBefore + result)
  }
  return last
}

/** Ingresos y gastos por mes, últimos `months` meses incluido el actual: bases (y beneficio) y totales con impuestos */
export async function monthlySeries(companyId: number, months = 12) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - months + 1, 1)
  const from = toISODate(start)
  const to = toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0))
  const db = useDb()
  const ym = (col: unknown) => sql<string>`DATE_FORMAT(${col}, '%Y-%m')`
  const [inc, exp] = await Promise.all([
    db.select({ month: ym(s().issueDate), amount: sql<number>`SUM(${s().taxBase})`.mapWith(Number), total: sql<number>`SUM(${s().total})`.mapWith(Number) })
      .from(s()).where(salesWhere(companyId, from, to)).groupBy(ym(s().issueDate)),
    db.select({ month: ym(e().issueDate), amount: sql<number>`SUM(${e().taxBase})`.mapWith(Number), total: sql<number>`SUM(${e().total})`.mapWith(Number) })
      .from(e()).where(expensesWhere(companyId, from, to)).groupBy(ym(e().issueDate)),
  ])
  const incBy = new Map(inc.map(r => [r.month, r]))
  const expBy = new Map(exp.map(r => [r.month, r]))
  return Array.from({ length: months }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1)
    const month = toISODate(d).slice(0, 7)
    const income = round2(incBy.get(month)?.amount ?? 0)
    const expenses = round2(expBy.get(month)?.amount ?? 0)
    return { month, income, expenses, profit: round2(income - expenses), incomeTotal: round2(incBy.get(month)?.total ?? 0), expensesTotal: round2(expBy.get(month)?.total ?? 0) }
  })
}

/** `by`: 'base' en informes y modelos; 'total' (con impuestos) en las pantallas */
export async function topClients(companyId: number, from: string, to: string, limit = 5, by: 'base' | 'total' = 'base') {
  const c = tables.contacts
  const col = by === 'total' ? s().total : s().taxBase
  const rows = await useDb().select({
    id: s().contactId,
    name: sql<string>`COALESCE(${c.name}, JSON_UNQUOTE(JSON_EXTRACT(${s().customer}, '$.name')), 'Sin cliente')`,
    amount: sql<number>`SUM(${col})`.mapWith(Number),
  }).from(s()).leftJoin(c, eq(c.id, s().contactId))
    .where(salesWhere(companyId, from, to))
    .groupBy(s().contactId, c.name)
    .orderBy(desc(sql`SUM(${col})`))
    .limit(limit)
  return rows.map(r => ({ ...r, amount: round2(r.amount) }))
}

export async function expensesByCategory(companyId: number, from: string, to: string, by: 'base' | 'total' = 'base') {
  const cat = tables.categories
  const col = by === 'total' ? e().total : e().taxBase
  const rows = await useDb().select({
    id: e().categoryId,
    name: sql<string>`COALESCE(${cat.name}, 'Sin categoría')`,
    icon: cat.icon,
    color: cat.color,
    amount: sql<number>`SUM(${col})`.mapWith(Number),
    total: sql<number>`SUM(${e().total})`.mapWith(Number),
  }).from(e()).leftJoin(cat, eq(cat.id, e().categoryId))
    .where(expensesWhere(companyId, from, to))
    .groupBy(e().categoryId, cat.name, cat.icon, cat.color)
    .orderBy(desc(sql`SUM(${col})`))
  return rows.map(r => ({ ...r, amount: round2(r.amount), total: round2(r.total) }))
}

export async function receivables(companyId: number) {
  const today = toISODate(new Date())
  const [r] = await useDb().select({
    amount: sql<number>`COALESCE(SUM(${s().total} - ${s().paidTotal}), 0)`.mapWith(Number),
    count: sql<number>`COUNT(*)`.mapWith(Number),
    overdueAmount: sql<number>`COALESCE(SUM(CASE WHEN ${s().dueDate} < ${today} THEN ${s().total} - ${s().paidTotal} ELSE 0 END), 0)`.mapWith(Number),
    overdueCount: sql<number>`COALESCE(SUM(CASE WHEN ${s().dueDate} < ${today} THEN 1 ELSE 0 END), 0)`.mapWith(Number),
  }).from(s()).where(and(
    eq(s().companyId, companyId),
    inArray(s().kind, ['invoice', 'rectifying']),
    inArray(s().status, [...OPEN_STATUSES]),
  ))
  return { amount: round2(r!.amount), count: r!.count, overdueAmount: round2(r!.overdueAmount), overdueCount: r!.overdueCount }
}

export async function payables(companyId: number) {
  const [r] = await useDb().select({
    amount: sql<number>`COALESCE(SUM(${e().total} - ${e().paidTotal}), 0)`.mapWith(Number),
    count: sql<number>`COUNT(*)`.mapWith(Number),
  }).from(e()).where(and(eq(e().companyId, companyId), approvedExpense(), inArray(e().status, ['pending', 'partial'])))
  return { amount: round2(r!.amount), count: r!.count }
}
