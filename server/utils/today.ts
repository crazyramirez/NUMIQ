import { and, eq, inArray, isNull, lt, notInArray, sql } from 'drizzle-orm'

export interface TodayTask {
  key: string
  icon: string
  tone: 'danger' | 'warning' | 'info' | 'brand'
  title: string
  detail: string | null
  /** Acción principal: un enlace o «remind» (recordar a todos los vencidos de una vez) */
  action: { label: string, to?: string, kind?: 'remind' }
  secondary?: { label: string, to: string }
}

type Company = typeof tables.companies.$inferSelect

const eurText0 = (n: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, useGrouping: 'always' }).format(n)
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const esShort = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '')
const daysTo = (iso: string, today: string) => Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000)

/**
 * Lo que hay que hacer hoy, de lo más urgente a lo menos, cada cosa con su botón.
 * Solo tareas con algo pendiente de verdad: si no hay nada, la lista viene vacía («todo al día»).
 */
export async function todayTasks(company: Company, now = new Date(), viewer?: { role: string }): Promise<TodayTask[]> {
  const db = useDb()
  const today = toISODate(now)
  const s = tables.salesDocuments
  const e = tables.expenses
  const urgent: TodayTask[] = []
  const rest: TodayTask[] = []

  const [recv, [bank], [drafts], [quotes], [unpaid], [noFile], filings] = await Promise.all([
    receivables(company.id),
    db.select({ n: sql<number>`COUNT(*)`.mapWith(Number) }).from(tables.bankTransactions)
      .where(and(eq(tables.bankTransactions.companyId, company.id), eq(tables.bankTransactions.status, 'pending'))),
    db.select({ n: sql<number>`COUNT(*)`.mapWith(Number) }).from(s)
      .where(and(eq(s.companyId, company.id), eq(s.kind, 'invoice'), eq(s.status, 'draft'))),
    // Presupuestos enviados hace más de una semana que siguen sin respuesta
    db.select({ n: sql<number>`COUNT(*)`.mapWith(Number) }).from(s)
      .where(and(eq(s.companyId, company.id), inArray(s.kind, ['quote', 'proforma']), inArray(s.status, ['issued', 'sent']), lt(s.issueDate, toISODate(new Date(now.getTime() - 7 * 86_400_000))))),
    db.select({ n: sql<number>`COUNT(*)`.mapWith(Number), amount: sql<number>`COALESCE(SUM(${e.total} - ${e.paidTotal}), 0)`.mapWith(Number) }).from(e)
      .where(and(eq(e.companyId, company.id), approvedExpense(), inArray(e.status, ['pending', 'partial']), lt(e.dueDate, today))),
    // Gastos del trimestre sin la foto o el PDF (nóminas, cuotas e impuestos no llevan factura adjunta)
    db.select({ n: sql<number>`COUNT(*)`.mapWith(Number) }).from(e)
      .where(and(eq(e.companyId, company.id), isNull(e.fileId), notInArray(e.kind, ['payroll', 'social_security', 'tax']), sql`${e.issueDate} >= ${quarterRange(now.getFullYear(), quarterOf(now)).from}`)),
    db.select({ model: tables.taxFilings.model, year: tables.taxFilings.year, period: tables.taxFilings.period }).from(tables.taxFilings)
      .where(and(eq(tables.taxFilings.companyId, company.id), inArray(tables.taxFilings.status, ['filed', 'paid']))),
  ])

  if (recv.overdueCount > 0) {
    urgent.push({
      key: 'overdue',
      icon: 'ph:clock-countdown',
      tone: 'danger',
      title: `${plural(recv.overdueCount, 'factura vencida', 'facturas vencidas')} sin cobrar`,
      detail: `${eurText0(recv.overdueAmount)} fuera de plazo`,
      action: mailEnabled() ? { label: 'Recordar a todos', kind: 'remind' } : { label: 'Ver', to: '/facturas?estado=overdue' },
      secondary: mailEnabled() ? { label: 'Ver', to: '/facturas?estado=overdue' } : undefined,
    })
  }

  // Plazo de impuestos abierto con modelos aún sin presentar
  const kind = company.kind === 'sociedad' ? 'sociedad' : 'autonomo'
  const open = upcomingDeadlines(now, kind, 3).find(d => d.start <= today && daysTo(d.end, today) <= 25)
  if (open) {
    const m = /^([1-4])T (\d{4})$/.exec(open.period)
    const period = m ? `${m[1]}T` : open.period.length === 4 ? '0A' : open.period.slice(0, 2)
    const year = m ? Number(m[2]) : Number(open.period.slice(-4))
    const done = new Set(filings.filter(f => f.year === year && f.period === period).map(f => f.model))
    const pending = open.models.filter(x => !done.has(x))
    if (pending.length) {
      let amount = 0
      if (m) {
        const q = Number(m[1]) as Quarter
        const [vat, irpf] = await Promise.all([
          pending.includes('303') ? estimate303(company.id, year, q) : null,
          pending.includes('130') && kind === 'autonomo' ? estimate130(company.id, year, q) : null,
        ])
        amount = Math.max(0, vat?.result ?? 0) + (irpf?.result ?? 0)
      }
      const days = daysTo(open.end, today)
      urgent.push({
        key: `deadline:${open.period}`,
        icon: 'ph:bank',
        tone: days <= 5 ? 'danger' : 'warning',
        title: `Presenta ${open.title.toLowerCase()} antes del ${esShort(open.end)}`,
        detail: [
          days === 0 ? 'Último día' : `Quedan ${plural(days, 'día', 'días')}`,
          amount > 0 ? `unos ${eurText0(amount)} a ingresar` : null,
          `modelos ${pending.join(', ')}`,
        ].filter(Boolean).join(' · '),
        action: { label: 'Cerrar trimestre', to: m ? `/impuestos/cerrar?anio=${year}&t=${m[1]}` : '/impuestos' },
      })
    }
  }

  // Gastos del equipo esperando aprobación (solo los ven quienes pueden aprobar)
  if (viewer && ['owner', 'admin'].includes(viewer.role)) {
    const [toApprove] = await db.select({ n: sql<number>`COUNT(*)`.mapWith(Number), amount: sql<number>`COALESCE(SUM(${e.total}), 0)`.mapWith(Number) }).from(e)
      .where(and(eq(e.companyId, company.id), eq(e.approval, 'pending')))
    if (toApprove!.n > 0) {
      urgent.push({
        key: 'approvals',
        icon: 'ph:check-square-offset',
        tone: 'warning',
        title: `${plural(toApprove!.n, 'gasto del equipo espera', 'gastos del equipo esperan')} tu aprobación`,
        detail: `${eurText0(toApprove!.amount)} · no cuentan en impuestos hasta que los apruebes`,
        action: { label: 'Revisar', to: '/gastos?aprobacion=pending&periodo=all' },
      })
    }
  }

  if (unpaid!.n > 0) {
    urgent.push({
      key: 'payables',
      icon: 'ph:wallet',
      tone: 'warning',
      title: `${plural(unpaid!.n, 'gasto vencido', 'gastos vencidos')} sin pagar`,
      detail: `${eurText0(unpaid!.amount)} pendientes`,
      action: { label: 'Ver', to: '/gastos?estado=pending&periodo=all' },
    })
  }

  // Lo que la IA ha leído y espera una decisión
  const review = await inboxCount(company)
  if (review.imports > 0) {
    rest.push({
      key: 'imports',
      icon: 'ph:upload-simple',
      tone: 'brand',
      title: plural(review.imports, 'importación por confirmar', 'importaciones por confirmar'),
      detail: 'La IA ya ha leído los documentos: revisa y confirma',
      action: { label: 'Revisar', to: '/documentos' },
    })
  }
  if (review.expenses > 0) {
    rest.push({
      key: 'review',
      icon: 'ph:sparkle',
      tone: 'brand',
      title: `${plural(review.expenses, 'gasto leído', 'gastos leídos')} por la IA por revisar`,
      detail: 'Comprueba importes y categoría; un toque y listo',
      action: { label: 'Revisar', to: '/gastos?estado=review&periodo=all' },
    })
  }

  if (bank!.n > 0) {
    rest.push({
      key: 'bank',
      icon: 'ph:piggy-bank',
      tone: 'info',
      title: `${plural(bank!.n, 'movimiento del banco', 'movimientos del banco')} por revisar`,
      detail: 'NUMIQ ya propone a qué corresponde cada uno',
      action: { label: 'Revisar', to: '/banco' },
    })
  }

  if (drafts!.n > 0) {
    rest.push({
      key: 'drafts',
      icon: 'ph:file-dashed',
      tone: 'brand',
      title: `${plural(drafts!.n, 'borrador de factura', 'borradores de factura')} sin emitir`,
      detail: 'Lo que no se emite no se cobra',
      action: { label: 'Ver', to: '/facturas?estado=draft' },
    })
  }

  if (quotes!.n > 0) {
    rest.push({
      key: 'quotes',
      icon: 'ph:file-text',
      tone: 'brand',
      title: `${plural(quotes!.n, 'presupuesto espera', 'presupuestos esperan')} respuesta`,
      detail: quotes!.n === 1 ? 'Enviado hace más de una semana' : 'Enviados hace más de una semana',
      action: { label: 'Ver', to: '/presupuestos?estado=open' },
    })
  }

  if (noFile!.n > 0) {
    rest.push({
      key: 'no-file',
      icon: 'ph:paperclip',
      tone: 'info',
      title: `${plural(noFile!.n, 'gasto', 'gastos')} del trimestre sin justificante`,
      detail: 'Sube la foto o el PDF: Hacienda puede pedirlo',
      action: { label: 'Ver', to: '/gastos?justificante=no&periodo=q' },
    })
  }

  return [...urgent, ...rest]
}
