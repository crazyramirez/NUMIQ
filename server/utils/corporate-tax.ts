import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

/**
 * Impuesto sobre Sociedades de las SL: estimación del año (modelo 200) y pagos fraccionados (modelo 202).
 * Tipos de gravamen por ejercicio según la Ley 7/2024 (art. 29 y DT 44ª LIS) y pagos fraccionados del
 * art. 40 LIS. Es una estimación con lo registrado en NUMIQ: sin ajustes extracontables, amortizaciones,
 * reserva de capitalización ni deducciones, que añade la contabilidad.
 */

type Company = typeof tables.companies.$inferSelect
export type CorporateSize = 'micro' | 'erd' | 'general'

export const corporateSettingsSchema = z.object({
  /** Tamaño para el tipo: automático según la cifra de negocios del año anterior */
  size: z.enum(['auto', 'micro', 'erd', 'general']).default('auto'),
  /** Nueva creación: 15 % el primer ejercicio con base positiva y el siguiente */
  newEntity: z.boolean().default(false),
  /** Entidad patrimonial: siempre al 25 %, sin tipos reducidos */
  patrimonial: z.boolean().default(false),
  /** Pago fraccionado: sobre la cuota del último IS (art. 40.2) o sobre la base del año (art. 40.3) */
  method: z.enum(['cuota', 'base']).default('cuota'),
  /** Art. 40.2: cuota íntegra del último IS presentado menos deducciones, bonificaciones, retenciones e ingresos a cuenta */
  lastQuota: z.number().finite().min(0).nullable().default(null),
  /** Bases imponibles negativas de ejercicios anteriores pendientes de compensar */
  pendingLosses: z.number().finite().min(0).default(0),
})
export type CorporateSettings = z.infer<typeof corporateSettingsSchema>

export function corporateSettings(company: Pick<Company, 'settings'>): CorporateSettings {
  const parsed = corporateSettingsSchema.safeParse((company.settings as { corporateTax?: unknown } | null)?.corporateTax ?? {})
  return parsed.success ? parsed.data : corporateSettingsSchema.parse({})
}

export interface Bracket { upTo: number | null, rate: number }

/** Tipos de gravamen del periodo que empieza en `year` (por tramos de base imponible) */
export function corporateBrackets(year: number, size: CorporateSize, s: Pick<CorporateSettings, 'newEntity' | 'patrimonial'>): Bracket[] {
  const flat = (rate: number): Bracket[] => [{ upTo: null, rate }]
  if (s.patrimonial) return flat(25)
  if (s.newEntity) return flat(15)
  if (size === 'micro') {
    if (year >= 2027) return [{ upTo: 50_000, rate: 17 }, { upTo: null, rate: 20 }]
    if (year === 2026) return [{ upTo: 50_000, rate: 19 }, { upTo: null, rate: 21 }]
    if (year === 2025) return [{ upTo: 50_000, rate: 21 }, { upTo: null, rate: 22 }]
    return flat(year >= 2023 ? 23 : 25)
  }
  if (size === 'erd') {
    const byYear: Record<number, number> = { 2025: 24, 2026: 23, 2027: 22, 2028: 21 }
    return flat(year >= 2029 ? 20 : byYear[year] ?? 25)
  }
  return flat(25)
}

/** Reparte la base entre los tramos y calcula la cuota de cada uno */
export function applyBrackets(base: number, brackets: Bracket[]) {
  let rest = Math.max(0, base)
  let floor = 0
  return brackets
    .map((b) => {
      const span = b.upTo == null ? rest : Math.min(rest, b.upTo - floor)
      rest = round2(rest - span)
      floor = b.upTo ?? floor
      return { upTo: b.upTo, rate: b.rate, base: round2(span), amount: round2(span * b.rate / 100) }
    })
    .filter((x, i) => i === 0 || x.base > 0)
}

/** Art. 40.3: 5/7 del tipo redondeado por defecto; con cifra de negocios ≥ 10 M €, 19/20 redondeado por exceso */
const paymentRate = (rate: number, big: boolean) => (big ? Math.ceil(rate * 19 / 20 - 1e-9) : Math.floor(rate * 5 / 7 + 1e-9))

/** Compensación de bases negativas (art. 26): hasta 1 M € siempre y el 70 % de la base por encima */
function compensate(base: number, pending: number) {
  if (base <= 0 || pending <= 0) return 0
  return round2(Math.min(pending, base, Math.max(1_000_000, base * 0.7)))
}

const PAYMENT_END: Record<1 | 2 | 3, string> = { 1: '03-31', 2: '09-30', 3: '11-30' }
const PAYMENT_MONTHS: Record<1 | 2 | 3, number> = { 1: 3, 2: 9, 3: 11 }

interface Context {
  companyId: number
  year: number
  size: CorporateSize
  big: boolean
  method: 'cuota' | 'base'
  settings: CorporateSettings
}

async function context(company: Company, year: number): Promise<Context & { prevTurnover: number, autoSize: CorporateSize }> {
  const settings = corporateSettings(company)
  const prev = await periodSummary(company.id, `${year - 1}-01-01`, `${year - 1}-12-31`)
  const autoSize: CorporateSize = prev.income < 1_000_000 ? 'micro' : prev.income < 10_000_000 ? 'erd' : 'general'
  return {
    companyId: company.id,
    year,
    settings,
    prevTurnover: prev.income,
    autoSize,
    size: settings.size === 'auto' ? autoSize : settings.size,
    big: prev.income >= 10_000_000,
    // Con más de 6 M € de cifra de negocios la modalidad de base es obligatoria
    method: prev.income > 6_000_000 ? 'base' : settings.method,
  }
}

/** Pago fraccionado n.º `n` (1P abril, 2P octubre, 3P diciembre) */
async function payment202(ctx: Context, n: 1 | 2 | 3, previousPaid: number) {
  const { year } = ctx
  const to = `${year}-${PAYMENT_END[n]}`
  const deadline = deadlinesForYear(year, 'sociedad').find(d => d.models.includes('202') && d.period === `${n}P ${year}`)
  const common = { n, period: `${n}P`, from: `${year}-01-01`, to, months: PAYMENT_MONTHS[n], dueDate: deadline?.end ?? null, method: ctx.method }
  if (ctx.method === 'cuota') {
    const quota = ctx.settings.lastQuota
    return { ...common, lastQuota: quota, needsQuota: quota == null, amount: quota && quota > 0 ? round2(quota * 0.18) : 0, result: null, compensation: 0, base: null, lines: [], withheld: 0, previousPaid: 0 }
  }
  const p = await periodSummary(ctx.companyId, `${year}-01-01`, to)
  const result = round2(p.income - p.deductibleExpenses)
  const compensation = compensate(result, ctx.settings.pendingLosses)
  const base = Math.max(0, round2(result - compensation))
  const lines = applyBrackets(base, corporateBrackets(year, ctx.size, ctx.settings).map(b => ({ ...b, rate: paymentRate(b.rate, ctx.big) })))
  const gross = round2(lines.reduce((s, l) => s + l.amount, 0))
  const amount = Math.max(0, round2(gross - p.irpfWithheld - previousPaid))
  return { ...common, lastQuota: null, needsQuota: false, amount, result, compensation, base, lines, withheld: p.irpfWithheld, previousPaid }
}

/** Estimación del Impuesto sobre Sociedades del año y sus tres pagos fraccionados */
export async function corporateEstimate(company: Company, year: number) {
  const ctx = await context(company, year)
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const today = toISODate(new Date())
  const [p, filings] = await Promise.all([
    periodSummary(company.id, from, to),
    useDb().select().from(tables.taxFilings).where(and(
      eq(tables.taxFilings.companyId, company.id),
      eq(tables.taxFilings.year, year),
      eq(tables.taxFilings.model, '202'),
      inArray(tables.taxFilings.status, ['filed', 'paid']),
    )),
  ])

  // Pagos fraccionados: lo presentado manda sobre lo calculado
  const payments = []
  let paid = 0
  for (const n of [1, 2, 3] as const) {
    const pay = await payment202(ctx, n, paid)
    const filing = filings.find(f => f.period === `${n}P`) ?? null
    const amount = filing ? Number(filing.result) : pay.amount
    payments.push({ ...pay, amount, estimated: pay.amount, filed: !!filing, started: today > pay.to })
    paid = round2(paid + amount)
  }

  const brackets = corporateBrackets(year, ctx.size, ctx.settings)
  const result = round2(p.income - p.deductibleExpenses)
  const compensation = compensate(result, ctx.settings.pendingLosses)
  const base = Math.max(0, round2(result - compensation))
  const lines = applyBrackets(base, brackets)
  const quota = round2(lines.reduce((s, l) => s + l.amount, 0))
  const deadline = deadlinesForYear(year + 1, 'sociedad').find(d => d.models.includes('200') && d.period === `${year}`)

  return {
    year,
    partial: today >= from && today <= to,
    settings: ctx.settings,
    size: ctx.size,
    autoSize: ctx.autoSize,
    prevTurnover: ctx.prevTurnover,
    method: ctx.method,
    methodForced: ctx.method !== ctx.settings.method,
    brackets,
    income: p.income,
    expenses: p.deductibleExpenses,
    result,
    compensation,
    base,
    lines,
    quota,
    /** Sobre el resultado: incluye el efecto de compensar bases negativas */
    effectiveRate: result > 0 ? round2(quota / result * 100) : 0,
    withheld: p.irpfWithheld,
    payments,
    paid,
    due: round2(quota - p.irpfWithheld - paid),
    dueDate: deadline?.end ?? null,
  }
}

export type CorporateEstimate = Awaited<ReturnType<typeof corporateEstimate>>

const pctText = (n: number) => `${n.toLocaleString('es-ES', { maximumFractionDigits: 2 })} %`
const bracketLabel = (l: { upTo: number | null, rate: number }, i: number, many: boolean) =>
  many ? (l.upTo != null ? `hasta 50.000 € al ${pctText(l.rate)}` : `resto al ${pctText(l.rate)}`) : `al ${pctText(l.rate)}`

/** Borrador del 202 (pago `n`) o del 200 para la presentación guiada */
export async function corporateDraft(company: Company, model: '200' | '202', year: number, n?: 1 | 2 | 3): Promise<ModelDraft> {
  if (company.kind !== 'sociedad') throw createError({ statusCode: 400, statusMessage: 'El Impuesto sobre Sociedades es para sociedades' })
  const est = await corporateEstimate(company, year)
  const many = est.lines.length > 1 || est.brackets.length > 1

  if (model === '202') {
    const pay = est.payments[(n ?? 1) - 1]!
    const boxes: ModelBox[] = pay.method === 'cuota'
      ? [
          { box: '', label: 'Modalidad', value: 'Art. 40.2 LIS · sobre la cuota del último IS' },
          { box: '', label: 'Base: cuota del último IS presentado, minorada', value: pay.lastQuota ?? 0 },
          { box: '', label: 'Porcentaje %', value: 18 },
          { box: '', label: 'Resultado a ingresar', value: pay.estimated, strong: true },
        ]
      : [
          { box: '', label: 'Modalidad', value: 'Art. 40.3 LIS · sobre la base del año' },
          { box: '', label: `Resultado de los ${pay.months} primeros meses`, value: pay.result ?? 0 },
          ...(pay.compensation ? [{ box: '', label: 'Compensación de bases negativas', value: -pay.compensation }] : []),
          { box: '', label: 'Base del pago fraccionado', value: pay.base ?? 0, strong: true },
          ...pay.lines.flatMap((l, i) => [
            { box: '', label: `Base ${bracketLabel(l, i, pay.lines.length > 1)}`, value: l.base },
            { box: '', label: `Cuota ${bracketLabel(l, i, pay.lines.length > 1)}`, value: l.amount },
          ]),
          ...(pay.withheld ? [{ box: '', label: 'Retenciones e ingresos a cuenta', value: -pay.withheld }] : []),
          ...(pay.previousPaid ? [{ box: '', label: 'Pagos fraccionados anteriores del ejercicio', value: -pay.previousPaid }] : []),
          { box: '', label: 'Resultado a ingresar', value: pay.estimated, strong: true },
        ]
    return {
      model: '202',
      title: 'Impuesto sobre Sociedades. Pago fraccionado',
      year,
      quarter: null,
      period: pay.period,
      from: pay.from,
      to: pay.to,
      boxes,
      result: pay.estimated,
      outcome: pay.estimated > 0.005 ? 'ingresar' : 'cero',
      dueDate: pay.dueDate,
      presentUrl: 'https://sede.agenciatributaria.gob.es/Sede/procedimientoini/GE00.shtml',
      infoUrl: 'https://sede.agenciatributaria.gob.es/Sede/procedimientos/GE00.shtml',
      notes: [
        ...(pay.needsQuota ? ['Indica en «Ajustes de Sociedades» la cuota de tu último Impuesto sobre Sociedades presentado: sin ella no se puede calcular esta modalidad.'] : []),
        ...(pay.method === 'cuota'
          ? ['Es el 18 % de la cuota íntegra de tu último IS presentado, menos sus deducciones, bonificaciones, retenciones e ingresos a cuenta. Los tres pagos del año salen iguales.']
          : [`Se calcula con lo facturado y los gastos deducibles de enero a ${['marzo', 'septiembre', 'noviembre'][(n ?? 1) - 1]}.`, ...(pay.lines.length > 1 ? ['El tramo de 50.000 € se aplica entero, sin prorratear por meses. Algunos asesores lo prorratean: consúltalo con tu gestor si dudas.'] : [])]),
        ...(est.methodForced ? ['Tu cifra de negocios del año anterior supera 6 M €: la modalidad sobre la base es obligatoria.'] : []),
        ...(pay.estimated > 0.005 ? [] : ['Si sale cero no tienes que presentarlo, salvo que tu cifra de negocios supere 6 M €.']),
      ],
    }
  }

  const boxes: ModelBox[] = [
    { box: '', label: 'Ingresos del ejercicio', value: est.income },
    { box: '', label: 'Gastos deducibles', value: -est.expenses },
    { box: '', label: 'Resultado antes de impuestos', value: est.result, strong: true },
    ...(est.compensation ? [{ box: '', label: 'Compensación de bases imponibles negativas', value: -est.compensation }] : []),
    { box: '', label: 'Base imponible', value: est.base, strong: true },
    ...est.lines.flatMap((l, i) => [
      { box: '', label: `Base ${bracketLabel(l, i, many)}`, value: l.base },
      { box: '', label: `Cuota ${bracketLabel(l, i, many)}`, value: l.amount },
    ]),
    { box: '', label: 'Cuota íntegra', value: est.quota, strong: true },
    ...(est.withheld ? [{ box: '', label: 'Retenciones e ingresos a cuenta', value: -est.withheld }] : []),
    ...(est.paid ? [{ box: '', label: 'Pagos fraccionados (202)', value: -est.paid }] : []),
    { box: '', label: est.due >= 0 ? 'Cuota diferencial a ingresar' : 'Cuota diferencial a devolver', value: est.due, strong: true },
  ]
  return {
    model: '200',
    title: 'Impuesto sobre Sociedades. Declaración anual',
    year,
    quarter: null,
    period: '0A',
    from: `${year}-01-01`,
    to: `${year}-12-31`,
    boxes,
    result: est.due,
    outcome: Math.abs(est.due) < 0.005 ? 'cero' : est.due > 0 ? 'ingresar' : 'devolver',
    dueDate: est.dueDate,
    presentUrl: 'https://sede.agenciatributaria.gob.es/Sede/impuesto-sobre-sociedades.html',
    infoUrl: 'https://sede.agenciatributaria.gob.es/Sede/impuesto-sobre-sociedades.html',
    notes: [
      ...(est.partial ? ['El ejercicio aún no ha terminado: es una estimación con lo registrado hasta hoy.'] : []),
      'Estimación con tus facturas y gastos deducibles. No incluye ajustes extracontables (multas, donativos, gastos no deducibles), amortizaciones de inversiones, reserva de capitalización ni deducciones: tu gestor los añade con la contabilidad.',
      'El modelo 200 se presenta con las cuentas anuales (balance y pérdidas y ganancias) en los 25 días naturales siguientes a los 6 meses del cierre: en julio si tu ejercicio es el año natural.',
    ],
  }
}
