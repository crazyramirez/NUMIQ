import { and, desc, eq, gte, inArray, lte, notInArray, sql } from 'drizzle-orm'
import * as XLSX from 'xlsx'
import { z } from 'zod'

/**
 * Informes por año, trimestre o mes: cuenta de resultados, IVA por tipo, retenciones, clientes,
 * proveedores, cobros pendientes y libros registro de facturas. Criterio de devengo (fecha de
 * expedición), igual que los modelos 303 y 130.
 */

type Company = typeof tables.companies.$inferSelect
export type ReportGranularity = 'year' | 'quarter' | 'month'

export interface ReportPeriod {
  year: number
  quarter: Quarter | null
  month: number | null
  granularity: ReportGranularity
  from: string
  to: string
  /** 3T 2024, septiembre 2024, 2024 */
  label: string
  /** Para nombres de archivo: 2024-3T, 2024-09, 2024 */
  slug: string
}

export interface PeriodRange {
  from: string
  to: string
  label: string
}

const MONTH_NAMES = Object.freeze(['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'])

const pad2 = (n: number) => String(n).padStart(2, '0')
const lastDay = (year: number, month: number) => toISODate(new Date(year, month, 0))

/** Periodo de un informe a partir de año, trimestre o mes (el mes manda sobre el trimestre) */
export function resolveReportPeriod(year: number, quarter?: number | null, month?: number | null): ReportPeriod {
  if (month) {
    return {
      year, quarter: quarterOf(`${year}-${pad2(month)}-15`), month, granularity: 'month',
      from: `${year}-${pad2(month)}-01`, to: lastDay(year, month),
      label: `${MONTH_NAMES[month - 1]} ${year}`, slug: `${year}-${pad2(month)}`,
    }
  }
  if (quarter) {
    const q = quarter as Quarter
    return { year, quarter: q, month: null, granularity: 'quarter', ...quarterRange(year, q), label: `${q}T ${year}`, slug: `${year}-${q}T` }
  }
  return { year, quarter: null, month: null, granularity: 'year', from: `${year}-01-01`, to: `${year}-12-31`, label: String(year), slug: String(year) }
}

/** Periodo anterior (año, trimestre o mes) y el mismo del año pasado */
function comparisons(p: ReportPeriod): { previous: ReportPeriod, lastYear: ReportPeriod | null } {
  if (p.granularity === 'year') return { previous: resolveReportPeriod(p.year - 1), lastYear: null }
  if (p.granularity === 'quarter') {
    const previous = p.quarter === 1 ? resolveReportPeriod(p.year - 1, 4) : resolveReportPeriod(p.year, p.quarter! - 1)
    return { previous, lastYear: resolveReportPeriod(p.year - 1, p.quarter) }
  }
  const previous = p.month === 1 ? resolveReportPeriod(p.year - 1, null, 12) : resolveReportPeriod(p.year, null, p.month! - 1)
  return { previous, lastYear: resolveReportPeriod(p.year - 1, null, p.month) }
}

/** Un periodo en curso se compara con el mismo tramo de días del periodo de referencia */
function matchElapsed(current: ReportPeriod, ref: ReportPeriod, today: string): PeriodRange {
  if (today < current.from || today > current.to) return { from: ref.from, to: ref.to, label: ref.label }
  const elapsed = Math.round((new Date(`${today}T12:00:00`).getTime() - new Date(`${current.from}T12:00:00`).getTime()) / 86_400_000)
  const end = new Date(`${ref.from}T12:00:00`)
  end.setDate(end.getDate() + elapsed)
  const to = toISODate(end) < ref.to ? toISODate(end) : ref.to
  return { from: ref.from, to, label: ref.label }
}

export const reportQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).default(() => new Date().getFullYear()),
  quarter: z.coerce.number().int().min(1).max(4).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
})

// ─── Consultas ───────────────────────────────────────────────────────────────

const S = () => tables.salesDocuments
const E = () => tables.expenses

function salesIn(companyId: number, from: string, to: string) {
  return and(
    eq(S().companyId, companyId),
    inArray(S().kind, ['invoice', 'rectifying']),
    notInArray(S().status, ['draft', 'cancelled']),
    gte(S().issueDate, from),
    lte(S().issueDate, to),
  )
}

function expensesIn(companyId: number, from: string, to: string) {
  return and(eq(E().companyId, companyId), approvedExpense(), gte(E().issueDate, from), lte(E().issueDate, to))
}

export interface ReportMetrics {
  income: number
  vatCharged: number
  surchargeCharged: number
  irpfWithheld: number
  invoices: number
  rectifying: number
  expenses: number
  deductibleExpenses: number
  vatSupported: number
  vatDeductible: number
  base111: number
  irpf111: number
  base115: number
  irpf115: number
  expenseCount: number
}

const emptyMetrics = (): ReportMetrics => ({
  income: 0, vatCharged: 0, surchargeCharged: 0, irpfWithheld: 0, invoices: 0, rectifying: 0,
  expenses: 0, deductibleExpenses: 0, vatSupported: 0, vatDeductible: 0, base111: 0, irpf111: 0, base115: 0, irpf115: 0, expenseCount: 0,
})

function addMetrics(a: ReportMetrics, b: ReportMetrics): ReportMetrics {
  const out = emptyMetrics()
  for (const k of Object.keys(out) as Array<keyof ReportMetrics>) out[k] = round2(a[k] + b[k])
  return out
}

/** Cifras por mes ('YYYY-MM') de un rango */
async function monthlyMetrics(companyId: number, from: string, to: string) {
  const db = useDb()
  const cat = tables.categories
  const ym = (col: unknown) => sql<string>`DATE_FORMAT(${col}, '%Y-%m')`
  const isRent = sql`COALESCE(${cat.accountCode} = '621', 0)`
  const n = (expr: ReturnType<typeof sql>) => sql<number>`COALESCE(${expr}, 0)`.mapWith(Number)
  const [sales, exps] = await Promise.all([
    db.select({
      month: ym(S().issueDate),
      income: n(sql`SUM(${S().taxBase})`),
      vatCharged: n(sql`SUM(${S().vatTotal})`),
      surchargeCharged: n(sql`SUM(${S().surchargeTotal})`),
      irpfWithheld: n(sql`SUM(${S().irpfTotal})`),
      invoices: n(sql`SUM(CASE WHEN ${S().kind} = 'invoice' THEN 1 ELSE 0 END)`),
      rectifying: n(sql`SUM(CASE WHEN ${S().kind} = 'rectifying' THEN 1 ELSE 0 END)`),
    }).from(S()).where(salesIn(companyId, from, to)).groupBy(ym(S().issueDate)),
    db.select({
      month: ym(E().issueDate),
      expenses: n(sql`SUM(${E().taxBase})`),
      deductibleExpenses: n(sql`SUM(CASE WHEN ${E().isInvestment} THEN 0 ELSE ${E().taxBase} * ${E().deductiblePct} / 100 END)`),
      vatSupported: n(sql`SUM(${E().vatTotal})`),
      vatDeductible: n(sql`SUM(${E().vatTotal} * ${E().vatDeductiblePct} / 100)`),
      base111: n(sql`SUM(CASE WHEN ${E().irpfTotal} > 0 AND NOT ${isRent} THEN ${E().taxBase} ELSE 0 END)`),
      irpf111: n(sql`SUM(CASE WHEN ${E().irpfTotal} > 0 AND NOT ${isRent} THEN ${E().irpfTotal} ELSE 0 END)`),
      base115: n(sql`SUM(CASE WHEN ${E().irpfTotal} > 0 AND ${isRent} THEN ${E().taxBase} ELSE 0 END)`),
      irpf115: n(sql`SUM(CASE WHEN ${E().irpfTotal} > 0 AND ${isRent} THEN ${E().irpfTotal} ELSE 0 END)`),
      expenseCount: n(sql`COUNT(*)`),
    }).from(E()).leftJoin(cat, eq(cat.id, E().categoryId)).where(expensesIn(companyId, from, to)).groupBy(ym(E().issueDate)),
  ])
  const map = new Map<string, ReportMetrics>()
  const get = (m: string) => {
    if (!map.has(m)) map.set(m, emptyMetrics())
    return map.get(m)!
  }
  for (const r of sales) Object.assign(get(r.month), { income: r.income, vatCharged: r.vatCharged, surchargeCharged: r.surchargeCharged, irpfWithheld: r.irpfWithheld, invoices: r.invoices, rectifying: r.rectifying })
  for (const r of exps) Object.assign(get(r.month), { expenses: r.expenses, deductibleExpenses: r.deductibleExpenses, vatSupported: r.vatSupported, vatDeductible: r.vatDeductible, base111: r.base111, irpf111: r.irpf111, base115: r.base115, irpf115: r.irpf115, expenseCount: r.expenseCount })
  return map
}

/** Suma de los meses entre dos fechas (ambas dentro de meses completos o recortadas aparte) */
function sumMonths(map: Map<string, ReportMetrics>, from: string, to: string) {
  let acc = emptyMetrics()
  for (const [m, v] of map) if (m >= from.slice(0, 7) && m <= to.slice(0, 7)) acc = addMetrics(acc, v)
  return acc
}

async function metricsBetween(companyId: number, from: string, to: string) {
  return sumMonths(await monthlyMetrics(companyId, from, to), from, to)
}

export interface VatGroup {
  rate: number
  surchargeRate: number
  base: number
  vat: number
  surcharge: number
}

/**
 * IVA repercutido por factura y tipo. Igual que el cálculo de la factura (cuota por tipo sobre la
 * suma de bases); si la factura tiene un único tipo se usa su cuota guardada (importadas).
 */
async function salesVatGroups(companyId: number, from: string, to: string) {
  const l = tables.salesDocumentLines
  const rows = await useDb().select({
    docId: l.documentId,
    vatRate: l.vatRate,
    surchargeRate: l.surchargeRate,
    base: sql<number>`SUM(${l.base})`.mapWith(Number),
    vatTotal: S().vatTotal,
    surchargeTotal: S().surchargeTotal,
  }).from(l).innerJoin(S(), eq(S().id, l.documentId))
    .where(salesIn(companyId, from, to))
    .groupBy(l.documentId, l.vatRate, l.surchargeRate, S().vatTotal, S().surchargeTotal)
  const byDoc = new Map<number, Array<VatGroup & { vatTotal: number, surchargeTotal: number }>>()
  for (const r of rows) {
    const base = round2(r.base)
    const g = { rate: r.vatRate, surchargeRate: r.surchargeRate, base, vat: pctOf(base, r.vatRate), surcharge: pctOf(base, r.surchargeRate), vatTotal: r.vatTotal, surchargeTotal: r.surchargeTotal }
    byDoc.set(r.docId, [...(byDoc.get(r.docId) ?? []), g])
  }
  const out = new Map<number, VatGroup[]>()
  for (const [id, groups] of byDoc) {
    if (groups.length === 1) {
      groups[0]!.vat = groups[0]!.vatTotal
      groups[0]!.surcharge = groups[0]!.surchargeTotal
    }
    out.set(id, groups.map(({ vatTotal: _v, surchargeTotal: _s, ...g }) => g).sort((a, b) => b.rate - a.rate))
  }
  return out
}

function groupByRate(groups: VatGroup[]) {
  const map = new Map<string, VatGroup>()
  for (const g of groups) {
    const key = `${g.rate}|${g.surchargeRate}`
    const acc = map.get(key) ?? { rate: g.rate, surchargeRate: g.surchargeRate, base: 0, vat: 0, surcharge: 0 }
    acc.base = round2(acc.base + g.base)
    acc.vat = round2(acc.vat + g.vat)
    acc.surcharge = round2(acc.surcharge + g.surcharge)
    map.set(key, acc)
  }
  return [...map.values()].sort((a, b) => b.rate - a.rate)
}

/** IVA soportado por tipo (desglose de cada gasto) y su parte deducible */
async function supportedVatByRate(companyId: number, from: string, to: string) {
  const t = tables.expenseTaxLines
  const rows = await useDb().select({
    rate: t.vatRate,
    base: sql<number>`COALESCE(SUM(${t.base}), 0)`.mapWith(Number),
    vat: sql<number>`COALESCE(SUM(${t.vatAmount}), 0)`.mapWith(Number),
    deductible: sql<number>`COALESCE(SUM(${t.vatAmount} * ${E().vatDeductiblePct} / 100), 0)`.mapWith(Number),
    surcharge: sql<number>`COALESCE(SUM(${t.surchargeAmount}), 0)`.mapWith(Number),
  }).from(t).innerJoin(E(), eq(E().id, t.expenseId))
    .where(expensesIn(companyId, from, to))
    .groupBy(t.vatRate)
    .orderBy(desc(t.vatRate))
  return rows.map(r => ({ rate: r.rate, base: round2(r.base), vat: round2(r.vat), deductible: round2(r.deductible), surcharge: round2(r.surcharge) }))
}

async function topClientsReport(companyId: number, from: string, to: string, limit = 8) {
  const c = tables.contacts
  const name = sql<string>`COALESCE(${c.name}, JSON_UNQUOTE(JSON_EXTRACT(${S().customer}, '$.name')), 'Sin cliente')`
  const rows = await useDb().select({
    id: S().contactId,
    name,
    amount: sql<number>`SUM(${S().taxBase})`.mapWith(Number),
    total: sql<number>`SUM(${S().total})`.mapWith(Number),
    count: sql<number>`COUNT(*)`.mapWith(Number),
  }).from(S()).leftJoin(c, eq(c.id, S().contactId))
    .where(salesIn(companyId, from, to))
    .groupBy(S().contactId, name)
    .orderBy(desc(sql`SUM(${S().taxBase})`))
    .limit(limit)
  return rows.map(r => ({ ...r, amount: round2(r.amount), total: round2(r.total) }))
}

async function topSuppliersReport(companyId: number, from: string, to: string, limit = 8) {
  const c = tables.contacts
  const name = sql<string>`COALESCE(${c.name}, JSON_UNQUOTE(JSON_EXTRACT(${E().supplier}, '$.name')), 'Sin proveedor')`
  const rows = await useDb().select({
    id: E().supplierId,
    name,
    amount: sql<number>`SUM(${E().taxBase})`.mapWith(Number),
    total: sql<number>`SUM(${E().total})`.mapWith(Number),
    count: sql<number>`COUNT(*)`.mapWith(Number),
  }).from(E()).leftJoin(c, eq(c.id, E().supplierId))
    .where(expensesIn(companyId, from, to))
    .groupBy(E().supplierId, name)
    .orderBy(desc(sql`SUM(${E().taxBase})`))
    .limit(limit)
  return rows.map(r => ({ ...r, amount: round2(r.amount), total: round2(r.total) }))
}

/** Clientes distintos, perceptores de retenciones y días medios de cobro del periodo */
async function periodCounters(companyId: number, from: string, to: string) {
  const db = useDb()
  const cat = tables.categories
  const p = tables.payments
  const isRent = sql`COALESCE(${cat.accountCode} = '621', 0)`
  // Días de cobro: de la fecha de la factura al último cobro registrado
  const lastPay = db.select({ id: p.salesDocumentId, day: sql<string>`MAX(${p.date})`.as('last_day') }).from(p)
    .where(and(eq(p.companyId, companyId), eq(p.direction, 'in'))).groupBy(p.salesDocumentId).as('last_pay')
  const [[clients], [w], [dso]] = await Promise.all([
    db.select({ n: sql<number>`COUNT(DISTINCT ${S().contactId})`.mapWith(Number) }).from(S()).where(salesIn(companyId, from, to)),
    db.select({
      r111: sql<number>`COUNT(DISTINCT CASE WHEN ${E().irpfTotal} > 0 AND NOT ${isRent} THEN ${E().supplierId} END)`.mapWith(Number),
      r115: sql<number>`COUNT(DISTINCT CASE WHEN ${E().irpfTotal} > 0 AND ${isRent} THEN ${E().supplierId} END)`.mapWith(Number),
    }).from(E()).leftJoin(cat, eq(cat.id, E().categoryId)).where(expensesIn(companyId, from, to)),
    db.select({
      days: sql<number | null>`AVG(DATEDIFF(${lastPay.day}, ${S().issueDate}))`.mapWith(v => (v == null ? null : Number(v))),
    }).from(S()).innerJoin(lastPay, eq(lastPay.id, S().id))
      .where(and(salesIn(companyId, from, to), eq(S().status, 'paid'), eq(S().kind, 'invoice'))),
  ])
  return {
    clients: clients?.n ?? 0,
    recipients111: w?.r111 ?? 0,
    recipients115: w?.r115 ?? 0,
    avgCollectionDays: dso?.days == null ? null : Math.max(0, Math.round(dso.days)),
  }
}

/** Antigüedad de lo pendiente de cobro hoy (no depende del periodo) */
async function receivablesAging(companyId: number, today: string) {
  const rows = await useDb().select({
    dueDate: S().dueDate,
    issueDate: S().issueDate,
    pending: sql<number>`${S().total} - ${S().paidTotal}`.mapWith(Number),
  }).from(S()).where(and(
    eq(S().companyId, companyId),
    inArray(S().kind, ['invoice', 'rectifying']),
    inArray(S().status, [...OPEN_STATUSES]),
  ))
  const buckets = [
    { key: 'current', label: 'Sin vencer', amount: 0, count: 0 },
    { key: 'd30', label: '1 – 30 días', amount: 0, count: 0 },
    { key: 'd60', label: '31 – 60 días', amount: 0, count: 0 },
    { key: 'd90', label: '61 – 90 días', amount: 0, count: 0 },
    { key: 'd90p', label: 'Más de 90 días', amount: 0, count: 0 },
  ]
  const t = new Date(`${today}T12:00:00`).getTime()
  for (const r of rows) {
    if (Math.abs(r.pending) < 0.005) continue
    const due = r.dueDate ?? r.issueDate
    const late = Math.round((t - new Date(`${due}T12:00:00`).getTime()) / 86_400_000)
    const b = late <= 0 ? buckets[0]! : late <= 30 ? buckets[1]! : late <= 60 ? buckets[2]! : late <= 90 ? buckets[3]! : buckets[4]!
    b.amount = round2(b.amount + r.pending)
    b.count++
  }
  const total = round2(buckets.reduce((s, b) => s + b.amount, 0))
  const overdue = round2(total - buckets[0]!.amount)
  return { total, overdue, count: buckets.reduce((s, b) => s + b.count, 0), buckets }
}

// ─── Informe ─────────────────────────────────────────────────────────────────

export interface ReportColumn {
  key: string
  label: string
  from: string
  to: string
  future: boolean
  metrics: ReportMetrics
  profit: number
  vatResult: number
  m130: number | null
  /** Sociedades: impuesto estimado del periodo (tipo efectivo del año sobre su resultado) */
  corporateTax: number | null
}

/** Pagos fraccionados del 130 trimestre a trimestre (acumulado del año, menos lo ya ingresado) */
function model130ByQuarter(months: Map<string, ReportMetrics>, year: number) {
  const out: number[] = []
  let paid = 0
  for (const q of [1, 2, 3, 4] as Quarter[]) {
    const acc = sumMonths(months, `${year}-01-01`, quarterRange(year, q).to)
    const net = round2(acc.income - acc.deductibleExpenses)
    const result = Math.max(0, round2(Math.max(0, net) * 0.2 - acc.irpfWithheld - paid))
    out.push(result)
    paid = round2(paid + result)
  }
  return out
}

const pnl = (m: ReportMetrics) => ({
  income: m.income,
  expenses: m.expenses,
  deductibleExpenses: m.deductibleExpenses,
  profit: round2(m.income - m.expenses),
  netIncome: round2(m.income - m.deductibleExpenses),
  margin: m.income ? round2((m.income - m.expenses) / m.income * 100) : null,
  invoices: m.invoices,
  avgTicket: m.invoices ? round2(m.income / m.invoices) : null,
  vatResult: round2(m.vatCharged + m.surchargeCharged - m.vatDeductible),
})

export async function buildReport(company: Company, period: ReportPeriod) {
  const today = toISODate(new Date())
  const { previous, lastYear } = comparisons(period)
  const prevRange = matchElapsed(period, previous, today)
  const lastRange = lastYear ? matchElapsed(period, lastYear, today) : null
  const partial = today >= period.from && today <= period.to

  const yearFrom = `${period.year}-01-01`
  const yearTo = `${period.year}-12-31`
  const [yearMonths, prevM, lastM, vatGroups, supported, clients, suppliers, categories, counters, aging, pay] = await Promise.all([
    monthlyMetrics(company.id, yearFrom, yearTo),
    metricsBetween(company.id, prevRange.from, prevRange.to),
    lastRange ? metricsBetween(company.id, lastRange.from, lastRange.to) : Promise.resolve(null),
    salesVatGroups(company.id, period.from, period.to),
    supportedVatByRate(company.id, period.from, period.to),
    topClientsReport(company.id, period.from, period.to),
    topSuppliersReport(company.id, period.from, period.to),
    expensesByCategory(company.id, period.from, period.to),
    periodCounters(company.id, period.from, period.to),
    receivablesAging(company.id, today),
    payables(company.id),
  ])

  const current = sumMonths(yearMonths, period.from, period.to)
  const applies130 = company.kind === 'autonomo' && company.taxRegime !== 'modulos'
  const m130 = applies130 ? model130ByQuarter(yearMonths, period.year) : null

  // Sociedades: el impuesto del año se reparte por periodos con su tipo efectivo (tramos y bases negativas incluidos)
  const corporate = company.kind === 'sociedad' ? await corporateEstimate(company, period.year) : null
  const corporateRate = corporate && corporate.result > 0 ? corporate.quota / corporate.result : 0
  const corporateTax = (m: ReportMetrics) => (corporate ? round2(Math.max(0, m.income - m.deductibleExpenses) * corporateRate) : null)

  // Columnas: trimestres de un año o meses de un trimestre
  const columns: ReportColumn[] = []
  const column = (key: string, label: string, from: string, to: string, q: Quarter | null): ReportColumn => {
    const m = sumMonths(yearMonths, from, to)
    return { key, label, from, to, future: from > today, metrics: m, profit: round2(m.income - m.expenses), vatResult: round2(m.vatCharged + m.surchargeCharged - m.vatDeductible), m130: m130 && q ? m130[q - 1]! : null, corporateTax: corporateTax(m) }
  }
  if (period.granularity === 'year') {
    for (const q of [1, 2, 3, 4] as Quarter[]) {
      const r = quarterRange(period.year, q)
      columns.push(column(`${q}T`, `${q}T`, r.from, r.to, q))
    }
  }
  else if (period.granularity === 'quarter') {
    const start = (period.quarter! - 1) * 3 + 1
    for (let m = start; m < start + 3; m++) {
      columns.push(column(`${period.year}-${pad2(m)}`, MONTH_NAMES[m - 1]!.slice(0, 3), `${period.year}-${pad2(m)}-01`, lastDay(period.year, m), null))
    }
  }

  // Evolución mensual del año (hasta el mes en curso si es el año actual)
  const lastMonth = period.year === Number(today.slice(0, 4)) ? Number(today.slice(5, 7)) : 12
  const monthly = Array.from({ length: lastMonth }, (_, i) => {
    const key = `${period.year}-${pad2(i + 1)}`
    const m = yearMonths.get(key) ?? emptyMetrics()
    return { month: key, income: m.income, expenses: m.expenses, profit: round2(m.income - m.expenses) }
  })

  const charged = groupByRate([...vatGroups.values()].flat())
  const vatDeductible = current.vatDeductible
  const vatCharged = round2(current.vatCharged + current.surchargeCharged)
  // El desglose por tipo redondea cada fila: el céntimo de diferencia va a la fila mayor y cuadra con el total
  const gap = round2(vatDeductible - supported.reduce((s, g) => s + g.deductible, 0))
  const biggest = [...supported].sort((a, b) => b.deductible - a.deductible)[0]
  if (biggest && gap && Math.abs(gap) <= 0.05) biggest.deductible = round2(biggest.deductible + gap)

  return {
    company: { name: company.tradeName || company.legalName, legalName: company.legalName, nif: company.nif, kind: company.kind, applies130 },
    period: { ...period, partial, today },
    compare: {
      previous: { ...prevRange, ...pnl(prevM) },
      lastYear: lastRange && lastM ? { ...lastRange, ...pnl(lastM) } : null,
    },
    pnl: pnl(current),
    metrics: current,
    columns,
    monthly,
    vat: {
      charged,
      supported,
      totals: {
        charged: vatCharged,
        supported: current.vatSupported,
        deductible: vatDeductible,
        nonDeductible: round2(current.vatSupported - vatDeductible),
        result: round2(vatCharged - vatDeductible),
      },
    },
    irpf: {
      withheld: { base: current.income, amount: current.irpfWithheld },
      m111: { base: current.base111, amount: current.irpf111, recipients: counters.recipients111 },
      m115: { base: current.base115, amount: current.irpf115, recipients: counters.recipients115 },
      m130: m130 && period.granularity !== 'month'
        ? (period.granularity === 'quarter' ? m130[period.quarter! - 1]! : round2(m130.reduce((s, x) => s + x, 0)))
        : null,
    },
    corporate: corporate
      ? {
          tax: corporateTax(current)!,
          afterTax: round2(current.income - current.expenses - corporateTax(current)!),
          effectiveRate: round2(corporateRate * 100),
          brackets: corporate.brackets,
          size: corporate.size,
          newEntity: corporate.settings.newEntity,
          patrimonial: corporate.settings.patrimonial,
          /** Año completo: cuota estimada, pagos fraccionados y lo que quedaría en el 200 */
          year: { quota: corporate.quota, paid: corporate.paid, due: corporate.due, partial: corporate.partial },
        }
      : null,
    topClients: clients,
    topSuppliers: suppliers,
    expensesByCategory: categories,
    counters: { ...counters, expenses: current.expenseCount, invoices: current.invoices, rectifying: current.rectifying },
    receivables: aging,
    payables: pay,
  }
}

export type Report = Awaited<ReturnType<typeof buildReport>>

// ─── Libros registro ─────────────────────────────────────────────────────────

export interface IssuedBookRow {
  id: number
  kind: string
  number: string | null
  date: string
  name: string
  nif: string | null
  base: number
  vat: number
  surcharge: number
  irpf: number
  total: number
  imported: boolean
  status: string
  rates: VatGroup[]
}

/** Libro registro de facturas emitidas del periodo */
export async function issuedBook(companyId: number, from: string, to: string): Promise<IssuedBookRow[]> {
  const c = tables.contacts
  const [docs, groups] = await Promise.all([
    useDb().select({
      id: S().id, kind: S().kind, status: S().status, number: S().number, date: S().issueDate, imported: S().imported,
      customer: S().customer, contactName: c.name, contactNif: c.nif,
      base: S().taxBase, vat: S().vatTotal, surcharge: S().surchargeTotal, irpf: S().irpfTotal, total: S().total,
    }).from(S()).leftJoin(c, eq(c.id, S().contactId))
      .where(salesIn(companyId, from, to))
      .orderBy(S().issueDate, S().number, S().id),
    salesVatGroups(companyId, from, to),
  ])
  return docs.map(d => ({
    id: d.id,
    kind: d.kind,
    number: d.number,
    date: d.date,
    name: d.customer?.name ?? d.contactName ?? 'Sin cliente',
    nif: d.customer?.nif ?? d.contactNif ?? null,
    base: d.base,
    vat: d.vat,
    surcharge: d.surcharge,
    irpf: d.irpf,
    total: d.total,
    imported: d.imported,
    status: d.status,
    rates: groups.get(d.id) ?? [{ rate: 0, surchargeRate: 0, base: d.base, vat: d.vat, surcharge: d.surcharge }],
  }))
}

export interface ReceivedBookRow {
  id: number
  kind: string
  number: string | null
  date: string
  name: string
  nif: string | null
  category: string | null
  base: number
  vat: number
  vatDeductible: number
  surcharge: number
  irpf: number
  total: number
  rates: Array<{ rate: number, base: number, vat: number, surcharge: number }>
}

/** Libro registro de facturas recibidas (y demás gastos) del periodo */
export async function receivedBook(companyId: number, from: string, to: string): Promise<ReceivedBookRow[]> {
  const c = tables.contacts
  const cat = tables.categories
  const t = tables.expenseTaxLines
  const rows = await useDb().select({
    id: E().id, kind: E().kind, number: E().number, date: E().issueDate,
    supplier: E().supplier, contactName: c.name, contactNif: c.nif, category: cat.name,
    base: E().taxBase, vat: E().vatTotal, vatDeductiblePct: E().vatDeductiblePct, surcharge: E().surchargeTotal, irpf: E().irpfTotal, total: E().total,
  }).from(E()).leftJoin(c, eq(c.id, E().supplierId)).leftJoin(cat, eq(cat.id, E().categoryId))
    .where(expensesIn(companyId, from, to))
    .orderBy(E().issueDate, E().id)
  const ids = rows.map(r => r.id)
  const lines = ids.length
    ? await useDb().select({ expenseId: t.expenseId, rate: t.vatRate, base: t.base, vat: t.vatAmount, surcharge: t.surchargeAmount }).from(t).where(inArray(t.expenseId, ids))
    : []
  const byExpense = new Map<number, ReceivedBookRow['rates']>()
  for (const l of lines) byExpense.set(l.expenseId, [...(byExpense.get(l.expenseId) ?? []), { rate: l.rate, base: l.base, vat: l.vat, surcharge: l.surcharge }])
  return rows.map(r => ({
    id: r.id,
    kind: r.kind,
    number: r.number,
    date: r.date,
    name: r.contactName ?? r.supplier?.name ?? 'Sin proveedor',
    nif: r.contactNif ?? r.supplier?.nif ?? null,
    category: r.category,
    base: r.base,
    vat: r.vat,
    vatDeductible: round2(r.vat * r.vatDeductiblePct / 100),
    surcharge: r.surcharge,
    irpf: r.irpf,
    total: r.total,
    rates: (byExpense.get(r.id) ?? [{ rate: 0, base: r.base, vat: r.vat, surcharge: r.surcharge }]).sort((a, b) => b.rate - a.rate),
  }))
}

// ─── Exportación: Excel, CSV y PDF ───────────────────────────────────────────

const isoToEs = (iso: string | null | undefined) => (iso ? iso.split('-').reverse().join('/') : '')

/** Nombre de archivo de una exportación: Informe-2024-3T.xlsx, Libro-emitidas-2024-3T.csv… */
export function reportFilename(kind: 'report' | 'issued' | 'received' | 'summary', period: ReportPeriod, ext: string) {
  const base = kind === 'issued' ? 'Libro-emitidas' : kind === 'received' ? 'Libro-recibidas' : kind === 'summary' ? 'Resumen' : 'Informe'
  return `${base}-${period.slug}.${ext}`
}

type XCell = string | number | null | { t: 'n', v: number, z: string } | { t: 's', v: string }

const EUR_FORMAT = '#,##0.00 "€";-#,##0.00 "€"'
const xMoney = (v: number | null | undefined): XCell => (v == null ? null : { t: 'n', v: round2(v), z: EUR_FORMAT })
const xPct = (v: number | null | undefined): XCell => (v == null ? null : { t: 'n', v: round2(v) / 100, z: '0.0%' })

/** Fecha como número de serie de Excel, sin zonas horarias de por medio */
function xDate(iso: string): XCell {
  const [y, m, d] = iso.split('-').map(Number)
  return { t: 'n', v: (Date.UTC(y!, m! - 1, d!) - Date.UTC(1899, 11, 30)) / 86_400_000, z: 'dd/mm/yyyy' }
}

function sheet(rows: XCell[][], widths: number[], filterCols?: number) {
  const ws = XLSX.utils.aoa_to_sheet(rows as unknown[][])
  ws['!cols'] = widths.map(wch => ({ wch }))
  if (filterCols) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 2, 0), c: filterCols - 1 } }) }
  return ws
}

function summaryRows(r: Report): XCell[][] {
  const cols = r.columns
  const head: XCell[] = ['Cuenta de resultados', ...cols.map(c => c.label), 'Total']
  const line = (label: string, pick: (m: ReportMetrics, c?: ReportColumn) => number | null, total: number | null, kind: 'money' | 'pct' = 'money'): XCell[] => {
    const f = kind === 'pct' ? xPct : xMoney
    return [label, ...cols.map(c => f(pick(c.metrics, c))), f(total)]
  }
  const margin = (m: ReportMetrics) => (m.income ? (m.income - m.expenses) / m.income * 100 : null)
  const rows: XCell[][] = [
    [r.company.legalName],
    [`Informe de gestión · ${r.period.label}`, `NIF ${r.company.nif}`],
    [`Del ${isoToEs(r.period.from)} al ${isoToEs(r.period.to)}`, `Generado el ${isoToEs(r.period.today)}`],
    [],
    head,
    line('Ingresos (base imponible)', m => m.income, r.pnl.income),
    line('Gastos (base imponible)', m => m.expenses, r.pnl.expenses),
    line('Gastos deducibles', m => m.deductibleExpenses, r.pnl.deductibleExpenses),
    line('Beneficio', m => round2(m.income - m.expenses), r.pnl.profit),
    line('Margen', margin, r.pnl.margin, 'pct'),
    ...(r.corporate
      ? [
          line('Impuesto sobre Sociedades (estimado)', (_m, c) => c?.corporateTax ?? null, r.corporate.tax),
          line('Beneficio después de impuestos', (m, c) => round2(m.income - m.expenses - (c?.corporateTax ?? 0)), r.corporate.afterTax),
        ]
      : []),
    line('IVA repercutido', m => round2(m.vatCharged + m.surchargeCharged), r.vat.totals.charged),
    line('IVA soportado deducible', m => m.vatDeductible, r.vat.totals.deductible),
    line('Resultado IVA (303)', m => round2(m.vatCharged + m.surchargeCharged - m.vatDeductible), r.vat.totals.result),
    line('Retenciones que te practican', m => m.irpfWithheld, r.irpf.withheld.amount),
    line('Retenciones a profesionales (111)', m => m.irpf111, r.irpf.m111.amount),
    line('Retenciones de alquileres (115)', m => m.irpf115, r.irpf.m115.amount),
  ]
  if (r.company.applies130 && r.period.granularity !== 'month') rows.push(line('Pago fraccionado 130 (estimado)', (_m, c) => c?.m130 ?? null, r.irpf.m130))
  rows.push(
    [],
    ['Indicadores', 'Valor'],
    ['Facturas emitidas', r.counters.invoices],
    ['Facturas rectificativas', r.counters.rectifying],
    ['Ticket medio', xMoney(r.pnl.avgTicket)],
    ['Clientes facturados', r.counters.clients],
    ['Días medios de cobro', r.counters.avgCollectionDays],
    ['Gastos registrados', r.counters.expenses],
    [],
    ['Principales clientes', 'Base imponible', '% de los ingresos', 'Facturas', 'Total con impuestos'],
    ...r.topClients.map(c => [c.name, xMoney(c.amount), xPct(r.pnl.income ? c.amount / r.pnl.income * 100 : null), c.count, xMoney(c.total)]),
    [],
    ['Principales proveedores', 'Base imponible', '% de los gastos', 'Facturas', 'Total con impuestos'],
    ...r.topSuppliers.map(c => [c.name, xMoney(c.amount), xPct(r.pnl.expenses ? c.amount / r.pnl.expenses * 100 : null), c.count, xMoney(c.total)]),
    [],
    ['Gastos por categoría', 'Base imponible', '% de los gastos', '', 'Total con impuestos'],
    ...r.expensesByCategory.map(c => [c.name, xMoney(c.amount), xPct(r.pnl.expenses ? c.amount / r.pnl.expenses * 100 : null), '', xMoney(c.total)]),
    [],
    [`Pendiente de cobro a ${isoToEs(r.period.today)}`, 'Importe', 'Facturas'],
    ...r.receivables.buckets.map(b => [b.label, xMoney(b.amount), b.count]),
    ['Total', xMoney(r.receivables.total), r.receivables.count],
  )
  return rows
}

function issuedRows(book: IssuedBookRow[]): XCell[][] {
  const rows: XCell[][] = [['Fecha', 'Número', 'Tipo', 'Cliente', 'NIF', 'Base imponible', '% IVA', 'Cuota IVA', '% Recargo', 'Cuota recargo', 'Retención IRPF', 'Total factura']]
  for (const d of book) {
    d.rates.forEach((g, i) => rows.push([
      xDate(d.date), d.number ?? '', d.kind === 'rectifying' ? 'Rectificativa' : 'Factura', d.name, d.nif ?? '',
      xMoney(g.base), g.rate, xMoney(g.vat), g.surchargeRate || null, g.surcharge ? xMoney(g.surcharge) : null,
      i === 0 ? xMoney(d.irpf) : null, i === 0 ? xMoney(d.total) : null,
    ]))
  }
  const sum = (k: 'base' | 'vat' | 'surcharge' | 'irpf' | 'total') => round2(book.reduce((s, d) => s + d[k], 0))
  rows.push(['Total', `${book.length} facturas`, '', '', '', xMoney(sum('base')), null, xMoney(sum('vat')), null, xMoney(sum('surcharge')), xMoney(sum('irpf')), xMoney(sum('total'))])
  return rows
}

function receivedRows(book: ReceivedBookRow[]): XCell[][] {
  const rows: XCell[][] = [['Fecha', 'Nº factura', 'Proveedor', 'NIF', 'Categoría', 'Base imponible', '% IVA', 'Cuota IVA', 'IVA deducible', 'Cuota recargo', 'Retención IRPF', 'Total']]
  for (const d of book) {
    const ratio = d.vat ? d.vatDeductible / d.vat : 1
    d.rates.forEach((g, i) => rows.push([
      xDate(d.date), d.number ?? '', d.name, d.nif ?? '', d.category ?? '',
      xMoney(g.base), g.rate, xMoney(g.vat), xMoney(round2(g.vat * ratio)), g.surcharge ? xMoney(g.surcharge) : null,
      i === 0 ? xMoney(d.irpf) : null, i === 0 ? xMoney(d.total) : null,
    ]))
  }
  const sum = (k: 'base' | 'vat' | 'vatDeductible' | 'surcharge' | 'irpf' | 'total') => round2(book.reduce((s, d) => s + d[k], 0))
  rows.push(['Total', `${book.length} gastos`, '', '', '', xMoney(sum('base')), null, xMoney(sum('vat')), xMoney(sum('vatDeductible')), xMoney(sum('surcharge')), xMoney(sum('irpf')), xMoney(sum('total'))])
  return rows
}

function vatRows(r: Report): XCell[][] {
  return [
    [`IVA · ${r.period.label}`],
    [],
    ['IVA repercutido', 'Base imponible', 'Cuota IVA', '% Recargo', 'Cuota recargo'],
    ...r.vat.charged.map(g => [`${g.rate} %`, xMoney(g.base), xMoney(g.vat), g.surchargeRate || null, g.surcharge ? xMoney(g.surcharge) : null]),
    ['Total repercutido', xMoney(r.vat.charged.reduce((s, g) => s + g.base, 0)), xMoney(r.vat.totals.charged)],
    [],
    ['IVA soportado', 'Base imponible', 'Cuota IVA', 'Deducible'],
    ...r.vat.supported.map(g => [`${g.rate} %`, xMoney(g.base), xMoney(g.vat), xMoney(g.deductible)]),
    ['Total soportado', xMoney(r.vat.supported.reduce((s, g) => s + g.base, 0)), xMoney(r.vat.totals.supported), xMoney(r.vat.totals.deductible)],
    [],
    ['Resultado (repercutido − deducible)', xMoney(r.vat.totals.result)],
  ]
}

/** Libro Excel con resumen, libros registro e IVA */
export function reportWorkbook(r: Report, issued: IssuedBookRow[], received: ReceivedBookRow[]): Buffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet(summaryRows(r), [38, 15, 15, 15, 15, 15]), 'Resumen')
  XLSX.utils.book_append_sheet(wb, sheet(issuedRows(issued), [11, 16, 13, 34, 12, 14, 7, 12, 9, 12, 13, 14], 12), 'Emitidas')
  XLSX.utils.book_append_sheet(wb, sheet(receivedRows(received), [11, 18, 34, 12, 22, 14, 7, 12, 13, 12, 13, 14], 12), 'Recibidas')
  XLSX.utils.book_append_sheet(wb, sheet(vatRows(r), [34, 15, 15, 11, 14]), 'IVA')
  wb.Props = { Title: `Informe ${r.period.label}`, Author: r.company.legalName, Company: r.company.legalName }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer
}

/** Valor de una celda para CSV a la española: coma decimal, fecha dd/mm/aaaa */
function csvValue(c: XCell): string {
  if (c == null) return ''
  if (typeof c === 'object') {
    if (c.t === 's') return csvValue(c.v)
    if (c.z === 'dd/mm/yyyy') {
      const d = new Date(Date.UTC(1899, 11, 30) + c.v * 86_400_000)
      return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
    }
    if (c.z === EUR_FORMAT) return c.v.toFixed(2).replace('.', ',')
    return String(c.z.includes('%') ? round2(c.v * 100) : c.v).replace('.', ',')
  }
  const s = typeof c === 'number' ? String(c).replace('.', ',') : c
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV con punto y coma y BOM: Excel en español lo abre bien a la primera */
export function reportCsv(kind: 'issued' | 'received' | 'summary', r: Report, issued: IssuedBookRow[], received: ReceivedBookRow[]) {
  const rows = kind === 'issued' ? issuedRows(issued) : kind === 'received' ? receivedRows(received) : summaryRows(r)
  return `﻿${rows.map(row => row.map(csvValue).join(';')).join('\r\n')}\r\n`
}

// PDF ─────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfNode = any

const P_INK = '#161a22'
const P_INK2 = '#454c5b'
const P_MUTED = '#7b8291'
const P_LINE = '#e3e6ec'
const P_SOFT = '#f5f6f8'
const P_GOOD = '#047857'
const P_BAD = '#c81e1e'

const pdfEurFmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })
const pEur = (n: number | null | undefined) => (n == null ? '—' : pdfEurFmt.format(n))
const pPct = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`)

function pDelta(value: number, previous: number, label: string, invert = false): PdfNode {
  if (!previous) return { text: `Sin datos en ${label}`, fontSize: 7, color: P_MUTED }
  const d = (value - previous) / Math.abs(previous)
  const good = (d >= 0) !== invert
  return { text: [{ text: `${d >= 0 ? '↑' : '↓'} ${Math.abs(Math.round(d * 100))} %`, color: good ? P_GOOD : P_BAD, font: 'InterSemi' }, { text: ` vs. ${label}`, color: P_MUTED }], fontSize: 7 }
}

function pSection(title: string, accent: string, sub?: string): PdfNode {
  return {
    margin: [0, 18, 0, 8],
    columnGap: 0,
    columns: [
      { width: 3, canvas: [{ type: 'rect', x: 0, y: 1, w: 3, h: 11, r: 1, color: accent }] },
      { width: '*', text: [{ text: title, font: 'InterSemi', fontSize: 10.5, color: P_INK }, sub ? { text: `   ${sub}`, fontSize: 7.5, color: P_MUTED } : ''], margin: [7, 0, 0, 0] },
    ],
  }
}

/** Tabla limpia: cabecera gris, filas con línea fina y fila de totales opcional */
function pTable(head: string[], body: PdfNode[][], widths: Array<number | string>, opts: { right?: number[], totals?: PdfNode[], fontSize?: number, pad?: number } = {}): PdfNode {
  const pad = opts.pad ?? 6
  const right = new Set(opts.right ?? [])
  const fs = opts.fontSize ?? 8
  const cell = (v: PdfNode, i: number, extra: Record<string, unknown> = {}) => (typeof v === 'object' && v !== null && !Array.isArray(v)
    ? { alignment: right.has(i) ? 'right' : 'left', ...v, ...extra }
    : { text: v ?? '', alignment: right.has(i) ? 'right' : 'left', ...extra })
  const rows = [
    head.map((h, i) => cell({ text: h.toUpperCase(), font: 'InterSemi', fontSize: 6.5, color: P_MUTED, characterSpacing: 0.4 }, i)),
    ...body.map(r => r.map((v, i) => cell(v, i, { fontSize: fs }))),
    ...(opts.totals ? [opts.totals.map((v, i) => cell(v, i, { fontSize: fs, font: 'InterSemi', fillColor: P_SOFT }))] : []),
  ]
  return {
    table: { headerRows: 1, dontBreakRows: true, widths, body: rows },
    layout: {
      hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === node.table.body.length ? 0 : i === 1 ? 0.8 : 0.4),
      vLineWidth: () => 0,
      hLineColor: (i: number) => (i === 1 ? P_INK2 : P_LINE),
      paddingTop: () => 4,
      paddingBottom: () => 4,
      paddingLeft: (i: number) => (i === 0 ? 2 : pad),
      paddingRight: (i: number, node: { table: { widths: unknown[] } }) => (i === node.table.widths.length - 1 ? 2 : pad),
    },
  }
}

function pKpis(r: Report): PdfNode {
  const prev = r.compare.previous
  const items = [
    { label: 'Ingresos', value: r.pnl.income, delta: pDelta(r.pnl.income, prev.income, prev.label) },
    { label: 'Gastos', value: r.pnl.expenses, delta: pDelta(r.pnl.expenses, prev.expenses, prev.label, true) },
    { label: 'Beneficio', value: r.pnl.profit, delta: pDelta(r.pnl.profit, prev.profit, prev.label) },
    { label: 'Resultado IVA', value: r.vat.totals.result, delta: { text: r.vat.totals.result >= 0 ? 'A ingresar (303)' : 'A compensar o devolver', fontSize: 7, color: P_MUTED } },
  ]
  return {
    table: {
      widths: ['*', '*', '*', '*'],
      body: [items.map(k => ({
        stack: [
          { text: k.label.toUpperCase(), font: 'InterSemi', fontSize: 6.5, color: P_MUTED, characterSpacing: 0.5 },
          { text: pEur(k.value), font: 'InterSemi', fontSize: 14, color: k.value < 0 ? P_BAD : P_INK, margin: [0, 4, 0, 3] },
          k.delta,
        ],
      }))],
    },
    layout: {
      fillColor: () => P_SOFT,
      hLineWidth: () => 0,
      vLineWidth: (i: number) => (i === 0 || i === 4 ? 0 : 5),
      vLineColor: () => '#ffffff',
      paddingLeft: () => 10,
      paddingRight: () => 10,
      paddingTop: () => 9,
      paddingBottom: () => 9,
    },
  }
}

function pPnl(r: Report): PdfNode {
  const cols = r.columns
  const head = ['Concepto', ...cols.map(c => c.label), 'Total']
  const right = head.map((_, i) => i).filter(i => i > 0)
  const row = (label: string, pick: (c: ReportColumn) => number | null, total: number | null, fmt: (n: number | null) => string = pEur, strong = false): PdfNode[] =>
    [{ text: label, font: strong ? 'InterSemi' : 'Inter' }, ...cols.map(c => ({ text: c.future ? '—' : fmt(pick(c)), color: c.future ? P_MUTED : undefined })), { text: fmt(total), font: 'InterSemi' }]
  const margin = (c: ReportColumn) => (c.metrics.income ? round2(c.profit / c.metrics.income * 100) : null)
  const body = [
    row('Ingresos (base imponible)', c => c.metrics.income, r.pnl.income),
    row('Gastos (base imponible)', c => c.metrics.expenses, r.pnl.expenses),
    row('   de ellos, deducibles', c => c.metrics.deductibleExpenses, r.pnl.deductibleExpenses),
    row('Beneficio', c => c.profit, r.pnl.profit, pEur, true),
    row('Margen', margin, r.pnl.margin, pPct),
    ...(r.corporate
      ? [
          row('Impuesto sobre Sociedades (est.)', c => c.corporateTax, r.corporate.tax),
          row('Beneficio después de impuestos', c => round2(c.profit - (c.corporateTax ?? 0)), r.corporate.afterTax, pEur, true),
        ]
      : []),
    row('IVA a ingresar (303)', c => c.vatResult, r.vat.totals.result),
  ]
  if (r.company.applies130 && r.period.granularity !== 'month') body.push(row('Pago fraccionado 130', c => c.m130, r.irpf.m130))
  const widths = cols.length ? ['*', ...cols.map(() => 62), 70] : ['*', 90]
  return pTable(head, body, widths, { right })
}

function pVat(r: Report, accent: string): PdfNode[] {
  const charged = pTable(['Tipo', 'Base', 'Cuota'], r.vat.charged.map(g => [`${g.rate} %${g.surchargeRate ? ` + RE ${g.surchargeRate} %` : ''}`, pEur(g.base), pEur(round2(g.vat + g.surcharge))]), ['*', 70, 62], {
    right: [1, 2],
    totals: ['Total', pEur(round2(r.vat.charged.reduce((s, g) => s + g.base, 0))), pEur(r.vat.totals.charged)],
  })
  const supported = pTable(['Tipo', 'Base', 'Cuota', 'Deducible'], r.vat.supported.map(g => [`${g.rate} %`, pEur(g.base), pEur(g.vat), pEur(g.deductible)]), ['*', 62, 54, 58], {
    right: [1, 2, 3],
    totals: ['Total', pEur(round2(r.vat.supported.reduce((s, g) => s + g.base, 0))), pEur(r.vat.totals.supported), pEur(r.vat.totals.deductible)],
  })
  const res = r.vat.totals.result
  return [{ unbreakable: true, stack: [
    pSection('IVA', accent, 'Repercutido en tus facturas y soportado en tus gastos'),
    {
      columns: [
        { width: '*', stack: [{ text: 'Repercutido', font: 'InterSemi', fontSize: 8, color: P_INK2, margin: [0, 0, 0, 4] }, r.vat.charged.length ? charged : { text: 'Sin facturas emitidas', fontSize: 8, color: P_MUTED }] },
        { width: '*', stack: [{ text: 'Soportado', font: 'InterSemi', fontSize: 8, color: P_INK2, margin: [0, 0, 0, 4] }, r.vat.supported.length ? supported : { text: 'Sin gastos', fontSize: 8, color: P_MUTED }] },
      ],
      columnGap: 24,
    },
    {
      margin: [0, 10, 0, 0],
      table: { widths: ['*', 'auto'], body: [[{ text: res >= 0 ? 'Resultado: a ingresar' : 'Resultado: a compensar o devolver', font: 'InterSemi', fontSize: 9 }, { text: pEur(Math.abs(res)), font: 'InterSemi', fontSize: 11, alignment: 'right', color: res >= 0 ? P_INK : P_GOOD }]] },
      layout: { fillColor: () => tint(accent, 0.92), hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 10, paddingRight: () => 10, paddingTop: () => 7, paddingBottom: () => 7 },
    },
  ] }]
}

const perceptors = (n: number) => (n ? ` (${n} perceptor${n === 1 ? '' : 'es'})` : '')

function pIrpf(r: Report, accent: string): PdfNode[] {
  const body: PdfNode[][] = [
    ['Retenciones que te practican tus clientes', pEur(r.irpf.withheld.base), pEur(r.irpf.withheld.amount)],
    [`Retenciones a profesionales · modelo 111${perceptors(r.irpf.m111.recipients)}`, pEur(r.irpf.m111.base), pEur(r.irpf.m111.amount)],
    [`Retenciones de alquileres · modelo 115${perceptors(r.irpf.m115.recipients)}`, pEur(r.irpf.m115.base), pEur(r.irpf.m115.amount)],
  ]
  if (r.irpf.m130 != null) body.push(['Pago fraccionado del IRPF · modelo 130 (estimado)', '', pEur(r.irpf.m130)])
  if (r.corporate) {
    body.push(
      [`Impuesto sobre Sociedades del periodo (estimado, tipo efectivo ${pPct(r.corporate.effectiveRate)})`, pEur(Math.max(0, r.pnl.netIncome)), pEur(r.corporate.tax)],
      [`Pagos fraccionados · modelo 202 (${r.period.year}${r.corporate.year.partial ? ', estimados' : ''})`, '', pEur(r.corporate.year.paid)],
    )
  }
  return [{ unbreakable: true, stack: [pSection(r.corporate ? 'Retenciones e impuestos' : 'Retenciones e IRPF', accent), pTable(['Concepto', 'Base', 'Importe'], body, ['*', 80, 80], { right: [1, 2] })] }]
}

function pRankings(r: Report, accent: string): PdfNode[] {
  const clients = r.topClients.length
    ? pTable(['Cliente', 'Base', '%', 'Total'], r.topClients.map(c => [c.name, pEur(c.amount), pPct(r.pnl.income ? round2(c.amount / r.pnl.income * 100) : null), pEur(c.total)]), ['*', 58, 30, 58], { right: [1, 2, 3], fontSize: 7.5 })
    : { text: 'Sin facturas en el periodo', fontSize: 8, color: P_MUTED }
  const cats = r.expensesByCategory.length
    ? pTable(['Categoría', 'Base', '%', 'Total'], r.expensesByCategory.slice(0, 10).map(c => [c.name, pEur(c.amount), pPct(r.pnl.expenses ? round2(c.amount / r.pnl.expenses * 100) : null), pEur(c.total)]), ['*', 58, 30, 58], { right: [1, 2, 3], fontSize: 7.5 })
    : { text: 'Sin gastos en el periodo', fontSize: 8, color: P_MUTED }
  return [{
    unbreakable: true,
    columns: [
      { width: '*', stack: [pSection('Principales clientes', accent), clients] },
      { width: '*', stack: [pSection('Gastos por categoría', accent), cats] },
    ],
    columnGap: 24,
  }]
}

function pReceivables(r: Report, accent: string): PdfNode[] {
  const a = r.receivables
  return [{ unbreakable: true, stack: [
    pSection('Pendiente de cobro', accent, `a ${isoToEs(r.period.today)}`),
    pTable(a.buckets.map(b => b.label), [a.buckets.map(b => ({ text: [{ text: pEur(b.amount), font: 'InterSemi' }, { text: `\n${b.count} factura${b.count === 1 ? '' : 's'}`, fontSize: 6.8, color: P_MUTED }] }))], a.buckets.map(() => '*'), {
      right: a.buckets.map((_, i) => i),
    }),
  ] }]
}

function pIssuedBook(book: IssuedBookRow[], accent: string, label: string): PdfNode[] {
  const sum = (k: 'base' | 'vat' | 'surcharge' | 'irpf' | 'total') => round2(book.reduce((s, d) => s + d[k], 0))
  return [
    { ...pSection('Libro de facturas emitidas', accent, `${label} · ${book.length} facturas`), pageBreak: 'before' },
    book.length
      ? pTable(
          ['Fecha', 'Número', 'Cliente', 'NIF', 'Base', 'IVA', 'IRPF', 'Total'],
          book.map(d => [
            isoToEs(d.date),
            { text: d.number ?? '—', noWrap: false },
            { text: d.name || 'Sin cliente', noWrap: false },
            d.nif ?? '—',
            pEur(d.base),
            pEur(round2(d.vat + d.surcharge)),
            d.irpf ? pEur(-d.irpf) : '—',
            pEur(d.total),
          ]),
          [38, 52, '*', 45, 56, 46, 40, 58],
          {
            right: [4, 5, 6, 7],
            fontSize: 6.8,
            pad: 2.5,
            totals: [
              'Total',
              '',
              '',
              '',
              pEur(sum('base')),
              pEur(round2(sum('vat') + sum('surcharge'))),
              pEur(-sum('irpf')),
              pEur(sum('total')),
            ],
          },
        )
      : { text: 'No hay facturas emitidas en el periodo.', fontSize: 8, color: P_MUTED },
  ]
}

function pReceivedBook(book: ReceivedBookRow[], accent: string, label: string): PdfNode[] {
  const sum = (k: 'base' | 'vat' | 'vatDeductible' | 'irpf' | 'total') => round2(book.reduce((s, d) => s + d[k], 0))
  return [
    { ...pSection('Libro de facturas recibidas', accent, `${label} · ${book.length} gastos`), pageBreak: 'before' },
    book.length
      ? pTable(
          ['Fecha', 'Nº factura', 'Proveedor', 'NIF', 'Base', 'IVA', 'IRPF', 'Total'],
          book.map(d => [
            isoToEs(d.date),
            { text: d.number ?? '—', noWrap: false },
            { text: d.name || 'Sin proveedor', noWrap: false },
            d.nif ?? '—',
            pEur(d.base),
            pEur(d.vat),
            d.irpf ? pEur(-d.irpf) : '—',
            pEur(d.total),
          ]),
          [38, 52, '*', 45, 56, 46, 40, 58],
          {
            right: [4, 5, 6, 7],
            fontSize: 6.8,
            pad: 2.5,
            totals: [
              'Total',
              '',
              '',
              '',
              pEur(sum('base')),
              pEur(sum('vat')),
              pEur(-sum('irpf')),
              pEur(sum('total')),
            ],
          },
        )
      : { text: 'No hay gastos en el periodo.', fontSize: 8, color: P_MUTED },
  ]
}

/** Informe en PDF con la marca de la empresa: cifras clave, IVA, IRPF, rankings y libros registro */
export async function reportPdf(company: Company, r: Report, issued: IssuedBookRow[], received: ReceivedBookRow[]) {
  const [design, logo] = await Promise.all([getCompanyDesign(company), companyLogo(company.logoPath)])
  const accent = design.accentColor
  const brand = company.tradeName || company.legalName
  const range = `Del ${isoToEs(r.period.from)} al ${isoToEs(r.period.to)}${r.period.partial ? ' · periodo en curso' : ''}`
  const brandNode: PdfNode = logo
    ? { ...(logo.svg ? { svg: logo.svg } : { image: logo.dataUrl }), fit: [150, 50] }
    : { stack: [{ text: brand, font: 'InterSemi', fontSize: 15, color: P_INK }, company.tradeName ? { text: company.legalName, fontSize: 8, color: P_MUTED, margin: [0, 2, 0, 0] } : ''] }

  const header: PdfNode = {
    columns: [
      { width: '*', stack: [brandNode, { text: `NIF ${company.nif}`, fontSize: 7.5, color: P_MUTED, margin: [0, 6, 0, 0] }] },
      {
        width: 'auto',
        alignment: 'right',
        stack: [
          { text: 'INFORME DE GESTIÓN', font: 'InterSemi', fontSize: 7, color: P_MUTED, characterSpacing: 0.8 },
          { text: r.period.label.replace(/^./, ch => ch.toUpperCase()), font: 'InterSemi', fontSize: 20, color: accent, margin: [0, 2, 0, 2] },
          { text: range, fontSize: 7.5, color: P_INK2 },
        ],
      },
    ],
  }

  const definition: Record<string, unknown> = {
    pageSize: 'A4',
    pageMargins: [30, 42, 30, 48],
    info: { title: `Informe ${r.period.label} · ${brand}`, author: brand, creator: 'NUMIQ', producer: 'NUMIQ' },
    defaultStyle: { font: 'Inter', fontSize: 8.5, color: P_INK, lineHeight: 1.2 },
    background: (page: number, size: { width: number }) => (page === 1 ? { canvas: [{ type: 'rect', x: 0, y: 0, w: size.width, h: 5, color: accent }] } : null),
    header: (page: number) => (page === 1
      ? null
      : { columns: [{ text: brand, font: 'InterSemi', fontSize: 7.5, color: P_MUTED }, { text: `Informe ${r.period.label}`, fontSize: 7.5, color: P_MUTED, alignment: 'right' }], margin: [30, 18, 30, 0] }),
    footer: (page: number, pages: number) => ({
      stack: [
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 535, y2: 0, lineWidth: 0.5, lineColor: P_LINE }] },
        {
          columns: [
            { text: `Generado con NUMIQ el ${isoToEs(r.period.today)} · Criterio de devengo · Estimaciones orientativas`, fontSize: 6.5, color: P_MUTED, width: '*' },
            { text: `Página ${page} de ${pages}`, fontSize: 7, color: P_MUTED, alignment: 'right', width: 70 },
          ],
          margin: [0, 6, 0, 0],
        },
      ],
      margin: [30, 14, 30, 0],
    }),
    content: [
      header,
      { margin: [0, 18, 0, 0], ...pKpis(r) },
      { unbreakable: true, stack: [pSection('Cuenta de resultados', accent, r.columns.length ? (r.period.granularity === 'year' ? 'Por trimestres' : 'Por meses') : undefined), pPnl(r)] },
      ...pVat(r, accent),
      ...pIrpf(r, accent),
      ...pRankings(r, accent),
      ...pReceivables(r, accent),
      ...pIssuedBook(issued, accent, r.period.label),
      ...pReceivedBook(received, accent, r.period.label),
    ],
  }
  return renderPdf(definition)
}
