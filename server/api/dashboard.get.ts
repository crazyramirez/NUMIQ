import { and, desc, eq, inArray, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { company, role } = await requireCompany(event, 'advisor')
  const now = new Date()
  const year = now.getFullYear()
  const quarter = quarterOf(now)
  const today = toISODate(now)
  const q = quarterRange(year, quarter)

  // Mismo tramo del trimestre anterior (comparativa justa a mitad de trimestre)
  const prevQuarter = (quarter === 1 ? 4 : quarter - 1) as Quarter
  const prevYear = quarter === 1 ? year - 1 : year
  const pq = quarterRange(prevYear, prevQuarter)
  const elapsedDays = Math.round((now.getTime() - new Date(`${q.from}T00:00:00`).getTime()) / 86_400_000)
  const pqTo = new Date(`${pq.from}T12:00:00`)
  pqTo.setDate(pqTo.getDate() + elapsedDays)
  const pqToIso = toISODate(pqTo) < pq.to ? toISODate(pqTo) : pq.to

  const [current, previous, ytd, vat303, irpf130, monthly, recv, pay, top, byCategory] = await Promise.all([
    periodSummary(company.id, q.from, today),
    periodSummary(company.id, pq.from, pqToIso),
    periodSummary(company.id, `${year}-01-01`, today),
    estimate303(company.id, year, quarter),
    estimate130(company.id, year, quarter),
    monthlySeries(company.id, 12),
    receivables(company.id),
    payables(company.id),
    topClients(company.id, `${year - 1}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, today, 5, 'total'),
    expensesByCategory(company.id, q.from, today, 'total'),
  ])

  const s = tables.salesDocuments
  const c = tables.contacts
  const recent = await useDb().select({
    id: s.id, kind: s.kind, status: s.status, number: s.number, issueDate: s.issueDate, dueDate: s.dueDate,
    total: s.total, paidTotal: s.paidTotal, description: s.description, contactId: s.contactId,
    contactName: sql<string | null>`COALESCE(${c.name}, JSON_UNQUOTE(JSON_EXTRACT(${s.customer}, '$.name')))`,
  }).from(s).leftJoin(c, eq(c.id, s.contactId))
    .where(and(eq(s.companyId, company.id), inArray(s.kind, ['invoice', 'rectifying'])))
    .orderBy(desc(s.updatedAt), desc(s.id))
    .limit(6)

  // Logotipos de los mejores clientes
  const topIds = top.map(t => t.id).filter((v): v is number => !!v)
  const logos = topIds.length
    ? new Map((await useDb().select({ id: c.id, logoPath: c.logoPath }).from(c).where(and(eq(c.companyId, company.id), inArray(c.id, topIds)))).map(r => [r.id, r.logoPath]))
    : new Map<number, string | null>()

  // Concepto de cada factura reciente, como en el listado
  const concepts = await salesConcepts(recent)

  // Lo que hay que hacer hoy, cada cosa con su botón (Inicio lo pone lo primero)
  const tasks = await todayTasks(company, now, { role })
  // Tu dinero: saldo del banco menos lo que es de Hacienda y lo que debes
  const money = await freeMoney(company, now)

  const insights = await computeInsights(company, { quarter, year, vat303, irpf130, receivables: recv, monthly, top, ytd })

  return {
    period: { year, quarter, from: q.from, to: q.to },
    kpis: {
      // Importes con impuestos, como en el resto de pantallas (el beneficio, sobre bases, está en Informes)
      income: { value: current.incomeTotal, previous: previous.incomeTotal },
      expenses: { value: current.expensesTotal, previous: previous.expensesTotal },
      receivables: recv,
      payables: pay,
      vat303,
      irpf130: { ...irpf130, applicable: company.kind === 'autonomo' && company.taxRegime !== 'modulos' },
    },
    ytd,
    monthly,
    topClients: top.map(t => ({ ...t, logoUrl: contactLogoUrl(t.id, t.id ? logos.get(t.id) : null) })),
    expensesByCategory: byCategory,
    recent: recent.map(({ description: _description, ...r }) => ({ ...r, conceptPreview: concepts.get(r.id)?.conceptPreview ?? null, overdue: !isQuoteKind(r.kind) && isOpenStatus(r.status) && !!r.dueDate && r.dueDate < today })),
    deadlines: upcomingDeadlines(now, company.kind, 4),
    tasks,
    money,
    insights,
  }
})
