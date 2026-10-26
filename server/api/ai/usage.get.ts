import { and, count, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { z } from 'zod'
import type { AiMoney, AiUsageReport, AiUsageTotals } from '../../../shared/utils/ai-usage'

const query = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  group: z.enum(['day', 'week', 'month']).default('day'),
  /** key: lo pagado con la clave de OpenAI de quien mira, en todas sus empresas; app: todas las empresas (solo el titular de la app) */
  scope: z.enum(['company', 'key', 'app']).default('company'),
})

const iso = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
const utc = (day: string) => new Date(`${day}T00:00:00Z`)
const addDays = (day: string, n: number) => iso(new Date(utc(day).getTime() + n * 86_400_000))
const monday = (day: string) => addDays(day, -((utc(day).getUTCDay() + 6) % 7))
const lastOfMonth = (ym: string) => iso(new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)))

const emptyTotals = (): AiUsageTotals => ({ usd: 0, eur: 0, calls: 0, input: 0, cached: 0, output: 0, reasoning: 0, estimatedUsd: 0, estimatedEur: 0, cutUsd: 0, cutEur: 0, errors: 0 })
function add(t: AiUsageTotals, r: AiUsageTotals) {
  for (const k of Object.keys(t) as Array<keyof AiUsageTotals>) t[k] += r[k]
  return t
}
const money = (usd: number, eur: number): AiMoney => ({ usd, eur })

/** Coste de la IA: totales, evolución por días, semanas o meses y desglose por categoría, tarea, modelo y usuario */
export default defineEventHandler(async (event): Promise<AiUsageReport> => {
  const { user, company, role } = await requireCompany(event, 'admin')
  const p = readQueryInput(event, query)
  const canSeeApp = canSeeAppAiCost(user, role)
  const app = p.scope === 'app' && canSeeApp
  const key = p.scope === 'key'
  const db = useDb()
  const u = tables.aiUsage
  await fillMissingRates().catch(() => {})
  const [me] = await db.select({ hint: tables.users.openaiKeyHint }).from(tables.users).where(eq(tables.users.id, user.id))
  const [keyed] = key ? await db.select({ at: sql<Date | null>`MIN(${u.createdAt})`.mapWith(u.createdAt) }).from(u).where(isNotNull(u.keyUserId)) : []
  // El registro exacto empezó a la vez para toda la instalación
  const [exact] = await db.select({ at: sql<Date | null>`MIN(${u.createdAt})`.mapWith(u.createdAt) }).from(u).where(eq(u.estimated, false))

  const today = madridDay()
  const rate = await usdPerEur(today)
  // Cada llamada se convierte con el cambio de su día; sin él, con el de hoy
  const eurOf = rate ? sql`${u.costUsd} / COALESCE(${u.usdPerEur}, ${rate})` : sql`${u.costUsd} / ${u.usdPerEur}`
  const sums = {
    usd: sql<string>`COALESCE(SUM(${u.costUsd}), 0)`,
    eur: sql<string>`COALESCE(SUM(${eurOf}), 0)`,
    calls: sql<string>`COUNT(*)`,
    input: sql<string>`COALESCE(SUM(${u.inputTokens}), 0)`,
    cached: sql<string>`COALESCE(SUM(${u.cachedTokens}), 0)`,
    output: sql<string>`COALESCE(SUM(${u.outputTokens}), 0)`,
    reasoning: sql<string>`COALESCE(SUM(${u.reasoningTokens}), 0)`,
    estimatedUsd: sql<string>`COALESCE(SUM(CASE WHEN ${u.estimated} THEN ${u.costUsd} ELSE 0 END), 0)`,
    estimatedEur: sql<string>`COALESCE(SUM(CASE WHEN ${u.estimated} THEN ${eurOf} ELSE 0 END), 0)`,
    // Estimadas sin resultado: respuestas cortadas a medias (las reconstruidas de antes del registro sí lo tuvieron)
    cutUsd: sql<string>`COALESCE(SUM(CASE WHEN ${u.estimated} AND NOT ${u.ok} THEN ${u.costUsd} ELSE 0 END), 0)`,
    cutEur: sql<string>`COALESCE(SUM(CASE WHEN ${u.estimated} AND NOT ${u.ok} THEN ${eurOf} ELSE 0 END), 0)`,
    errors: sql<string>`COALESCE(SUM(CASE WHEN ${u.ok} THEN 0 ELSE 1 END), 0)`,
  }
  const totalsOf = (r: Record<keyof AiUsageTotals, string | number>): AiUsageTotals => Object.fromEntries(Object.keys(sums).map(k => [k, Number(r[k as keyof AiUsageTotals]) || 0])) as unknown as AiUsageTotals

  const scope: SQL[] = app ? [] : key ? [eq(u.keyUserId, user.id)] : [eq(u.companyId, company.id)]
  const inPeriod = [...scope, ...(p.from ? [gte(u.day, p.from)] : []), ...(p.to ? [lte(u.day, p.to)] : [])]

  // Una fila por día, categoría, tarea, modelo, usuario y empresa: de ahí salen todos los desgloses
  const grouped = await db.select({ day: u.day, category: u.category, task: u.task, model: u.model, userId: u.userId, companyId: u.companyId, ...sums })
    .from(u).where(and(...inPeriod))
    .groupBy(u.day, u.category, u.task, u.model, u.userId, u.companyId)
  const rows = grouped.map(r => ({ ...r, model: r.model.replace(/-\d{4}-\d{2}-\d{2}$/, ''), t: totalsOf(r) }))

  const totals = rows.reduce((s, r) => add(s, r.t), emptyTotals())
  const by = <K extends string>(key: (r: typeof rows[number]) => K) => {
    const map = new Map<K, AiUsageTotals>()
    for (const r of rows) add(map.get(key(r)) ?? map.set(key(r), emptyTotals()).get(key(r))!, r.t)
    return [...map].map(([k, t]) => ({ key: k, ...t })).sort((a, b) => b.usd - a.usd)
  }

  // Evolución: todos los tramos del periodo, también los que no tienen consumo
  const first = rows.map(r => r.day).sort()[0]
  const from = p.from ?? first ?? today
  const to = p.to && p.to < today ? p.to : today
  const bucketOf = (day: string) => (p.group === 'month' ? day.slice(0, 7) : p.group === 'week' ? monday(day) : day)
  const series: AiUsageReport['series'] = []
  for (let k = bucketOf(from), guard = 0; k <= bucketOf(to) && guard < 800; guard++) {
    const start = p.group === 'month' ? `${k}-01` : k
    const end = p.group === 'month' ? lastOfMonth(k) : p.group === 'week' ? addDays(k, 6) : k
    series.push({ key: k, from: start < from ? from : start, to: end > to ? to : end, usd: 0, eur: 0, calls: 0, byCategory: {} })
    k = p.group === 'month' ? addDays(lastOfMonth(k), 1).slice(0, 7) : addDays(k, p.group === 'week' ? 7 : 1)
  }
  const slot = new Map(series.map(s => [s.key, s]))
  for (const r of rows) {
    const s = slot.get(bucketOf(r.day))
    if (!s) continue
    s.usd += r.t.usd
    s.eur += r.t.eur
    s.calls += r.t.calls
    const cat = s.byCategory[r.category] ??= { usd: 0, eur: 0 }
    cat.usd += r.t.usd
    cat.eur += r.t.eur
  }

  // Mismo número de días justo antes, para comparar
  let previous = emptyTotals()
  if (p.from && p.to) {
    const days = Math.round((utc(p.to).getTime() - utc(p.from).getTime()) / 86_400_000) + 1
    const [prev] = await db.select(sums).from(u).where(and(...scope, gte(u.day, addDays(p.from, -days)), lte(u.day, addDays(p.from, -1))))
    if (prev) previous = totalsOf(prev)
  }

  // Indicadores fijos (no dependen del periodo)
  const monthStart = `${today.slice(0, 7)}-01`
  const week = addDays(today, -6)
  const sumIf = (cond: SQL, col: SQL) => sql<string>`COALESCE(SUM(CASE WHEN ${cond} THEN ${col} ELSE 0 END), 0)`
  const [k] = await db.select({
    todayUsd: sumIf(sql`${u.day} = ${today}`, sql`${u.costUsd}`),
    todayEur: sumIf(sql`${u.day} = ${today}`, eurOf),
    weekUsd: sumIf(sql`${u.day} >= ${week}`, sql`${u.costUsd}`),
    weekEur: sumIf(sql`${u.day} >= ${week}`, eurOf),
    monthUsd: sumIf(sql`${u.day} >= ${monthStart}`, sql`${u.costUsd}`),
    monthEur: sumIf(sql`${u.day} >= ${monthStart}`, eurOf),
    allUsd: sql<string>`COALESCE(SUM(${u.costUsd}), 0)`,
    allEur: sql<string>`COALESCE(SUM(${eurOf}), 0)`,
    firstDay: sql<string | null>`DATE_FORMAT(MIN(${u.day}), '%Y-%m-%d')`,
  }).from(u).where(and(...scope))
  const n = (v: unknown) => Number(v) || 0
  // Previsión con el ritmo de los días con IA: si se empezó a usar este mes, desde ese día y no desde el 1
  const startDay = k?.firstDay && k.firstDay > monthStart ? Number(k.firstDay.slice(8, 10)) : 1
  const dayOfMonth = Number(today.slice(8, 10)) - startDay + 1
  const daysInMonth = Number(lastOfMonth(today.slice(0, 7)).slice(8, 10)) - startDay + 1

  // Coste por documento (sin contar la segunda lectura como otro documento) y por respuesta del asistente
  const pro = aiSettings().proModel
  const docRows = rows.filter(r => r.task === 'documentos')
  const docs = docRows.filter(r => !r.model.startsWith(pro) || pro === aiSettings().model).reduce((s, r) => s + r.t.calls, 0)
  const docCost = docRows.reduce((s, r) => add(s, r.t), emptyTotals())
  const m = tables.aiMessages
  const c = tables.aiConversations
  const userIds = [...new Set(rows.map(r => r.userId).filter((x): x is number => x != null))]
  const companyIds = [...new Set(rows.map(r => r.companyId).filter((x): x is number => x != null))]
  // Con la clave propia, las respuestas de las empresas donde se usó, desde que se guarda la clave de cada llamada
  const chatScope = app
    ? []
    : key
      ? [companyIds.length ? inArray(c.companyId, companyIds) : sql`FALSE`, ...(keyed?.at ? [gte(m.createdAt, new Date(keyed.at))] : [])]
      : [eq(c.companyId, company.id)]
  const [answers] = await db.select({ n: count() }).from(m).innerJoin(c, eq(c.id, m.conversationId))
    .where(and(eq(m.role, 'assistant'), ...chatScope, ...(p.from ? [sql`DATE(${m.createdAt}) >= ${p.from}`] : []), ...(p.to ? [sql`DATE(${m.createdAt}) <= ${p.to}`] : [])))
  const chat = rows.filter(r => r.task === 'asistente').reduce((s, r) => add(s, r.t), emptyTotals())

  // Nombres de usuarios y empresas
  const byCompany = app || key
  const names = new Map((userIds.length ? await db.select({ id: tables.users.id, name: tables.users.name }).from(tables.users).where(inArray(tables.users.id, userIds)) : []).map(x => [x.id, x.name]))
  const companyNames = new Map((byCompany && companyIds.length ? await db.select({ id: tables.companies.id, name: sql<string>`COALESCE(${tables.companies.tradeName}, ${tables.companies.legalName})` }).from(tables.companies).where(inArray(tables.companies.id, companyIds)) : []).map(x => [x.id, x.name]))

  const recent = await db.select({
    id: u.id, at: u.createdAt, category: u.category, task: u.task, model: u.model, input: u.inputTokens, cached: u.cachedTokens, output: u.outputTokens, reasoning: u.reasoningTokens,
    usd: u.costUsd, eur: sql<string>`${eurOf}`, ms: u.ms, ok: u.ok, estimated: u.estimated, user: tables.users.name,
  }).from(u).leftJoin(tables.users, eq(tables.users.id, u.userId))
    .where(and(...inPeriod)).orderBy(desc(u.createdAt), desc(u.id)).limit(60)

  return {
    scope: app ? 'app' : key ? 'key' : 'company',
    canSeeApp,
    keyHint: me?.hint ?? null,
    keySince: keyed?.at ? new Date(keyed.at).toISOString() : null,
    from,
    to,
    group: p.group,
    usdPerEur: rate,
    totals,
    previous,
    series,
    categories: by(r => r.category),
    tasks: by(r => `${r.category}|${r.task}` as string).map(x => ({ ...x, category: x.key.split('|')[0]!, task: x.key.split('|')[1]! })),
    models: by(r => r.model),
    users: by(r => String(r.userId ?? '')).map(x => ({ ...x, name: x.key ? names.get(Number(x.key)) ?? 'Usuario eliminado' : 'Procesos automáticos' })),
    companies: byCompany ? by(r => String(r.companyId ?? '')).map(x => ({ ...x, name: x.key ? companyNames.get(Number(x.key)) ?? 'Empresa eliminada' : 'Sin empresa' })) : [],
    recent: recent.map(r => ({ ...r, at: new Date(r.at).toISOString(), usd: n(r.usd), eur: n(r.eur), user: r.user ?? null })),
    kpis: {
      today: money(n(k?.todayUsd), n(k?.todayEur)),
      last7: money(n(k?.weekUsd), n(k?.weekEur)),
      month: money(n(k?.monthUsd), n(k?.monthEur)),
      monthProjection: money(n(k?.monthUsd) / dayOfMonth * daysInMonth, n(k?.monthEur) / dayOfMonth * daysInMonth),
      allTime: money(n(k?.allUsd), n(k?.allEur)),
      perDocument: docs ? money(docCost.usd / docs, docCost.eur / docs) : null,
      perAnswer: answers?.n ? money(chat.usd / answers.n, chat.eur / answers.n) : null,
      cacheRate: totals.input ? totals.cached / totals.input : null,
    },
    exactSince: exact?.at ? new Date(exact.at).toISOString() : null,
    // Tarifas de los modelos configurados y de los que aparecen en el periodo
    prices: [...new Set([aiSettings().model, aiSettings().proModel, String(useRuntimeConfig().openaiChatModel || 'gpt-5.5'), ...rows.map(r => r.model)])]
      .map(model => ({ model, ...priceFor(model) }))
      .filter((x): x is { model: string, input: number, cached: number, output: number } => x.input != null)
      .map(({ model, input, cached, output }) => ({ model, input, cached, output })),
  }
})
