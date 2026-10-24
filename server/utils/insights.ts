import { and, eq, isNotNull, lt, sql } from 'drizzle-orm'

export interface Insight {
  key: string
  severity: 'info' | 'success' | 'warning' | 'critical'
  icon: string
  title: string
  body: string
  actionLabel?: string
  actionUrl?: string
}

const eur = (n: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, useGrouping: 'always' }).format(n)

/**
 * Recomendaciones del asesor a partir de los datos de la empresa. Reglas deterministas (fiables y
 * gratis); la IA generativa las amplía con lectura de contexto en el asistente.
 */
export async function computeInsights(company: typeof tables.companies.$inferSelect, ctx: {
  quarter: Quarter
  year: number
  vat303: { result: number }
  irpf130: { result: number, netIncome: number }
  receivables: Awaited<ReturnType<typeof receivables>>
  monthly: Awaited<ReturnType<typeof monthlySeries>>
  top: Awaited<ReturnType<typeof topClients>>
  ytd: PeriodSummary
}): Promise<Insight[]> {
  const out: Insight[] = []
  const db = useDb()

  if (ctx.receivables.overdueCount > 0) {
    out.push({
      key: 'overdue',
      severity: ctx.receivables.overdueAmount > 3000 ? 'critical' : 'warning',
      icon: 'ph:clock-countdown',
      title: `${ctx.receivables.overdueCount} ${ctx.receivables.overdueCount === 1 ? 'factura vencida' : 'facturas vencidas'} sin cobrar`,
      body: `Tienes ${eur(ctx.receivables.overdueAmount)} pendientes fuera de plazo. Un recordatorio amable a tiempo cobra antes: la mayoría de impagos se resuelven en la primera semana.`,
      actionLabel: 'Ver vencidas',
      actionUrl: '/facturas?estado=overdue&anio=todos',
    })
  }

  const taxReserve = round2(Math.max(0, ctx.vat303.result) + (company.kind === 'autonomo' ? ctx.irpf130.result : 0))
  if (taxReserve > 0) {
    out.push({
      key: `reserve:${ctx.year}-${ctx.quarter}`,
      severity: 'info',
      icon: 'ph:piggy-bank',
      title: `Aparta ${eur(taxReserve)} para impuestos del ${ctx.quarter}T`,
      body: company.kind === 'autonomo'
        ? `${eur(Math.max(0, ctx.vat303.result))} de IVA (303) y ${eur(ctx.irpf130.result)} de IRPF (130) con lo facturado hasta hoy. Ese dinero no es tuyo: tenerlo separado evita sustos al presentar.`
        : `${eur(Math.max(0, ctx.vat303.result))} de IVA (303) con lo facturado hasta hoy.`,
      actionLabel: 'Ver impuestos',
      actionUrl: '/impuestos',
    })
  }

  // Dependencia de un cliente: más del 40 % de la facturación de los últimos 12 meses
  // El ranking de clientes viene con impuestos: se compara con la facturación total del mismo modo
  const total12 = ctx.monthly.reduce((a, m) => a + m.incomeTotal, 0)
  const top = ctx.top[0]
  if (top && total12 > 0 && top.amount / total12 > 0.4 && ctx.top.length > 1) {
    const share = Math.round(top.amount / total12 * 100)
    out.push({
      key: `concentration:${top.id}`,
      severity: share > 60 ? 'warning' : 'info',
      icon: 'ph:chart-pie-slice',
      title: `${top.name} supone el ${share} % de tu facturación`,
      body: share > 60 && company.kind === 'autonomo'
        ? 'Depender tanto de un cliente es un riesgo de negocio y, por encima del 75 %, podrías encajar como autónomo económicamente dependiente (TRADE).'
        : 'Diversificar clientes reduce el riesgo si uno se retrasa en los pagos o deja de contratar.',
    })
  }

  // Tendencia: últimos 3 meses frente a los 3 anteriores
  const last3 = ctx.monthly.slice(-3).reduce((a, m) => a + m.income, 0)
  const prev3 = ctx.monthly.slice(-6, -3).reduce((a, m) => a + m.income, 0)
  if (prev3 > 0) {
    const delta = (last3 - prev3) / prev3
    if (delta > 0.15) {
      out.push({ key: 'trend:up', severity: 'success', icon: 'ph:trend-up', title: `Facturación +${Math.round(delta * 100)} % en el último trimestre móvil`, body: `${eur(last3)} en los últimos 3 meses frente a ${eur(prev3)} en los 3 anteriores. Buen momento para revisar tarifas con los clientes más rentables.` })
    }
    else if (delta < -0.2) {
      out.push({ key: 'trend:down', severity: 'warning', icon: 'ph:trend-down', title: `Facturación ${Math.round(delta * 100)} % en el último trimestre móvil`, body: `${eur(last3)} frente a ${eur(prev3)}. Revisa presupuestos pendientes y clientes sin actividad reciente.`, actionLabel: 'Ver presupuestos', actionUrl: '/presupuestos' })
    }
  }

  if (company.kind === 'autonomo') {
    // Regla del 70 %: sin obligación de presentar el 130 si el año anterior ≥70 % de ingresos llevaron retención
    const prevYear = await periodSummary(company.id, `${ctx.year - 1}-01-01`, `${ctx.year - 1}-12-31`)
    if (prevYear.income > 0 && prevYear.incomeWithRetention / prevYear.income >= 0.7 && company.taxRegime !== 'modulos') {
      out.push({ key: `130-exempt:${ctx.year}`, severity: 'success', icon: 'ph:seal-check', title: 'Podrías no estar obligado al modelo 130', body: `El ${Math.round(prevYear.incomeWithRetention / prevYear.income * 100)} % de tus ingresos de ${ctx.year - 1} llevó retención de IRPF (mínimo 70 %). Si tu actividad es profesional, puedes dejar de presentar pagos fraccionados.` })
    }

    // Retención reducida del 7 % el año de alta y los dos siguientes
    if (company.activityStartDate && Number(company.defaultIrpfRate) > 7) {
      const startYear = Number(company.activityStartDate.slice(0, 4))
      if (ctx.year - startYear <= 2) {
        out.push({ key: 'irpf7', severity: 'info', icon: 'ph:percent', title: 'Puedes facturar con un 7 % de retención', body: `Como empezaste tu actividad en ${startYear}, hasta el 31/12/${startYear + 2} puedes aplicar un 7 % de IRPF en lugar del 15 %: cobras más cada mes. Tienes que comunicarlo a tus clientes por escrito.`, actionLabel: 'Ajustes fiscales', actionUrl: '/ajustes' })
      }
    }
  }

  // Borradores olvidados
  const threeDaysAgo = new Date()
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
  const [drafts] = await db.select({ n: sql<number>`COUNT(*)`.mapWith(Number) }).from(tables.salesDocuments)
    .where(and(eq(tables.salesDocuments.companyId, company.id), eq(tables.salesDocuments.kind, 'invoice'), eq(tables.salesDocuments.status, 'draft'), lt(tables.salesDocuments.createdAt, threeDaysAgo)))
  if (drafts!.n > 0) {
    out.push({ key: 'drafts', severity: 'info', icon: 'ph:file-dashed', title: `${drafts!.n} ${drafts!.n === 1 ? 'borrador de factura' : 'borradores de factura'} sin emitir`, body: 'Lo que no se emite no se cobra. Revísalos y emítelos o descártalos.', actionLabel: 'Ver borradores', actionUrl: '/facturas?estado=draft&anio=todos' })
  }

  // Movimientos del banco sin conciliar
  const [bank] = await db.select({ n: sql<number>`COUNT(*)`.mapWith(Number) }).from(tables.bankTransactions)
    .where(and(eq(tables.bankTransactions.companyId, company.id), eq(tables.bankTransactions.status, 'pending')))
  if (bank!.n > 0) {
    out.push({ key: `bank:${bank!.n}`, severity: 'info', icon: 'ph:piggy-bank', title: `${bank!.n} ${bank!.n === 1 ? 'movimiento del banco' : 'movimientos del banco'} por revisar`, body: 'Concilia el banco para saber qué está cobrado y pagado de verdad. NUMIQ ya te propone a qué corresponde cada uno.', actionLabel: 'Ir al banco', actionUrl: '/banco' })
  }

  // Margen del año
  if (ctx.ytd.income > 0) {
    const margin = (ctx.ytd.income - ctx.ytd.expenses) / ctx.ytd.income
    if (margin < 0.15) {
      out.push({ key: `margin:${ctx.year}`, severity: margin < 0 ? 'critical' : 'warning', icon: 'ph:scales', title: `Margen del ${Math.round(margin * 100)} % en ${ctx.year}`, body: 'Tus gastos se comen casi todo lo que facturas. Revisa suscripciones y gastos recurrentes, y los precios de tus servicios.', actionLabel: 'Ver gastos', actionUrl: '/gastos' })
    }
  }

  // Recurrentes que no se pudieron generar, emitir o enviar
  const failing = await db.select({ id: tables.recurrings.id, kind: tables.recurrings.kind, name: tables.recurrings.name, lastError: tables.recurrings.lastError }).from(tables.recurrings)
    .where(and(eq(tables.recurrings.companyId, company.id), isNotNull(tables.recurrings.lastError)))
    .limit(5)
  if (failing.length) {
    out.push({
      key: `recurring-error:${failing.map(f => f.id).join('-')}`,
      severity: 'warning',
      icon: 'ph:arrows-clockwise',
      title: failing.length === 1 ? `Recurrente con problemas: ${failing[0]!.name}` : `${failing.length} recurrentes con problemas`,
      body: failing.length === 1 ? failing[0]!.lastError! : failing.map(f => `${f.name}: ${f.lastError}`).join(' · '),
      actionLabel: failing.some(f => f.kind === 'invoice') ? 'Ver recurrentes' : 'Ver gastos fijos',
      actionUrl: failing.some(f => f.kind === 'invoice') ? '/recurrentes' : '/gastos/fijos',
    })
  }

  const order = { critical: 0, warning: 1, info: 2, success: 3 }
  return out.sort((a, b) => order[a.severity] - order[b.severity])
}
