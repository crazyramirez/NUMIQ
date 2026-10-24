/**
 * IA con OpenAI (Responses API). La clave nunca sale del servidor ni se registra.
 * Salida en JSON con esquema estricto: el modelo no puede devolver campos inventados ni texto suelto.
 */

const ENDPOINT = 'https://api.openai.com/v1/responses'

export function aiSettings() {
  const c = useRuntimeConfig()
  return {
    apiKey: String(c.openaiApiKey || ''),
    model: String(c.openaiModel || 'gpt-5.4-mini'),
    proModel: String(c.openaiProModel || 'gpt-5.5'),
    concurrency: Math.min(Math.max(Number(c.openaiConcurrency) || 4, 1), 12),
  }
}

export const aiEnabled = () => !!aiSettings().apiKey

export type AiPart =
  | { type: 'input_text', text: string }
  | { type: 'input_image', image_url: string, detail: 'low' | 'high' | 'auto' }
  | { type: 'input_file', filename: string, file_data: string }

export type AiEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high'

export interface AiJsonRequest {
  /** Nombre del esquema (a-z, guiones bajos) */
  name: string
  schema: Record<string, unknown>
  system: string
  parts: AiPart[]
  model?: string
  effort?: AiEffort
  maxOutputTokens?: number
  timeoutMs?: number
}

export interface AiJsonResult<T> {
  data: T
  model: string
  ms: number
  tokens: { input: number, output: number }
}

export class AiError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message)
  }
}

/** Modelos de razonamiento (gpt-5, gpt-6, o3…): admiten esfuerzo; el resto no */
function reasoningFor(model: string, effort?: AiEffort) {
  if (!/^(gpt-5|gpt-6|o\d)/.test(model)) return undefined
  // La primera generación de gpt-5 no conoce "none"
  const legacy = /^gpt-5(-|$)/.test(model)
  const e = effort ?? 'low'
  return { effort: legacy && e === 'none' ? 'minimal' : e }
}

function friendlyError(status: number, body: { error?: { message?: string, code?: string, type?: string } } | null) {
  const code = body?.error?.code ?? body?.error?.type
  if (status === 401) return new AiError('La clave de OpenAI no es válida o ha caducado', 503)
  if (code === 'insufficient_quota') return new AiError('La cuenta de OpenAI no tiene saldo disponible', 503)
  if (status === 429) return new AiError('La IA está saturada en este momento: inténtalo en unos segundos', 429)
  if (status === 404 || code === 'model_not_found') return new AiError('El modelo de IA configurado no está disponible para esta clave', 503)
  if (status === 400) return new AiError(`La IA no pudo leer el documento: ${body?.error?.message ?? 'petición no válida'}`, 422)
  return new AiError('El servicio de IA no responde: inténtalo de nuevo', 502)
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Llama a la IA y devuelve el JSON validado por el esquema. Reintenta saturación y errores temporales. */
export async function aiJson<T>(req: AiJsonRequest): Promise<AiJsonResult<T>> {
  const s = aiSettings()
  if (!s.apiKey) throw new AiError('La IA no está configurada: añade NUXT_OPENAI_API_KEY en el .env', 503)
  const model = req.model ?? s.model
  const body = JSON.stringify({
    model,
    reasoning: reasoningFor(model, req.effort),
    input: [
      { role: 'developer', content: req.system },
      { role: 'user', content: req.parts },
    ],
    text: { format: { type: 'json_schema', name: req.name, strict: true, schema: req.schema } },
    max_output_tokens: req.maxOutputTokens ?? 32000,
    store: false,
    // Mismas instrucciones y esquema en cada tarea: la misma clave lleva las peticiones a la misma caché
    // de OpenAI y la parte repetida se cobra al 10 %
    prompt_cache_key: `numiq-${req.name}`,
  })

  const t0 = Date.now()
  let lastError: AiError | null = null
  for (let attempt = 0; attempt < 4; attempt++) {
    let res: Response
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'authorization': `Bearer ${s.apiKey}`, 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(req.timeoutMs ?? 180_000),
      })
    }
    catch (err) {
      const timeout = (err as Error).name === 'TimeoutError'
      lastError = new AiError(timeout ? 'La IA tardó demasiado en leer el documento' : 'No hay conexión con el servicio de IA', 504)
      if (timeout) break
      await wait(1000 * 2 ** attempt)
      continue
    }

    const json = await res.json().catch(() => null) as {
      status?: string
      incomplete_details?: { reason?: string }
      model?: string
      service_tier?: string
      output?: Array<{ type: string, content?: Array<{ type: string, text?: string, refusal?: string }> }>
      usage?: OpenAiUsage
      error?: { message?: string, code?: string, type?: string }
    } | null

    if (!res.ok) {
      lastError = friendlyError(res.status, json)
      const retryable = (res.status === 429 && json?.error?.code !== 'insufficient_quota') || res.status >= 500
      if (!retryable) throw lastError
      const after = Number(res.headers.get('retry-after'))
      await wait(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 20_000) : 1500 * 2 ** attempt)
      continue
    }

    const content = json?.output?.find(o => o.type === 'message')?.content ?? []
    const text = content.find(c => c.type === 'output_text')?.text
    // Se cobra aunque la respuesta no sirva (rechazo, incompleta o JSON roto): también cuenta
    recordAiUsage({ task: req.name, model: json?.model || model, usage: json?.usage, tier: json?.service_tier, ms: Date.now() - t0, ok: !!text && json?.status !== 'incomplete' })
    const refusal = content.find(c => c.type === 'refusal')?.refusal
    if (refusal) throw new AiError('La IA no ha querido procesar este documento', 422)
    if (json?.status === 'incomplete') throw new AiError(json.incomplete_details?.reason === 'max_output_tokens' ? 'El documento es demasiado largo para leerlo de una vez' : 'La lectura con IA quedó incompleta', 422)
    if (!text) throw new AiError('La IA devolvió una respuesta vacía', 502)
    try {
      return {
        data: JSON.parse(text) as T,
        model,
        ms: Date.now() - t0,
        tokens: { input: json?.usage?.input_tokens ?? 0, output: json?.usage?.output_tokens ?? 0 },
      }
    }
    catch {
      throw new AiError('La IA devolvió un resultado no válido', 502)
    }
  }
  throw lastError ?? new AiError('El servicio de IA no responde', 502)
}

/** Ejecuta tareas con un máximo de N a la vez (lotes de documentos) */
export async function runLimited<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = Array.from({ length: tasks.length })
  let next = 0
  async function worker() {
    while (next < tasks.length) {
      const i = next++
      results[i] = await tasks[i]!()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}
