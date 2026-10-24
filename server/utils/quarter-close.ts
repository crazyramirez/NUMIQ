import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lte, notInArray, sql } from 'drizzle-orm'

type Company = typeof tables.companies.$inferSelect

export interface CloseStep {
  key: string
  title: string
  /** Por qué importa, en una línea */
  why: string
  state: 'done' | 'todo' | 'warn'
  detail: string
  action?: { label: string, to: string }
}

export interface CloseModel {
  model: string
  name: string
  result: number
  /** Sin nada que declarar (sin retenciones en el trimestre): no hace falta presentarlo */
  nothing: boolean
  filing: { id: number, status: 'draft' | 'ready' | 'filed' | 'paid', csv: string | null, filedAt: string | null } | null
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * «Cerrar el trimestre»: lo que hay que dejar al día y presentar, paso a paso.
 * 1-4 comprueban los datos (borradores, banco, justificantes, gastos por revisar);
 * después, cada modelo (presentado → pagado) y por último el envío a la gestoría.
 */
export async function quarterClose(company: Company, year: number, q: Quarter) {
  const db = useDb()
  const { from, to } = quarterRange(year, q)
  const s = tables.salesDocuments
  const e = tables.expenses
  const bt = tables.bankTransactions
  const kind = company.kind === 'sociedad' ? 'sociedad' : 'autonomo'

  const ap = tables.advisorPacks
  const [[drafts], [bank], [noFile], [unreviewed], [salesN], [expN], filings, vat, irpf, wh, [pack]] = await Promise.all([
    db.select({ n: count() }).from(s).where(and(eq(s.companyId, company.id), eq(s.kind, 'invoice'), eq(s.status, 'draft'), gte(s.issueDate, from), lte(s.issueDate, to))),
    db.select({ n: count() }).from(bt).where(and(eq(bt.companyId, company.id), eq(bt.status, 'pending'), gte(bt.date, from), lte(bt.date, to))),
    db.select({ n: count() }).from(e).where(and(eq(e.companyId, company.id), isNull(e.fileId), notInArray(e.kind, ['payroll', 'social_security', 'tax']), gte(e.issueDate, from), lte(e.issueDate, to))),
    db.select({ n: count() }).from(e).where(and(eq(e.companyId, company.id), eq(e.reviewed, false), gte(e.issueDate, from), lte(e.issueDate, to))),
    db.select({ n: count() }).from(s).where(and(eq(s.companyId, company.id), inArray(s.kind, ['invoice', 'rectifying']), sql`${s.status} NOT IN ('draft', 'cancelled')`, gte(s.issueDate, from), lte(s.issueDate, to))),
    db.select({ n: count() }).from(e).where(and(eq(e.companyId, company.id), gte(e.issueDate, from), lte(e.issueDate, to))),
    db.select().from(tables.taxFilings).where(and(eq(tables.taxFilings.companyId, company.id), eq(tables.taxFilings.year, year), eq(tables.taxFilings.period, `${q}T`))),
    estimate303(company.id, year, q),
    kind === 'autonomo' && company.taxRegime !== 'modulos' ? estimate130(company.id, year, q) : Promise.resolve(null),
    withholdings(company.id, from, to),
    // Paquete del trimestre ya enviado (o descargado) para la gestoría
    db.select({ id: ap.id, sentAt: ap.sentAt, sentTo: ap.sentTo, createdAt: ap.createdAt, downloads: ap.downloads }).from(ap)
      .where(and(eq(ap.companyId, company.id), lte(ap.periodFrom, from), gte(ap.periodTo, to), isNotNull(ap.sentAt)))
      .orderBy(desc(ap.id)).limit(1),
  ])
  const n = (x?: { n: number | string }) => Number(x?.n ?? 0)

  const checks: CloseStep[] = [
    {
      key: 'drafts',
      title: 'Facturas emitidas',
      why: 'Lo que no se emite no cuenta en el IVA ni en el IRPF',
      state: n(drafts) ? 'todo' : 'done',
      detail: n(drafts) ? `${plural(n(drafts), 'borrador', 'borradores')} del trimestre sin emitir` : `${plural(n(salesN), 'factura emitida', 'facturas emitidas')}`,
      action: n(drafts) ? { label: 'Ver borradores', to: '/facturas?estado=draft' } : undefined,
    },
    {
      key: 'review',
      title: 'Gastos revisados',
      why: 'Los que leyó la IA conviene mirarlos antes de declarar',
      state: n(unreviewed) ? 'todo' : 'done',
      detail: n(unreviewed) ? `${plural(n(unreviewed), 'gasto', 'gastos')} por revisar` : `${plural(n(expN), 'gasto registrado', 'gastos registrados')}`,
      action: n(unreviewed) ? { label: 'Revisar', to: '/gastos?estado=review&periodo=all' } : undefined,
    },
    {
      key: 'files',
      title: 'Justificantes',
      why: 'Para deducir un gasto, Hacienda puede pedir la factura',
      state: n(noFile) ? 'warn' : 'done',
      detail: n(noFile) ? `${plural(n(noFile), 'gasto', 'gastos')} sin foto ni PDF` : 'Todos los gastos tienen su documento',
      action: n(noFile) ? { label: 'Ver cuáles', to: '/gastos?justificante=no&periodo=all' } : undefined,
    },
    {
      key: 'bank',
      title: 'Banco conciliado',
      why: 'Así sabes qué está cobrado y pagado de verdad, y no se escapa ningún gasto',
      state: n(bank) ? 'warn' : 'done',
      detail: n(bank) ? `${plural(n(bank), 'movimiento', 'movimientos')} del trimestre sin revisar` : 'Sin movimientos pendientes',
      action: n(bank) ? { label: 'Ir al banco', to: '/banco' } : undefined,
    },
  ]

  const filingOf = (model: string) => {
    const f = filings.find(x => x.model === model)
    return f ? { id: f.id, status: f.status, csv: f.csv, filedAt: f.filedAt ? toISODate(f.filedAt) : null } : null
  }
  const models: CloseModel[] = [
    { model: '303', name: 'IVA del trimestre', result: vat.result, nothing: false, filing: filingOf('303') },
    ...(irpf ? [{ model: '130', name: 'Pago a cuenta del IRPF', result: irpf.result, nothing: false, filing: filingOf('130') }] : []),
    { model: '111', name: 'Retenciones a profesionales', result: wh.m111.result, nothing: wh.m111.result === 0 && wh.m111.recipients === 0, filing: filingOf('111') },
    { model: '115', name: 'Retención del alquiler', result: wh.m115.result, nothing: wh.m115.result === 0 && wh.m115.recipients === 0, filing: filingOf('115') },
  ]

  const due = deadlinesForYear(q === 4 ? year + 1 : year, kind).find(d => d.period === `${q}T ${year}`)?.end ?? null
  const toFile = models.filter(m => !m.nothing)
  const filed = toFile.filter(m => m.filing && (m.filing.status === 'filed' || m.filing.status === 'paid')).length
  const toPay = toFile.filter(m => m.result > 0)
  const paid = toPay.filter(m => m.filing?.status === 'paid').length
  const checksDone = checks.filter(c => c.state === 'done').length
  const total = checks.length + toFile.length * 1 + toPay.length + 1
  const advisorSent = !!pack
  const doneCount = checksDone + filed + paid + (advisorSent ? 1 : 0)

  return {
    year,
    quarter: q,
    from,
    to,
    dueDate: due,
    closed: toISODate(new Date()) > to,
    checks,
    models,
    toPayTotal: round2(toPay.reduce((sum, m) => sum + m.result, 0)),
    advisor: {
      sent: advisorSent,
      sentAt: pack?.sentAt ? toISODate(pack.sentAt) : null,
      sentTo: pack?.sentTo ?? null,
      configured: !!advisorOf(company)?.email,
      to: `/documentos/gestor?anio=${year}&t=${q}`,
    },
    progress: { done: doneCount, total },
  }
}
