import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  conversationId: z.number().int().positive().nullish(),
  message: z.string().trim().min(1, 'Escribe tu pregunta').max(4000, 'La pregunta es demasiado larga'),
})

// Límite por usuario: evita gastos desbocados de IA por un bucle o un abuso
const recent = new Map<number, number[]>()
function chatRateLimit(userId: number) {
  const now = Date.now()
  const list = (recent.get(userId) ?? []).filter(t => now - t < 10 * 60_000)
  if (list.length >= 40) throw createError({ statusCode: 429, statusMessage: 'Has hecho muchas preguntas seguidas: espera unos minutos' })
  list.push(now)
  recent.set(userId, list)
}

/** Pregunta al asistente; la respuesta llega por streaming (eventos SSE) */
export default defineEventHandler(async (event) => {
  const { company, user, role } = await requireCompany(event, 'advisor')
  if (!aiEnabled()) throw createError({ statusCode: 503, statusMessage: 'La IA no está configurada: añade NUXT_OPENAI_API_KEY en el .env' })
  const input = await readInput(event, schema)
  chatRateLimit(user.id)
  const db = useDb()
  const c = tables.aiConversations

  let conversationId = input.conversationId ?? null
  if (conversationId) {
    const [conv] = await db.select({ id: c.id }).from(c).where(and(eq(c.id, conversationId), eq(c.companyId, company.id), eq(c.userId, user.id)))
    if (!conv) throw createError({ statusCode: 404, statusMessage: 'Conversación no encontrada' })
  }
  else {
    const [res] = await db.insert(c).values({ companyId: company.id, userId: user.id, title: conversationTitle(input.message) }).$returningId()
    conversationId = res!.id
  }
  await db.insert(tables.aiMessages).values({ conversationId, role: 'user', content: input.message })
  const history = (await db.select({ role: tables.aiMessages.role, content: tables.aiMessages.content }).from(tables.aiMessages)
    .where(eq(tables.aiMessages.conversationId, conversationId)).orderBy(asc(tables.aiMessages.id))).slice(-20)

  // Si el usuario cierra la página, se corta la petición a la IA
  const controller = new AbortController()
  event.node.res.on('close', () => {
    if (!event.node.res.writableEnded) controller.abort()
  })

  const encoder = new TextEncoder()
  const id = conversationId
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (obj: unknown) => {
        try {
          ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
        }
        catch {
          // conexión cerrada
        }
      }
      send({ type: 'start', conversationId: id })
      try {
        const r = await answer(company, { id: user.id, name: user.name, role }, history, e => send(e), controller.signal)
        const [res] = await db.insert(tables.aiMessages).values({ conversationId: id, role: 'assistant', content: r.text, tools: r.tools, model: r.model }).$returningId()
        await db.update(c).set({ updatedAt: new Date() }).where(eq(c.id, id))
        send({ type: 'done', messageId: res!.id, tools: r.tools })
      }
      catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('[assistant]', err)
          send({ type: 'error', message: err instanceof AiError ? err.message : 'No se pudo responder. Inténtalo de nuevo.' })
        }
      }
      try {
        ctrl.close()
      }
      catch {
        // ya cerrado
      }
    },
  })

  setResponseHeaders(event, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'x-accel-buffering': 'no',
  })
  return sendStream(event, stream)
})
