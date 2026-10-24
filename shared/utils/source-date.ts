/** Fecha alternativa, conservando su procedencia para no confundirla con la fecha leída. */
export interface SourceFileDate {
  date: string
  source: 'created' | 'modified' | 'uploaded'
}

export function validDocumentDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && date.getUTCFullYear() >= 1990 ? value : null
}

export function sourceDateWarning(value: SourceFileDate): string {
  const origin = value.source === 'created' ? 'creación del archivo'
    : value.source === 'modified' ? 'última modificación del archivo (no consta su creación)'
      : 'subida del archivo (no constan su creación ni su modificación original)'
  return `No se detectó la fecha del documento: se ha usado la fecha de ${origin}: ${value.date}. Revísala si es necesario`
}

export function resolveDocumentDate(detected: unknown, fallback?: SourceFileDate | null) {
  const date = validDocumentDate(detected)
  if (date) return { date, fallback: null, warning: null }
  if (fallback && validDocumentDate(fallback.date)) return { date: fallback.date, fallback, warning: sourceDateWarning(fallback) }
  return { date: null, fallback: null, warning: null }
}
