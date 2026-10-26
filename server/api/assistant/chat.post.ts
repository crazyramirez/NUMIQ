import { and, asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  conversationId: z.number().int().positive().nullish(),
  // 15 000 caracteres caben en la columna TEXT (65 535 bytes) aunque cada uno ocupe 4 bytes
  message: z.string().trim().min(1, 'Escribe tu pregunta').max(15000, 'El mensaje es demasiado largo: máximo 15.000 caracteres'),
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

/**
 * Pregunta al asistente; la respuesta llega por streaming (eventos SSE). Si la última respuesta dejó
 * propuestas pendientes y el usuario contesta «sí» o «no», se confirman o cancelan aquí mismo, sin
 * pasar por el modelo: la decisión es siempre del usuario.
 */
export default defineEventHandler(async (event) => {
  const { company, user, role } = await requireCompany(event, 'advisor')
  await requireAi()
  const input = await readInput(event, schema)
  chatRateLimit(user.id)
  const db = useDb()
  const c = tables.aiConversations
  const m = tables.aiMessages
  const actor = { id: user.id, name: user.name, role }
  const ctx = { company, actor, ip: getRequestIP(event, { xForwardedFor: true }) ?? null }

  let conversationId = input.conversationId ?? null
  let pending: ActionView[] = []
  if (conversationId) {
    const [conv] = await db.select({ id: c.id }).from(c).where(and(eq(c.id, conversationId), eq(c.companyId, company.id), eq(c.userId, user.id)))
    if (!conv) throw createError({ statusCode: 404, statusMessage: 'Conversación no encontrada' })
    await dropOrphanActions(conversationId)
    const [last] = await db.select({ id: m.id }).from(m).where(and(eq(m.conversationId, conversationId), eq(m.role, 'assistant'))).orderBy(desc(m.id)).limit(1)
    if (last) pending = await pendingActions(ctx, conversationId, last.id)
  }
  else {
    const [res] = await db.insert(c).values({ companyId: company.id, userId: user.id, title: conversationTitle(input.message) }).$returningId()
    conversationId = res!.id
  }
  const decision = pending.length && role !== 'advisor' ? (isAffirmative(input.message) ? 'confirm' : isNegative(input.message) ? 'cancel' : null) : null
  await db.insert(m).values({ conversationId, role: 'user', content: input.message })

  // Historial para el modelo, con el estado real de cada propuesta junto a la respuesta que la hizo
  const id = conversationId
  const notes = new Map<number, string[]>()
  if (!decision) {
    for (const v of await conversationActions(ctx, id)) {
      if (v.messageId) notes.set(v.messageId, [...(notes.get(v.messageId) ?? []), actionNote(v)])
    }
  }
  const history = decision
    ? []
    : (await db.select({ id: m.id, role: m.role, content: m.content }).from(m)
        .where(eq(m.conversationId, id)).orderBy(asc(m.id))).slice(-20)
        .map(h => ({ role: h.role, content: notes.has(h.id) ? `${h.content}\n\n${notes.get(h.id)!.join('\n')}` : h.content }))

  // Si el usuario cierra la página, se corta la petición a la IA
  const controller = new AbortController()
  event.node.res.on('close', () => {
    if (!event.node.res.writableEnded) controller.abort()
  })

  const encoder = new TextEncoder()
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
        let r: { text: string, tools: string[], model: string | null }
        if (decision) {
          const views: ActionView[] = []
          for (const p of pending) {
            const v = decision === 'confirm' ? await confirmAction(ctx, p.id) : await cancelAction(ctx, p.id)
            views.push(v)
            send({ type: 'action', action: v })
          }
          const text = decisionReply(views, decision === 'confirm')
          send({ type: 'delta', text })
          r = { text, tools: [], model: null }
        }
        else {
          r = await answer(company, actor, history, e => send(e), controller.signal, id)
        }
        const [res] = await db.insert(m).values({ conversationId: id, role: 'assistant', content: r.text, tools: r.tools, model: r.model }).$returningId()
        await attachActions(id, res!.id)
        await db.update(c).set({ updatedAt: new Date() }).where(eq(c.id, id))
        send({ type: 'done', messageId: res!.id, tools: r.tools })
      }
      catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('[assistant]', err)
          send({ type: 'error', message: err instanceof AiError ? err.message : (err as { statusMessage?: string }).statusMessage ?? 'No se pudo responder. Inténtalo de nuevo.' })
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
