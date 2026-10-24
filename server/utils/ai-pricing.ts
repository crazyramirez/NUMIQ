/**
 * Tarifas oficiales de OpenAI (USD por millón de tokens, nivel Standard), revisadas el 25/10/2026 en
 * developers.openai.com/api/docs/pricing. Si OpenAI cambia un precio o se usa otro modelo, se puede
 * ajustar sin desplegar con NUXT_OPENAI_PRICES='{"gpt-5.5":[5,0.5,30]}' (entrada, entrada en caché, salida).
 */

type Price = { input: number, cached: number, output: number, long?: true }

const PRICES: Record<string, Price> = {
  'gpt-5.5-pro': { input: 30, cached: 30, output: 180, long: true },
  'gpt-5.5': { input: 5, cached: 0.5, output: 30, long: true },
  'gpt-5.4-pro': { input: 30, cached: 30, output: 180, long: true },
  'gpt-5.4-mini': { input: 0.75, cached: 0.075, output: 4.5 },
  'gpt-5.4-nano': { input: 0.2, cached: 0.02, output: 1.25 },
  'gpt-5.4': { input: 2.5, cached: 0.25, output: 15, long: true },
  'gpt-5.2': { input: 1.75, cached: 0.175, output: 14 },
  'gpt-5.1': { input: 1.25, cached: 0.125, output: 10 },
  'gpt-5-mini': { input: 0.25, cached: 0.025, output: 2 },
  'gpt-5-nano': { input: 0.05, cached: 0.005, output: 0.4 },
  'gpt-5': { input: 1.25, cached: 0.125, output: 10 },
  'gpt-4.1-mini': { input: 0.4, cached: 0.1, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, cached: 0.025, output: 0.4 },
  'gpt-4.1': { input: 2, cached: 0.5, output: 8 },
  'gpt-4o-mini': { input: 0.15, cached: 0.075, output: 0.6 },
  'gpt-4o': { input: 2.5, cached: 1.25, output: 10 },
  'o4-mini': { input: 1.1, cached: 0.275, output: 4.4 },
  'o3': { input: 2, cached: 0.5, output: 8 },
}

/** Más de 272K tokens de entrada: entrada ×2 y salida ×1,5 (gpt-5.4 y gpt-5.5) */
const LONG_CONTEXT = 272_000

/** Prioridad («Fast»): gpt-5.5 ×2,5; el resto de modelos ×2. Flex y Batch: la mitad */
function tierFactor(model: string, tier: string | null | undefined) {
  if (tier === 'flex' || tier === 'batch') return 0.5
  if (tier === 'priority') return model.startsWith('gpt-5.5') ? 2.5 : 2
  return 1
}

let overrides: Record<string, Price> | null = null
function priceTable() {
  if (!overrides) {
    overrides = {}
    try {
      const raw = JSON.parse(String(useRuntimeConfig().openaiPrices || '{}')) as Record<string, [number, number, number]>
      for (const [model, p] of Object.entries(raw)) {
        if (Array.isArray(p) && p.every(n => typeof n === 'number' && n >= 0)) overrides[model] = { input: p[0], cached: p[1], output: p[2] }
      }
    }
    catch {
      console.warn('[ai] NUXT_OPENAI_PRICES no es un JSON válido: se usan las tarifas incluidas')
    }
  }
  return { ...PRICES, ...overrides }
}

/** Tarifa del modelo; la API devuelve la versión fechada (gpt-5.4-mini-2026-03-17): gana el prefijo más largo */
export function priceFor(model: string): Price | null {
  const table = priceTable()
  if (table[model]) return table[model]
  const key = Object.keys(table).filter(k => model.startsWith(`${k}-`)).sort((a, b) => b.length - a.length)[0]
  return key ? table[key]! : null
}

export interface AiTokens {
  input: number
  cached?: number
  cacheWrite?: number
  output: number
}

/**
 * Coste en dólares de una petición. `input` incluye los tokens leídos de la caché (se cobran a la tarifa
 * reducida) y `output` los de razonamiento. Las escrituras en caché (solo gpt-5.6 en adelante) se cobran
 * a 1,25 × la entrada.
 */
export function aiCostUsd(model: string, t: AiTokens, tier?: string | null) {
  const p = priceFor(model)
  if (!p) return 0
  const long = p.long && t.input > LONG_CONTEXT
  const inF = long ? 2 : 1
  const outF = long ? 1.5 : 1
  const cached = Math.min(t.cached ?? 0, t.input)
  const write = Math.min(t.cacheWrite ?? 0, t.input - cached)
  const fresh = t.input - cached - write
  const usd = (fresh * p.input * inF + cached * p.cached * inF + write * p.input * 1.25 * inF + t.output * p.output * outF) / 1e6
  return usd * tierFactor(model, tier)
}

export const knownModel = (model: string) => !!priceFor(model)

// ─── Cambio euro/dólar del Banco Central Europeo ─────────────────────────────

const ECB_90D = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml'
let rates: { at: number, byDay: Map<string, number> } | null = null
let loading: Promise<void> | null = null

async function loadRates() {
  try {
    const xml = await (await fetch(ECB_90D, { signal: AbortSignal.timeout(8000) })).text()
    const byDay = new Map<string, number>()
    for (const m of xml.matchAll(/<Cube time=["'](\d{4}-\d{2}-\d{2})["']>([\s\S]*?)<\/Cube>/g)) {
      const v = Number(/currency=["']USD["'] rate=["']([\d.]+)["']/.exec(m[2]!)?.[1])
      if (v > 0) byDay.set(m[1]!, v)
    }
    if (byDay.size) rates = { at: Date.now(), byDay }
  }
  catch (err) {
    console.warn('[ai] No se pudo leer el cambio del BCE:', (err as Error).message)
  }
}

/**
 * Dólares por euro del BCE para ese día o el último publicado antes (fines de semana y festivos).
 * Se refresca cada 6 horas; si el BCE no responde, null y se usa el último cambio conocido.
 */
export async function usdPerEur(dayIso: string): Promise<number | null> {
  if (!rates || Date.now() - rates.at > 6 * 3600_000) {
    loading ??= loadRates().finally(() => (loading = null))
    await loading
  }
  if (!rates) return null
  const days = [...rates.byDay.keys()].filter(d => d <= dayIso).sort()
  const day = days.at(-1) ?? [...rates.byDay.keys()].sort()[0]
  return day ? rates.byDay.get(day) ?? null : null
}
