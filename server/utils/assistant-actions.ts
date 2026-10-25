import { and, asc, eq, gt, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { AiActionPreview, AiActionStatus, AiActionView } from '../../shared/types/assistant'

/**
 * Propuestas del asistente: se guardan pendientes con los registros exactos, el usuario las confirma
 * (botón de la tarjeta o respondiendo «sí») y solo entonces se ejecutan. El modelo nunca las confirma.
 */

type ActionRow = typeof tables.aiActions.$inferSelect

export interface ActionCtx extends OpCtx {
  ip?: string | null
}

export type ActionStatus = AiActionStatus
export type ActionView = AiActionView

/** Una propuesta caduca si no se confirma en este tiempo */
const PENDING_MS = 30 * 60_000

function emptyPreview(): AiActionPreview {
  return { change: null, count: 0, total: null, rows: [], warnings: [], undoable: false }
}

export function actionView(a: ActionRow): ActionView {
  const expired = a.status === 'pending' && a.expiresAt.getTime() < Date.now()
  const preview = a.preview ?? emptyPreview()
  return {
    id: a.id,
    kind: a.kind,
    title: a.title,
    risk: a.risk,
    status: expired ? 'expired' : a.status,
    preview,
    result: a.result,
    error: a.error,
    messageId: a.messageId,
    canUndo: a.status === 'done' && preview.undoable && !!a.undo && (a.result?.done ?? 0) > 0,
  }
}

function assertCanWrite(ctx: OpCtx) {
  if (ctx.actor.role === 'advisor') throw createError({ statusCode: 403, statusMessage: 'Tu rol (gestor) solo permite consultar' })
}

async function auditAction(ctx: ActionCtx, a: ActionRow, action: string, data: Record<string, unknown>) {
  await useDb().insert(tables.auditLog).values({
    companyId: ctx.company.id,
    userId: ctx.actor.id,
    action,
    entity: 'ai_action',
    entityId: a.id,
    data: { kind: a.kind, title: a.title, ...data },
    ip: ctx.ip?.slice(0, 45) ?? null,
  }).catch(err => console.error('[audit]', err))
}

async function loadOwn(ctx: OpCtx, id: number) {
  const a = tables.aiActions
  const [row] = await useDb().select().from(a).where(and(eq(a.id, id), eq(a.companyId, ctx.company.id), eq(a.userId, ctx.actor.id)))
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Operación no encontrada' })
  return row
}

/** Guarda la propuesta, pendiente de confirmar */
export async function proposeAction(ctx: ActionCtx, conversationId: number | null, plan: OpPlan) {
  assertCanWrite(ctx)
  const a = tables.aiActions
  const [res] = await useDb().insert(a).values({
    companyId: ctx.company.id,
    userId: ctx.actor.id,
    conversationId,
    kind: plan.kind,
    title: plan.title.slice(0, 200),
    risk: plan.risk,
    status: 'pending',
    params: plan.params,
    preview: plan.preview,
    expiresAt: new Date(Date.now() + PENDING_MS),
  }).$returningId()
  return actionView(await loadOwn(ctx, res!.id))
}

/** Ejecuta una propuesta pendiente. El paso a «running» es atómico: dos clics no la ejecutan dos veces */
export async function confirmAction(ctx: ActionCtx, id: number) {
  assertCanWrite(ctx)
  const db = useDb()
  const a = tables.aiActions
  const res = await db.update(a).set({ status: 'running' })
    .where(and(eq(a.id, id), eq(a.companyId, ctx.company.id), eq(a.userId, ctx.actor.id), eq(a.status, 'pending'), gt(a.expiresAt, new Date())))
  if (!res[0].affectedRows) {
    const v = actionView(await loadOwn(ctx, id))
    if (v.status === 'done' || v.status === 'running') return v
    if (v.status === 'expired') throw createError({ statusCode: 409, statusMessage: 'Esta propuesta ha caducado: pídesela de nuevo al asistente' })
    throw createError({ statusCode: 409, statusMessage: 'Esta propuesta ya no está pendiente' })
  }
  const row = await loadOwn(ctx, id)
  try {
    const { result, undo } = await executeOp(ctx, row.kind, row.params ?? {})
    await db.update(a).set({ status: 'done', result, undo, executedAt: new Date() }).where(eq(a.id, id))
    await auditAction(ctx, row, `assistant.${row.kind}`, { done: result.done, skipped: result.skipped.length, ids: (row.params?.ids as number[] | undefined)?.slice(0, 500) ?? null })
  }
  catch (err) {
    console.error('[assistant] operación', row.kind, err)
    const message = (err as { statusMessage?: string }).statusMessage || (err as Error).message || 'No se pudo completar'
    await db.update(a).set({ status: 'failed', error: message.slice(0, 500), executedAt: new Date() }).where(eq(a.id, id))
  }
  return actionView(await loadOwn(ctx, id))
}

export async function cancelAction(ctx: ActionCtx, id: number) {
  const a = tables.aiActions
  await useDb().update(a).set({ status: 'cancelled' })
    .where(and(eq(a.id, id), eq(a.companyId, ctx.company.id), eq(a.userId, ctx.actor.id), eq(a.status, 'pending')))
  return actionView(await loadOwn(ctx, id))
}

/** Deja los registros como estaban antes de ejecutar la operación */
export async function undoAction(ctx: ActionCtx, id: number) {
  assertCanWrite(ctx)
  const db = useDb()
  const a = tables.aiActions
  const before = actionView(await loadOwn(ctx, id))
  if (!before.canUndo) throw createError({ statusCode: 409, statusMessage: before.status === 'undone' ? 'Ya está deshecha' : 'Esta operación no se puede deshacer' })
  const res = await db.update(a).set({ status: 'undoing' })
    .where(and(eq(a.id, id), eq(a.companyId, ctx.company.id), eq(a.userId, ctx.actor.id), eq(a.status, 'done')))
  if (!res[0].affectedRows) return actionView(await loadOwn(ctx, id))
  const row = await loadOwn(ctx, id)
  try {
    const reverted = await revertOp(ctx, row.kind, row.undo)
    await db.update(a).set({ status: 'undone', undoneAt: new Date(), result: { ...(row.result ?? { done: 0, skipped: [] }), reverted } }).where(eq(a.id, id))
    await auditAction(ctx, row, 'assistant.undo', { done: reverted.done, skipped: reverted.skipped.length })
  }
  catch (err) {
    console.error('[assistant] deshacer', row.kind, err)
    const message = (err as { statusMessage?: string }).statusMessage || (err as Error).message || 'No se pudo deshacer'
    await db.update(a).set({ status: 'done', error: `No se pudo deshacer: ${message}`.slice(0, 500) }).where(eq(a.id, id))
  }
  return actionView(await loadOwn(ctx, id))
}

/** Propuestas de una conversación, en orden */
export async function conversationActions(ctx: OpCtx, conversationId: number) {
  const a = tables.aiActions
  const rows = await useDb().select().from(a)
    .where(and(eq(a.companyId, ctx.company.id), eq(a.userId, ctx.actor.id), eq(a.conversationId, conversationId)))
    .orderBy(asc(a.id))
  return rows.map(actionView)
}

/** Propuestas aún vigentes que hizo una respuesta concreta del asistente */
export async function pendingActions(ctx: OpCtx, conversationId: number, messageId: number) {
  const a = tables.aiActions
  const rows = await useDb().select().from(a).where(and(
    eq(a.companyId, ctx.company.id), eq(a.userId, ctx.actor.id), eq(a.conversationId, conversationId),
    eq(a.messageId, messageId), eq(a.status, 'pending'), gt(a.expiresAt, new Date()),
  )).orderBy(asc(a.id))
  return rows.map(actionView)
}

/** Las propuestas hechas mientras se escribía la respuesta quedan unidas a ella */
export async function attachActions(conversationId: number, messageId: number) {
  const a = tables.aiActions
  await useDb().update(a).set({ messageId }).where(and(eq(a.conversationId, conversationId), isNull(a.messageId)))
}

/**
 * Una propuesta nueva sustituye a las que seguían pendientes de respuestas anteriores: así nunca hay
 * dos tarjetas vivas para lo mismo (confirmar ambas aplicaría dos veces un «sube un 5 %»).
 */
export async function supersedePending(ctx: OpCtx, conversationId: number | null) {
  if (!conversationId) return []
  const a = tables.aiActions
  const stale = and(eq(a.companyId, ctx.company.id), eq(a.userId, ctx.actor.id), eq(a.conversationId, conversationId), eq(a.status, 'pending'), isNotNull(a.messageId))
  const rows = await useDb().select({ id: a.id }).from(a).where(stale)
  if (!rows.length) return []
  await useDb().update(a).set({ status: 'cancelled', error: 'Sustituida por una propuesta más reciente' }).where(and(stale, inArray(a.id, rows.map(r => r.id))))
  return Promise.all(rows.map(r => loadOwn(ctx, r.id).then(actionView)))
}

/** Propuestas de una respuesta que no llegó a guardarse (se cortó): se cancelan */
export async function dropOrphanActions(conversationId: number) {
  const a = tables.aiActions
  await useDb().update(a).set({ status: 'cancelled', messageId: null })
    .where(and(eq(a.conversationId, conversationId), isNull(a.messageId), inArray(a.status, ['pending'])))
}

// ─── Confirmar o cancelar escribiendo ────────────────────────────────────────

const YES_WORDS = new Set(['si', 'vale', 'ok', 'okay', 'okey', 'confirmo', 'confirmar', 'confirmado', 'confirmada', 'confirmalo', 'confirmalas', 'confirmalos', 'adelante', 'hazlo', 'hazla', 'hazlos', 'hazlas', 'dale', 'correcto', 'perfecto', 'procede', 'venga', 'claro', 'aplica', 'aplicalo', 'aplicala', 'aplicalos', 'aplicalas', 'ejecuta', 'ejecutalo', 'yes', 'acuerdo', 'exacto', 'genial', 'bien', 'de', 'por', 'favor', 'gracias', 'todo', 'todas', 'todos', 'ambas', 'ambos', 'las', 'los', 'dos', 'tres', 'cuatro', 'cinco', 'eso', 'esto', 'y', 'a', 'haz', 'lo', 'la', 'muy', 'vamos', 'es', 'asi', 'sigue', 'continua', 'bueno', 'pues', 'tambien', 'mismo', 'ya', 'cambios', 'cambio'])
const YES_STRONG = new Set(['si', 'vale', 'ok', 'okay', 'okey', 'confirmo', 'confirmar', 'confirmado', 'confirmada', 'confirmalo', 'confirmalas', 'confirmalos', 'adelante', 'hazlo', 'hazla', 'hazlos', 'hazlas', 'dale', 'correcto', 'perfecto', 'procede', 'venga', 'aplica', 'aplicalo', 'aplicala', 'aplicalos', 'aplicalas', 'ejecuta', 'ejecutalo', 'yes', 'acuerdo', 'exacto', 'sigue', 'continua'])
const NO_WORDS = new Set(['no', 'cancela', 'cancelar', 'cancelalo', 'cancelala', 'cancelado', 'dejalo', 'dejala', 'deja', 'olvidalo', 'olvidala', 'espera', 'nada', 'mejor', 'gracias', 'lo', 'la', 'por', 'favor', 'ahora', 'de', 'momento', 'para', 'quieto', 'stop'])
const NO_STRONG = new Set(['no', 'cancela', 'cancelar', 'cancelalo', 'cancelala', 'dejalo', 'dejala', 'olvidalo', 'olvidala', 'stop'])

const words = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]+/g, ' ').trim().split(' ').filter(Boolean)

/** «Sí», «vale, hazlo», «adelante por favor»… y nada más: un matiz («sí, pero solo 2025») va al asistente */
export function isAffirmative(text: string) {
  const w = words(text)
  return w.length > 0 && w.length <= 8 && w.every(x => YES_WORDS.has(x)) && w.some(x => YES_STRONG.has(x))
}

export function isNegative(text: string) {
  const w = words(text)
  return w.length > 0 && w.length <= 8 && w.every(x => NO_WORDS.has(x)) && w.some(x => NO_STRONG.has(x))
}

// ─── Textos ──────────────────────────────────────────────────────────────────

/** «12 de 12 hechas; 1 sin cambiar: Ya no existe» */
export function resultText(v: ActionView) {
  const r = v.result
  if (!r) return ''
  const skipped = r.skipped.length ? `; ${r.skipped.length} sin cambiar (${[...new Set(r.skipped.map(s => s.reason))].slice(0, 2).join('; ')})` : ''
  return `${r.done} de ${v.preview.count} ${r.done === 1 ? 'hecha' : 'hechas'}${skipped}${r.message ? `. ${r.message}` : ''}`
}

/** Estado real de una propuesta, para que el modelo lo vea en el historial */
export function actionNote(v: ActionView) {
  const state: Record<ActionStatus, string> = {
    pending: 'pendiente de que el usuario la confirme',
    running: 'ejecutándose',
    done: `ejecutada: ${resultText(v)}`,
    failed: `falló: ${v.error ?? 'error'}`,
    cancelled: v.error ? `${v.error.toLowerCase()}: no se cambió nada` : 'cancelada por el usuario: no se cambió nada',
    expired: 'caducó sin confirmar: no se cambió nada',
    undoing: 'deshaciéndose',
    undone: 'deshecha por el usuario: todo volvió a como estaba',
  }
  return `[Operación #${v.id} «${v.title}»: ${state[v.status]}]`
}

/** Respuesta al confirmar o cancelar escribiendo (sin pasar por el modelo) */
export function decisionReply(views: ActionView[], confirmed: boolean) {
  if (!confirmed) return views.length === 1 ? 'De acuerdo, la he cancelado: no he cambiado nada.' : 'De acuerdo, las he cancelado: no he cambiado nada.'
  const lines = views.map((v) => {
    if (v.status === 'done') {
      const r = v.result!
      if (!r.done && r.skipped.length) return `No he podido completar **${v.title}**: ${r.skipped[0]!.reason}.`
      const skipped = r.skipped.length ? ` ${r.skipped.length === 1 ? 'Uno no se pudo' : `${r.skipped.length} no se pudieron`} cambiar: lo ves en la tarjeta.` : ''
      return `Hecho: **${v.title}** (${r.done} de ${v.preview.count}).${skipped}${r.message ? ` ${r.message}` : ''}`
    }
    if (v.status === 'failed') return `No he podido completar **${v.title}**: ${v.error ?? 'error inesperado'}.`
    if (v.status === 'expired') return `**${v.title}** había caducado: pídemelo otra vez y la preparo de nuevo.`
    return `**${v.title}**: ${actionNote(v)}`
  })
  const undo = views.some(v => v.canUndo) ? '\n\nSi algo no cuadra, puedes deshacerlo desde la tarjeta.' : ''
  return lines.join('\n\n') + undo
}
