import { and, eq, ne, sql } from 'drizzle-orm'
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

/** Secuencia de un número escrito a mano si sigue el formato de la serie (F2026-0050 → 50); si no, null */
export function sequenceOf(s: { prefix: string, yearlyReset: boolean }, year: number, number: string) {
  const head = s.yearlyReset ? `${s.prefix}${year}-` : s.prefix
  if (!number.toUpperCase().startsWith(head.toUpperCase())) return null
  const tail = number.slice(head.length)
  if (!/^\d{1,9}$/.test(tail)) return null
  return Number(tail) || null
}

/**
 * Número escrito a mano: si encaja en la serie, su secuencia queda reservada y el contador no se queda
 * por detrás (F2026-0050 a mano → la siguiente automática es F2026-0051). Fuera del formato, sin secuencia.
 */
export async function claimManualNumber(tx: Tx, companyId: number, seriesId: number, year: number, number: string, docId: number) {
  const [s] = await tx.select().from(tables.series).where(and(eq(tables.series.id, seriesId), eq(tables.series.companyId, companyId)))
  if (!s) return null
  const seq = sequenceOf(s, year, number)
  if (!seq) return null
  const [taken] = await tx.select({ number: tables.salesDocuments.number }).from(tables.salesDocuments)
    .where(and(
      eq(tables.salesDocuments.companyId, companyId),
      eq(tables.salesDocuments.seriesId, seriesId),
      eq(tables.salesDocuments.year, year),
      eq(tables.salesDocuments.sequence, seq),
      ne(tables.salesDocuments.id, docId),
    ))
    .limit(1)
  if (taken) throw createError({ statusCode: 409, statusMessage: `Ese número ya está usado en la serie: ${taken.number ?? seq}`, data: { field: 'number' } })
  const counterYear = s.yearlyReset ? year : 0
  await tx.insert(tables.seriesCounters)
    .values({ seriesId, year: counterYear, lastNumber: seq })
    .onDuplicateKeyUpdate({ set: { lastNumber: sql`GREATEST(${tables.seriesCounters.lastNumber}, ${seq})` } })
  return seq
}
