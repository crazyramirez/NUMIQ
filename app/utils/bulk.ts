export interface BulkSkipped { id: number, number: string | null, reason: string }
export interface BulkStatusResult { done: number, skipped: BulkSkipped[] }

/**
 * Lo que un cambio en lote se saltó, agrupado por motivo («Ya estaba cobrada: 12-26, 14-26»).
 * `already` indica que todo lo saltado ya estaba así: basta un aviso neutro, no un error.
 */
export function skippedSummary(skipped: BulkSkipped[], unnamed = 'sin número') {
  const byReason = new Map<string, string[]>()
  for (const s of skipped) byReason.set(s.reason, [...(byReason.get(s.reason) ?? []), s.number ?? unnamed])
  const body = [...byReason].map(([reason, names]) => `${reason}: ${names.slice(0, 6).join(', ')}${names.length > 6 ? ` y ${names.length - 6} más` : ''}`).join('\n')
  return { body, already: skipped.every(s => s.reason.startsWith('Ya ')) }
}
