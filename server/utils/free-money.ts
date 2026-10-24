import { and, eq, inArray } from 'drizzle-orm'

type Company = typeof tables.companies.$inferSelect

export interface FreeMoney {
  /** Saldo de las cuentas con extracto importado */
  bank: number
  bankAt: string | null
  accounts: number
  /** Impuestos que ya debes aunque aún no toque pagarlos */
  taxes: { amount: number, items: Array<{ label: string, amount: number }> }
  /** Gastos registrados sin pagar */
  payables: number
  /** Lo que de verdad es tuyo: banco − impuestos − pagos pendientes */
  free: number
  /** Por cobrar (no cuenta en «libre» hasta que entre) */
  receivables: number
}

/**
 * «Dinero libre de verdad»: el saldo del banco no es todo tuyo. Parte es IVA y retenciones que has
 * cobrado para Hacienda, y parte son facturas que aún tienes que pagar.
 */
export async function freeMoney(company: Company, now = new Date()): Promise<FreeMoney | null> {
  const db = useDb()
  const accounts = await db.select({ balance: tables.bankAccounts.balance, balanceAt: tables.bankAccounts.balanceAt })
    .from(tables.bankAccounts).where(eq(tables.bankAccounts.companyId, company.id))
  const withBalance = accounts.filter(a => a.balance != null)
  if (!withBalance.length) return null

  const year = now.getFullYear()
  const q = quarterOf(now)
  const kind = company.kind === 'sociedad' ? 'sociedad' : 'autonomo'
  const today = toISODate(now)
  const items: Array<{ label: string, amount: number }> = []

  // Trimestre en curso: lo devengado hasta hoy
  const addQuarter = async (y: number, quarter: Quarter, suffix: string, skip: Set<string>) => {
    const { from, to } = quarterRange(y, quarter)
    const [vat, irpf, wh] = await Promise.all([
      estimate303(company.id, y, quarter),
      kind === 'autonomo' && company.taxRegime !== 'modulos' ? estimate130(company.id, y, quarter) : null,
      withholdings(company.id, from, to),
    ])
    const push = (model: string, label: string, amount: number) => {
      if (!skip.has(model) && amount > 0) items.push({ label: `${label} ${suffix}`, amount: round2(amount) })
    }
    push('303', 'IVA', vat.result)
    if (irpf) push('130', 'IRPF', irpf.result)
    push('111', 'Retenciones', wh.m111.result)
    push('115', 'Alquiler', wh.m115.result)
  }
  await addQuarter(year, q, `${q}T`, new Set())

  // Trimestre anterior: si su plazo sigue abierto, lo que no esté marcado como pagado
  const prevQ = (q === 1 ? 4 : q - 1) as Quarter
  const prevYear = q === 1 ? year - 1 : year
  const due = deadlinesForYear(prevQ === 4 ? prevYear + 1 : prevYear, kind).find(d => d.period === `${prevQ}T ${prevYear}`)?.end
  if (due && today <= due) {
    const paid = await db.select({ model: tables.taxFilings.model }).from(tables.taxFilings)
      .where(and(eq(tables.taxFilings.companyId, company.id), eq(tables.taxFilings.year, prevYear), eq(tables.taxFilings.period, `${prevQ}T`), inArray(tables.taxFilings.status, ['paid'])))
    await addQuarter(prevYear, prevQ, `${prevQ}T`, new Set(paid.map(p => p.model)))
  }

  const [pay, recv] = await Promise.all([payables(company.id), receivables(company.id)])
  const bank = round2(withBalance.reduce((s, a) => s + Number(a.balance), 0))
  const taxes = round2(items.reduce((s, i) => s + i.amount, 0))
  const latest = withBalance.map(a => a.balanceAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0]
  return {
    bank,
    bankAt: latest ? toISODate(latest) : null,
    accounts: withBalance.length,
    taxes: { amount: taxes, items },
    payables: pay.amount,
    free: round2(bank - taxes - pay.amount),
    receivables: recv.amount,
  }
}
