import { and, eq, gt, gte, inArray, lte, notInArray, sql } from 'drizzle-orm'

/**
 * Borradores de los modelos trimestrales con sus casillas, listos para copiar en el formulario
 * oficial de la Sede de la AEAT, donde el contribuyente se identifica con certificado, Cl@ve o DNIe
 * y presenta. NUMIQ calcula; el formulario de la AEAT vuelve a validar.
 */

type Company = typeof tables.companies.$inferSelect
export type TaxModel = '303' | '130' | '111' | '115'
export type AnnualModel = '390' | '190' | '180' | '347'

export interface ModelBox {
  box: string
  label: string
  value: number | string
  /** Fila destacada (totales y resultado) */
  strong?: boolean
}

export interface ModelDraft {
  /** 200 y 202: Impuesto sobre Sociedades (corporate-tax.ts) */
  model: TaxModel | AnnualModel | '200' | '202'
  title: string
  year: number
  quarter: Quarter | null
  period: string
  from: string
  to: string
  boxes: ModelBox[]
  result: number
  outcome: 'ingresar' | 'devolver' | 'compensar' | 'cero'
  dueDate: string | null
  presentUrl: string
  infoUrl: string
  notes: string[]
  /** Declarados o perceptores (modelos informativos) */
  table?: { columns: string[], rows: Array<Array<string | number>>, numeric: number[] }
}

const PROCEDURE: Record<TaxModel | AnnualModel, string> = { 303: 'G414', 130: 'G601', 111: 'GH01', 115: 'GH02', 390: 'G412', 190: 'GI10', 180: 'GI00', 347: 'GI27' }
const TITLES: Record<TaxModel | AnnualModel, string> = {
  303: 'IVA. Autoliquidación trimestral',
  130: 'IRPF. Pago fraccionado (estimación directa)',
  111: 'Retenciones de profesionales y trabajadores',
  115: 'Retenciones de alquileres',
  390: 'IVA. Resumen anual',
  190: 'Resumen anual de retenciones de profesionales y trabajadores',
  180: 'Resumen anual de retenciones de alquileres',
  347: 'Operaciones con terceros (más de 3.005,06 €)',
}

/** IVA soportado deducible separado en gastos corrientes y bienes de inversión (casillas 28-31) */
async function deductibleSplit(companyId: number, from: string, to: string) {
  const e = tables.expenses
  const n = (x: ReturnType<typeof sql>) => sql<number>`COALESCE(${x}, 0)`.mapWith(Number)
  const [r] = await useDb().select({
    baseCurrent: n(sql`SUM(CASE WHEN ${e.isInvestment} OR ${e.vatTotal} = 0 THEN 0 ELSE ${e.taxBase} * ${e.vatDeductiblePct} / 100 END)`),
    vatCurrent: n(sql`SUM(CASE WHEN ${e.isInvestment} THEN 0 ELSE ${e.vatTotal} * ${e.vatDeductiblePct} / 100 END)`),
    baseInvest: n(sql`SUM(CASE WHEN ${e.isInvestment} AND ${e.vatTotal} <> 0 THEN ${e.taxBase} * ${e.vatDeductiblePct} / 100 ELSE 0 END)`),
    vatInvest: n(sql`SUM(CASE WHEN ${e.isInvestment} THEN ${e.vatTotal} * ${e.vatDeductiblePct} / 100 ELSE 0 END)`),
  }).from(e).where(and(eq(e.companyId, companyId), approvedExpense(), gte(e.issueDate, from), lte(e.issueDate, to)))
  return { baseCurrent: round2(r!.baseCurrent), vatCurrent: round2(r!.vatCurrent), baseInvest: round2(r!.baseInvest), vatInvest: round2(r!.vatInvest) }
}

function outcomeOf(result: number, model: TaxModel | AnnualModel, quarter: Quarter | null): ModelDraft['outcome'] {
  if (Math.abs(result) < 0.005) return 'cero'
  if (result > 0) return 'ingresar'
  // El 303 negativo se compensa en trimestres siguientes; en el 4T puede pedirse la devolución
  return (model === '303' && quarter === 4) || model === '390' ? 'devolver' : 'compensar'
}

export async function modelDraft(company: Company, model: TaxModel, year: number, quarter: Quarter): Promise<ModelDraft> {
  const { from, to } = quarterRange(year, quarter)
  const period = `${quarter}T`
  const deadline = deadlinesForYear(year, company.kind).concat(deadlinesForYear(year + 1, company.kind))
    .find(d => d.models.includes(model) && d.period === `${quarter}T ${year}`)
  const base = {
    model, title: TITLES[model], year, quarter, period, from, to,
    dueDate: deadline?.end ?? null,
    presentUrl: `https://sede.agenciatributaria.gob.es/Sede/procedimientoini/${PROCEDURE[model]}.shtml`,
    infoUrl: `https://sede.agenciatributaria.gob.es/Sede/procedimientos/${PROCEDURE[model]}.shtml`,
  }

  if (model === '303') {
    const report = await buildReport(company, resolveReportPeriod(year, quarter))
    const groups = report.vat.charged
    const boxes: ModelBox[] = []
    // Régimen general: una fila por tipo (4 %, 10 % y 21 %; otros tipos en la fila más próxima)
    const rows: Array<[string[], number]> = [[['01', '02', '03'], 4], [['04', '05', '06'], 10], [['07', '08', '09'], 21]]
    for (const [codes, rate] of rows) {
      const list = groups.filter(g => (rate === 4 ? g.rate > 0 && g.rate < 7 : rate === 10 ? g.rate >= 7 && g.rate < 15 : g.rate >= 15))
      const b = round2(list.reduce((s, g) => s + g.base, 0))
      const v = round2(list.reduce((s, g) => s + g.vat, 0))
      if (!b && !v) continue
      boxes.push({ box: codes[0]!, label: `Base imponible al ${rate} %`, value: b }, { box: codes[1]!, label: 'Tipo %', value: rate }, { box: codes[2]!, label: `Cuota al ${rate} %`, value: v })
    }
    // Recargo de equivalencia repercutido
    const re: Array<[string[], number]> = [[['16', '17', '18'], 0.5], [['19', '20', '21'], 1.4], [['22', '23', '24'], 5.2]]
    for (const [codes, rate] of re) {
      const list = groups.filter(g => g.surchargeRate === rate)
      const b = round2(list.reduce((s, g) => s + g.base, 0))
      const v = round2(list.reduce((s, g) => s + g.surcharge, 0))
      if (!v) continue
      boxes.push({ box: codes[0]!, label: `Base recargo ${num2(rate)} %`, value: b }, { box: codes[1]!, label: 'Tipo recargo %', value: rate }, { box: codes[2]!, label: 'Cuota recargo', value: v })
    }
    const accrued = round2(report.vat.totals.charged)
    const d = await deductibleSplit(company.id, from, to)
    const deductible = round2(d.vatCurrent + d.vatInvest)
    const result = round2(accrued - deductible)
    boxes.push(
      { box: '27', label: 'Total cuota devengada', value: accrued, strong: true },
      { box: '28', label: 'Base de operaciones interiores corrientes', value: d.baseCurrent },
      { box: '29', label: 'Cuota deducible de operaciones interiores corrientes', value: d.vatCurrent },
      ...(d.vatInvest ? [{ box: '30', label: 'Base de bienes de inversión', value: d.baseInvest }, { box: '31', label: 'Cuota deducible de bienes de inversión', value: d.vatInvest }] : []),
      { box: '45', label: 'Total a deducir', value: deductible, strong: true },
      { box: '46', label: 'Resultado del régimen general (27 − 45)', value: result, strong: true },
      { box: '64', label: 'Suma de resultados', value: result },
      { box: '65', label: '% atribuible a la Administración del Estado', value: 100 },
      { box: '66', label: 'Atribuible a la Administración del Estado', value: result },
      { box: '69', label: 'Resultado', value: result },
      { box: '71', label: 'Resultado de la liquidación', value: result, strong: true },
    )
    return {
      ...base, boxes, result, outcome: outcomeOf(result, model, quarter),
      notes: [
        'Si tienes cuotas a compensar de trimestres anteriores, indícalas en las casillas 110 y 78: el resultado final bajará.',
        ...(quarter === 4 ? ['En el 4T presenta también el resumen anual (modelo 390) si te corresponde.'] : []),
      ],
    }
  }

  if (model === '130') {
    // Acumulado desde el 1 de enero hasta el fin del trimestre
    let paidBefore = 0
    for (let q = 1 as Quarter; q < quarter; q = (q + 1) as Quarter) paidBefore = round2(paidBefore + (await estimate130(company.id, year, q)).result)
    const e = await estimate130(company.id, year, quarter)
    const twenty = round2(Math.max(0, e.netIncome) * 0.2)
    const previous = round2(twenty - paidBefore - e.withheld)
    const result = Math.max(0, previous)
    return {
      ...base,
      boxes: [
        { box: '01', label: 'Ingresos computables (acumulado del año)', value: e.income },
        { box: '02', label: 'Gastos fiscalmente deducibles (acumulado)', value: e.expenses },
        { box: '03', label: 'Rendimiento neto (01 − 02)', value: e.netIncome, strong: true },
        { box: '04', label: '20 % del rendimiento neto', value: twenty },
        { box: '05', label: 'Pagos fraccionados de trimestres anteriores', value: paidBefore },
        { box: '06', label: 'Retenciones e ingresos a cuenta (acumulado)', value: e.withheld },
        { box: '07', label: 'Pago fraccionado previo (04 − 05 − 06)', value: previous },
        { box: '12', label: 'Suma de pagos fraccionados previos', value: previous },
        { box: '14', label: 'Diferencia', value: previous },
        { box: '17', label: 'Total', value: previous },
        { box: '19', label: 'Resultado de la autoliquidación', value: result, strong: true },
      ],
      result,
      outcome: outcomeOf(result, model, quarter),
      notes: [
        'Si tus rendimientos netos del año pasado no superaron 12.000 €, puedes aplicar la minoración de la casilla 13 (de 25 € a 100 €).',
        ...(previous < 0 ? ['El resultado negativo no se devuelve: se descuenta en los siguientes trimestres del año (casilla 15).'] : []),
      ],
    }
  }

  const w = (await withholdings(company.id, from, to))[model === '111' ? 'm111' : 'm115']
  if (model === '111') {
    return {
      ...base,
      boxes: [
        { box: '07', label: 'Actividades económicas: nº de perceptores', value: w.recipients },
        { box: '08', label: 'Importe de las percepciones', value: w.base },
        { box: '09', label: 'Importe de las retenciones', value: w.result },
        { box: '28', label: 'Total liquidación (suma de retenciones)', value: w.result, strong: true },
        { box: '30', label: 'Resultado a ingresar', value: w.result, strong: true },
      ],
      result: w.result,
      outcome: outcomeOf(w.result, model, quarter),
      notes: ['Si además pagas nóminas, añade las retenciones de trabajo en las casillas 01 a 06.', ...(w.result ? [] : ['Sin retenciones en el trimestre: si tienes obligación periódica, presenta la declaración negativa.'])],
    }
  }
  return {
    ...base,
    boxes: [
      { box: '01', label: 'Nº de perceptores', value: w.recipients },
      { box: '02', label: 'Base de las retenciones', value: w.base },
      { box: '03', label: 'Retenciones e ingresos a cuenta', value: w.result },
      { box: '05', label: 'Resultado a ingresar', value: w.result, strong: true },
    ],
    result: w.result,
    outcome: outcomeOf(w.result, model, quarter),
    notes: w.result ? [] : ['Sin retenciones de alquiler en el trimestre.'],
  }
}


// ─── Resúmenes anuales e informativas ────────────────────────────────────────

const num2 = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 2 })
const LIMIT_347 = 3005.06

type Party = { key: string, nif: string, name: string, province: string, quarters: [number, number, number, number] }

function addTo(map: Map<string, Party>, p: { nif: string | null, name: string, postalCode: string | null }, date: string, amount: number) {
  const nif = p.nif ? normalizeNif(p.nif) : ''
  const key = nif || comparableName(p.name)
  const party = map.get(key) ?? { key, nif, name: p.name, province: p.postalCode && /^\d{5}$/.test(p.postalCode) ? p.postalCode.slice(0, 2) : '', quarters: [0, 0, 0, 0] }
  const q = quarterOf(date) - 1
  party.quarters[q] = round2(party.quarters[q]! + amount)
  map.set(key, party)
}

/** Modelo 347: clientes y proveedores con más de 3.005,06 € en el año (IVA incluido), sin operaciones con retención */
async function model347(companyId: number, year: number) {
  const db = useDb()
  const s = tables.salesDocuments
  const e = tables.expenses
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const [sales, purchases] = await Promise.all([
    db.select({ date: s.issueDate, total: s.total, irpf: s.irpfTotal, customer: s.customer, contactNif: tables.contacts.nif, contactName: tables.contacts.name, cp: tables.contacts.postalCode })
      .from(s).leftJoin(tables.contacts, eq(tables.contacts.id, s.contactId))
      .where(and(eq(s.companyId, companyId), inArray(s.kind, ['invoice', 'rectifying']), notInArray(s.status, ['draft', 'cancelled']), gte(s.issueDate, from), lte(s.issueDate, to))),
    db.select({ date: e.issueDate, total: e.total, irpf: e.irpfTotal, supplier: e.supplier, contactNif: tables.contacts.nif, contactName: tables.contacts.name, cp: tables.contacts.postalCode })
      .from(e).leftJoin(tables.contacts, eq(tables.contacts.id, e.supplierId))
      .where(and(eq(e.companyId, companyId), approvedExpense(), inArray(e.kind, ['invoice', 'ticket', 'other']), gte(e.issueDate, from), lte(e.issueDate, to))),
  ])
  const clients = new Map<string, Party>()
  const suppliers = new Map<string, Party>()
  for (const r of sales) {
    // Las operaciones con retención las declara quien retiene (190/180), no van al 347
    if (r.irpf) continue
    const nif = r.contactNif ?? r.customer?.nif ?? null
    if (nif && !validateNif(nif).valid) continue
    addTo(clients, { nif, name: r.contactName ?? r.customer?.name ?? 'Sin nombre', postalCode: r.cp ?? r.customer?.postalCode ?? null }, r.date, r.total)
  }
  for (const r of purchases) {
    if (r.irpf) continue
    const nif = r.contactNif ?? r.supplier?.nif ?? null
    if (nif && !validateNif(nif).valid) continue
    addTo(suppliers, { nif, name: r.contactName ?? r.supplier?.name ?? 'Sin nombre', postalCode: r.cp ?? r.supplier?.postalCode ?? null }, r.date, r.total)
  }
  const rows: Array<Array<string | number>> = []
  const sum = (p: Party) => round2(p.quarters.reduce((x, y) => x + y, 0))
  const push = (map: Map<string, Party>, clave: string) => {
    for (const p of [...map.values()].sort((a, b) => sum(b) - sum(a))) {
      if (Math.abs(sum(p)) <= LIMIT_347) continue
      rows.push([clave, p.nif || '—', p.name, p.province || '—', sum(p), ...p.quarters])
    }
  }
  push(clients, 'B · ventas')
  push(suppliers, 'A · compras')
  return rows
}

/** Perceptores con retención del año: profesionales y trabajadores (190) o arrendadores (180) */
async function perceptors(companyId: number, year: number, rent: boolean) {
  const e = tables.expenses
  const cat = tables.categories
  const isRent = sql`COALESCE(${cat.accountCode} = '621', 0)`
  const nifExpr = sql<string | null>`COALESCE(${tables.contacts.nif}, JSON_UNQUOTE(JSON_EXTRACT(${e.supplier}, '$.nif')))`
  const nameExpr = sql<string>`COALESCE(${tables.contacts.name}, JSON_UNQUOTE(JSON_EXTRACT(${e.supplier}, '$.name')), 'Sin nombre')`
  const rows = await useDb().select({
    nif: nifExpr,
    name: nameExpr,
    payroll: sql<number>`MAX(CASE WHEN ${e.kind} = 'payroll' THEN 1 ELSE 0 END)`.mapWith(Number),
    base: sql<number>`SUM(${e.taxBase})`.mapWith(Number),
    irpf: sql<number>`SUM(${e.irpfTotal})`.mapWith(Number),
  }).from(e).leftJoin(cat, eq(cat.id, e.categoryId)).leftJoin(tables.contacts, eq(tables.contacts.id, e.supplierId))
    .where(and(eq(e.companyId, companyId), approvedExpense(), gte(e.issueDate, `${year}-01-01`), lte(e.issueDate, `${year}-12-31`), gt(e.irpfTotal, 0), rent ? sql`${isRent}` : sql`NOT ${isRent}`))
    .groupBy(nifExpr, nameExpr)
  return rows.map(r => ({ nif: r.nif ? normalizeNif(r.nif) : '—', name: r.name, payroll: !!r.payroll, base: round2(r.base), irpf: round2(r.irpf) }))
}

/** Borrador de un resumen anual o declaración informativa del ejercicio */
export async function annualDraft(company: Company, model: AnnualModel, year: number): Promise<ModelDraft> {
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const deadline = deadlinesForYear(year + 1, company.kind).find(d => d.models.includes(model) && d.period === `${year}`)
  const base = {
    model, title: TITLES[model], year, quarter: null, period: '0A', from, to,
    dueDate: deadline?.end ?? null,
    presentUrl: `https://sede.agenciatributaria.gob.es/Sede/procedimientoini/${PROCEDURE[model]}.shtml`,
    infoUrl: `https://sede.agenciatributaria.gob.es/Sede/procedimientos/${PROCEDURE[model]}.shtml`,
  }

  if (model === '390') {
    const report = await buildReport(company, resolveReportPeriod(year))
    const d = await deductibleSplit(company.id, from, to)
    const boxes: ModelBox[] = []
    for (const g of report.vat.charged.filter(x => x.base || x.vat)) {
      boxes.push({ box: '', label: `Régimen general · base al ${num2(g.rate)} %`, value: g.base }, { box: '', label: `Cuota al ${num2(g.rate)} %`, value: g.vat })
      if (g.surcharge) boxes.push({ box: '', label: `Recargo de equivalencia ${num2(g.surchargeRate)} %`, value: g.surcharge })
    }
    const accrued = round2(report.vat.totals.charged)
    const deductible = round2(d.vatCurrent + d.vatInvest)
    const result = round2(accrued - deductible)
    boxes.push(
      { box: '', label: 'Total cuotas de IVA devengadas', value: accrued, strong: true },
      { box: '', label: 'Deducible · operaciones interiores corrientes (base)', value: d.baseCurrent },
      { box: '', label: 'Deducible · operaciones interiores corrientes (cuota)', value: d.vatCurrent },
      ...(d.vatInvest ? [{ box: '', label: 'Deducible · bienes de inversión (base)', value: d.baseInvest }, { box: '', label: 'Deducible · bienes de inversión (cuota)', value: d.vatInvest }] : []),
      { box: '', label: 'Total cuotas deducibles', value: deductible, strong: true },
      { box: '', label: 'Resultado del régimen general', value: result, strong: true },
      { box: '', label: 'Volumen total de operaciones (bases del año)', value: round2(report.pnl.income) },
    )
    return {
      ...base, boxes, result, outcome: outcomeOf(result, model, null),
      notes: [
        'El 390 resume tus cuatro 303 del año: el resultado debe coincidir con la suma de lo que declaraste en ellos.',
        'En el formulario indica también tu actividad (epígrafe IAE) y la prorrata si tienes operaciones exentas.',
      ],
    }
  }

  if (model === '347') {
    const rows = await model347(company.id, year)
    return {
      ...base,
      boxes: [{ box: '', label: 'Declarados', value: rows.length, strong: true }],
      result: 0,
      outcome: 'cero',
      table: { columns: ['Clave', 'NIF', 'Nombre', 'Prov.', 'Anual', '1T', '2T', '3T', '4T'], rows, numeric: [4, 5, 6, 7, 8] },
      notes: [
        'Se declaran los clientes y proveedores con más de 3.005,06 € en el año, IVA incluido.',
        'No van las operaciones con retención (las declara quien retiene) ni las intracomunitarias (modelo 349).',
        ...(rows.length ? [] : ['Este año no tienes operaciones que declarar: no estás obligado a presentar el 347.']),
      ],
    }
  }

  const list = await perceptors(company.id, year, model === '180')
  const totalBase = round2(list.reduce((x, r) => x + r.base, 0))
  const totalIrpf = round2(list.reduce((x, r) => x + r.irpf, 0))
  return {
    ...base,
    boxes: [
      { box: '', label: 'Nº de perceptores', value: list.length },
      { box: '', label: model === '180' ? 'Base de las retenciones (alquileres)' : 'Importe de las percepciones', value: totalBase },
      { box: '', label: 'Retenciones e ingresos a cuenta', value: totalIrpf, strong: true },
    ],
    result: 0,
    outcome: 'cero',
    table: {
      columns: model === '180' ? ['NIF', 'Arrendador', 'Base', 'Retención'] : ['NIF', 'Perceptor', 'Clave', 'Percepciones', 'Retención'],
      rows: list.map(r => (model === '180' ? [r.nif, r.name, r.base, r.irpf] : [r.nif, r.name, r.payroll ? 'A · trabajo' : 'G · profesional', r.base, r.irpf])),
      numeric: model === '180' ? [2, 3] : [3, 4],
    },
    notes: model === '180'
      ? ['Indica en el formulario la referencia catastral y la dirección de cada inmueble alquilado.', 'Las retenciones deben coincidir con la suma de tus cuatro 115 del año.']
      : ['Las retenciones deben coincidir con la suma de tus cuatro 111 del año.', ...(list.length ? [] : ['Sin retenciones en el año: no tienes que presentar el 190.'])],
  }
}
