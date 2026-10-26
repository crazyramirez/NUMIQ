import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { AiCategory } from '../../shared/utils/ai-usage'
import type { AiKey } from './ai-key'

/**
 * Registro del consumo de IA: cada petición a OpenAI guarda sus tokens reales (entrada, caché, salida y
 * razonamiento) y su coste con la tarifa oficial. La empresa y el usuario salen de la petición en curso
 * (requireCompany los deja en el contexto), también para el trabajo que sigue en segundo plano.
 */

interface AiScope { companyId: number | null, userId: number | null, path: string, key: Promise<AiKey | null> | null }

export function setAiScope(event: H3Event, companyId: number, userId: number) {
  event.context.aiScope = { companyId, userId }
}

function currentScope(): AiScope {
  try {
    const event = useEvent()
    const s = event.context.aiScope as { companyId: number, userId: number } | undefined
    return { companyId: s?.companyId ?? null, userId: s?.userId ?? null, path: event.path ?? '', key: currentAiKey() }
  }
  catch {
    return { companyId: null, userId: null, path: '', key: null }
  }
}

/** Categoría por la tarea; las lecturas de documentos, por la pantalla desde la que se pidieron */
export function aiCategoryFor(task: string, path: string): AiCategory {
  if (task === 'asistente') return 'asistente'
  if (task.startsWith('bank_')) return 'banco'
  if (task.includes('contact')) return 'contactos'
  if (task === 'justificante') return 'impuestos'
  if (path.startsWith('/api/ai/read')) return 'escaneo'
  if (path.startsWith('/api/mail')) return 'correo'
  if (path.startsWith('/api/imports')) return 'importacion'
  if (path.startsWith('/api/bank')) return 'banco'
  if (path.startsWith('/api/contacts')) return 'contactos'
  if (path.startsWith('/api/assistant')) return 'asistente'
  return task === 'documentos' || task === 'hojas' ? 'importacion' : 'otros'
}

/** Uso que devuelve la Responses API */
export interface OpenAiUsage {
  input_tokens?: number
  output_tokens?: number
  input_tokens_details?: { cached_tokens?: number, cache_write_tokens?: number }
  output_tokens_details?: { reasoning_tokens?: number }
}

const madridDayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' })
export const madridDay = (d = new Date()) => madridDayFmt.format(d)

/** Último cambio guardado, por si el BCE no responde */
async function lastKnownRate() {
  const [row] = await useDb().select({ r: tables.aiUsage.usdPerEur }).from(tables.aiUsage)
    .where(isNotNull(tables.aiUsage.usdPerEur)).orderBy(desc(tables.aiUsage.id)).limit(1)
  return row?.r ?? null
}

/**
 * Guarda una petición facturada. Nunca falla ni retrasa la respuesta: se escribe en segundo plano.
 * `model` es el que devuelve la API (versión fechada), que es el que se cobra.
 */
export function recordAiUsage(entry: { task: string, model: string, usage: OpenAiUsage | null | undefined, tier?: string | null, ms: number, ok: boolean, estimated?: boolean }) {
  const u = entry.usage
  if (!u || !(u.input_tokens || u.output_tokens)) return
  const scope = currentScope()
  const tokens = {
    input: u.input_tokens ?? 0,
    cached: u.input_tokens_details?.cached_tokens ?? 0,
    cacheWrite: u.input_tokens_details?.cache_write_tokens ?? 0,
    output: u.output_tokens ?? 0,
  }
  const day = madridDay()
  void (async () => {
    if (!knownModel(entry.model)) console.warn(`[ai] Sin tarifa para ${entry.model}: añádela en NUXT_OPENAI_PRICES`)
    const key = await scope.key?.catch(() => null)
    const rate = await usdPerEur(day) ?? await lastKnownRate()
    await useDb().insert(tables.aiUsage).values({
      companyId: scope.companyId,
      userId: scope.userId,
      day,
      category: aiCategoryFor(entry.task, scope.path),
      task: entry.task.slice(0, 60),
      model: entry.model.slice(0, 80),
      serviceTier: entry.tier?.slice(0, 20) ?? null,
      inputTokens: tokens.input,
      cachedTokens: tokens.cached,
      cacheWriteTokens: tokens.cacheWrite,
      outputTokens: tokens.output,
      reasoningTokens: u.output_tokens_details?.reasoning_tokens ?? 0,
      costUsd: aiCostUsd(entry.model, tokens, entry.tier),
      usdPerEur: rate,
      ms: Math.round(entry.ms),
      ok: entry.ok,
      estimated: entry.estimated ?? false,
      keyUserId: key?.userId ?? null,
      keyHint: key?.hint ?? null,
    })
  })().catch(err => console.error('[ai] No se pudo registrar el consumo:', err))
}

/**
 * Petición cortada a medias (el usuario cerró el chat o cambió de app): OpenAI cobra lo que ya había
 * procesado pero no llega a devolver el uso. Quien llama estima los tokens.
 */
export function recordCutAiUsage(entry: { task: string, model: string, input: number, cached: number, output: number, ms: number }) {
  recordAiUsage({
    task: entry.task,
    model: entry.model,
    usage: { input_tokens: entry.input, input_tokens_details: { cached_tokens: entry.cached }, output_tokens: entry.output },
    ms: entry.ms,
    ok: false,
    estimated: true,
  })
}

// ─── Lecturas anteriores al registro: coste estimado ─────────────────────────

/** Caracteres por token en español (texto y JSON), para lo que no guardó sus tokens */
const CHARS_PER_TOKEN = 3.6
const toks = (chars: number) => Math.round(chars / CHARS_PER_TOKEN)

type UsageInsert = typeof tables.aiUsage.$inferInsert

function estimatedRow(r: Omit<UsageInsert, 'costUsd' | 'estimated' | 'ok'>): UsageInsert {
  return { ...r, ok: true, estimated: true, costUsd: aiCostUsd(r.model, { input: r.inputTokens ?? 0, cached: r.cachedTokens ?? 0, output: r.outputTokens ?? 0 }) }
}

/**
 * Reconstruye una vez el gasto de antes de este registro:
 * - Documentos leídos (escaneos, importaciones, correo): tokens reales guardados con cada archivo. Si la
 *   lectura acabó en el modelo avanzado, sus tokens suman las dos lecturas: se reparten a medias.
 * - Respuestas del asistente: tokens estimados por la longitud de las instrucciones, las herramientas, la
 *   conversación y la respuesta.
 * - Propuestas del banco hechas con IA: tokens estimados por movimiento, en peticiones de 60.
 * Solo cuenta lo anterior a la primera llamada registrada, para no contar nada dos veces.
 */
export async function backfillAiUsage() {
  const db = useDb()
  const u = tables.aiUsage
  const [done] = await db.select({ id: u.id }).from(u).where(eq(u.estimated, true)).limit(1)
  if (done) return 0
  const [first] = await db.select({ at: sql<Date | null>`MIN(${u.createdAt})`.mapWith(u.createdAt) }).from(u)
  const cutoff = first?.at ? new Date(first.at) : new Date()
  const s = aiSettings()
  const rows: UsageInsert[] = []

  // Documentos
  const f = tables.files
  const files = await db.select({
    companyId: f.companyId,
    kind: f.kind,
    userId: f.uploadedBy,
    createdAt: f.createdAt,
    source: tables.importBatches.source,
    model: sql<string | null>`JSON_VALUE(${f.aiResult}, '$.model')`,
    input: sql<number | null>`JSON_VALUE(${f.aiResult}, '$.tokens.input')`,
    output: sql<number | null>`JSON_VALUE(${f.aiResult}, '$.tokens.output')`,
    ms: sql<number | null>`JSON_VALUE(${f.aiResult}, '$.ms')`,
    sheet: sql<number>`JSON_EXTRACT(${f.aiResult}, '$.sheet') IS NOT NULL`,
  }).from(f)
    .leftJoin(tables.importBatches, eq(tables.importBatches.id, f.batchId))
    .where(and(isNotNull(f.aiResult), lt(f.createdAt, cutoff)))
  for (const file of files) {
    const input = Number(file.input) || 0
    const output = Number(file.output) || 0
    if (!file.model || !(input || output)) continue
    const base = {
      companyId: file.companyId,
      userId: file.userId,
      day: madridDay(new Date(file.createdAt)),
      category: file.kind === 'scan' ? 'escaneo' : file.source === 'email' ? 'correo' : 'importacion',
      task: Number(file.sheet) ? 'hojas' : 'documentos',
      ms: Math.round(Number(file.ms) || 0),
      createdAt: new Date(file.createdAt),
    }
    if (file.model === s.proModel && s.model !== s.proModel) {
      const half = (n: number) => Math.round(n / 2)
      rows.push(estimatedRow({ ...base, model: s.model, inputTokens: half(input), outputTokens: half(output) }))
      rows.push(estimatedRow({ ...base, model: s.proModel, inputTokens: input - half(input), outputTokens: output - half(output), ms: 0 }))
    }
    else {
      rows.push(estimatedRow({ ...base, model: file.model, inputTokens: input, outputTokens: output }))
    }
  }

  // Asistente
  const m = tables.aiMessages
  const c = tables.aiConversations
  const msgs = await db.select({ id: m.id, conversationId: m.conversationId, role: m.role, len: sql<number>`CHAR_LENGTH(${m.content})`, tools: m.tools, model: m.model, createdAt: m.createdAt, companyId: c.companyId, userId: c.userId })
    .from(m).innerJoin(c, eq(c.id, m.conversationId))
    .where(lt(m.createdAt, cutoff))
    .orderBy(m.conversationId, m.id)
  if (msgs.some(x => x.role === 'assistant')) {
    const companyIds = [...new Set(msgs.map(x => x.companyId))]
    const companies = await db.select().from(tables.companies).where(inArray(tables.companies.id, companyIds))
    const prefix = new Map(companies.map(co => [co.id, toks(JSON.stringify(assistantToolDefs()).length + assistantSystemPrompt(co, 'Usuario').length)]))
    let history = 0
    let conv = -1
    let lastAt = 0
    for (const msg of msgs) {
      if (msg.conversationId !== conv) {
        conv = msg.conversationId
        history = 0
        lastAt = 0
      }
      const len = toks(Number(msg.len) || 0)
      if (msg.role === 'user') {
        history += len
        continue
      }
      const at = new Date(msg.createdAt).getTime()
      const tools = msg.tools?.length ?? 0
      // Una ronda sin herramientas; con ellas, una más para leer sus resultados (dos si consultó muchas)
      const rounds = tools === 0 ? 1 : tools <= 2 ? 2 : 3
      const pre = prefix.get(msg.companyId) ?? 6000
      const toolOut = tools * 900
      let input = 0
      let cached = 0
      for (let r = 0; r < rounds; r++) {
        const round = pre + history + (r > 0 ? toolOut + 120 * r : 0)
        input += round
        // OpenAI guarda en caché el inicio repetido: lo ya enviado en la ronda anterior o en la pregunta previa (minutos antes)
        if (r > 0) cached += pre + history
        else if (lastAt && at - lastAt < 30 * 60_000) cached += pre
      }
      const output = len + rounds * 180 + tools * 40
      rows.push(estimatedRow({
        companyId: msg.companyId,
        userId: msg.userId,
        day: madridDay(new Date(msg.createdAt)),
        category: 'asistente',
        task: 'asistente',
        model: msg.model || 'gpt-5.5',
        inputTokens: input,
        cachedTokens: Math.floor(cached / 128) * 128,
        outputTokens: output,
        reasoningTokens: rounds * 180,
        ms: 0,
        createdAt: new Date(msg.createdAt),
      }))
      history += len
      lastAt = at
    }
  }

  // Propuestas del banco con IA (en peticiones de 60 movimientos)
  const b = tables.bankTransactions
  const bank = await db.select({ companyId: b.companyId, n: sql<number>`COUNT(*)`, at: sql<Date>`MIN(${b.createdAt})`.mapWith(b.createdAt) })
    .from(b)
    .where(and(sql`${b.suggestion} LIKE '%"source":"ai"%'`, lt(b.createdAt, cutoff)))
    .groupBy(b.companyId, sql`DATE(${b.createdAt})`)
  for (const g of bank) {
    const n = Number(g.n) || 0
    const calls = Math.ceil(n / 60)
    rows.push(estimatedRow({
      companyId: g.companyId,
      userId: null,
      day: madridDay(new Date(g.at)),
      category: 'banco',
      task: 'bank_categories',
      model: s.model,
      inputTokens: calls * 1800 + n * 70,
      outputTokens: calls * 300 + n * 55,
      reasoningTokens: calls * 300,
      ms: 0,
      createdAt: new Date(g.at),
    }))
  }

  if (!rows.length) return 0
  for (const r of rows) r.usdPerEur = await usdPerEur(r.day)
  for (let i = 0; i < rows.length; i += 200) await db.insert(u).values(rows.slice(i, i + 200))
  console.info(`[ai] Consumo anterior reconstruido: ${rows.length} registros estimados`)
  return rows.length
}

/**
 * Llamadas guardadas antes de registrar la clave que las pagó. Desde que hay claves por usuario (la primera
 * se guardó en `openai_key_at`) solo pudo pagar la del usuario o la del titular de su empresa: la que les
 * toca hoy. Lo anterior se pagó con la clave de la instalación y se queda sin clave.
 */
export async function attributeAiKeys() {
  const db = useDb()
  const u = tables.aiUsage
  const [first] = await db.select({ at: sql<Date | null>`MIN(${tables.users.openaiKeyAt})`.mapWith(tables.users.openaiKeyAt) }).from(tables.users)
  if (!first?.at) return
  const since = new Date(first.at)
  const pending = and(isNull(u.keyUserId), isNotNull(u.userId), gte(u.createdAt, since))
  const groups = await db.select({ userId: u.userId, companyId: u.companyId }).from(u).where(pending).groupBy(u.userId, u.companyId)
  for (const g of groups) {
    const key = await findAiKey(g.userId!, g.companyId)
    if (!key) continue
    await db.update(u).set({ keyUserId: key.userId, keyHint: key.hint })
      .where(and(pending, eq(u.userId, g.userId!), g.companyId == null ? isNull(u.companyId) : eq(u.companyId, g.companyId)))
  }
}

/** Quien ve el coste de toda la app (todas las empresas): el titular de la cuenta de la app */
export const canSeeAppAiCost = (user: { email: string }, role: string) => canReadWholeInbox(user, role)

/** Filas sin cambio guardado (el BCE no respondió): se convierten con el último conocido */
export async function fillMissingRates() {
  const u = tables.aiUsage
  const missing = await useDb().select({ id: u.id, day: u.day }).from(u).where(isNull(u.usdPerEur)).limit(500)
  for (const r of missing) {
    const rate = await usdPerEur(r.day)
    if (!rate) return
    await useDb().update(u).set({ usdPerEur: rate }).where(eq(u.id, r.id))
  }
}
