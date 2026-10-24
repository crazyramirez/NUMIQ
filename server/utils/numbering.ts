import { and, eq, sql } from 'drizzle-orm'
import type { Db } from './db'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

export function formatNumber(s: { prefix: string, padding: number, yearlyReset: boolean }, year: number, seq: number) {
  const n = String(seq).padStart(s.padding, '0')
  return s.yearlyReset ? `${s.prefix}${year}-${n}` : `${s.prefix}${n}`
}

/**
 * Siguiente número correlativo de una serie. Dentro de una transacción: el INSERT … ON DUPLICATE KEY
 * bloquea la fila del contador hasta el commit, así dos facturas a la vez nunca comparten número.
 */
export async function takeNextNumber(tx: Tx, seriesId: number, year: number) {
  const [s] = await tx.select().from(tables.series).where(eq(tables.series.id, seriesId))
  if (!s) throw createError({ statusCode: 400, statusMessage: 'Serie no encontrada' })
  const counterYear = s.yearlyReset ? year : 0
  await tx.insert(tables.seriesCounters)
    .values({ seriesId, year: counterYear, lastNumber: 1 })
    .onDuplicateKeyUpdate({ set: { lastNumber: sql`${tables.seriesCounters.lastNumber} + 1` } })
  const [c] = await tx.select().from(tables.seriesCounters)
    .where(and(eq(tables.seriesCounters.seriesId, seriesId), eq(tables.seriesCounters.year, counterYear)))
  const sequence = c!.lastNumber
  return { sequence, number: formatNumber(s, year, sequence) }
}
