/**
 * «Por revisar» en Gastos: solo lo que pide hacer algo (importes que no cuadran, proveedor sin
 * identificar, moneda extranjera…). Las notas que la IA añade al leer («inversión del sujeto pasivo»,
 * «se cargará en PayPal», «no consta método de pago») son informativas y no marcan nada.
 */
export type ReviewKind = 'currency' | 'supplier' | 'parties' | 'amounts' | 'vat' | 'nif' | 'number' | 'date' | 'reading' | 'recurring'

const KINDS: Array<[ReviewKind, RegExp]> = [
  ['currency', /^Importes en [A-Z]{3}\b/],
  ['supplier', /^(No figura el proveedor|No se ha podido identificar al proveedor)/],
  ['parties', /^(Los NIF de ambas partes|No se ha podido contrastar quién emite|La cuenta de pago y los datos del emisor|Ambas partes corresponden)/],
  ['amounts', /^(Los importes no cuadran|La cuota del IVA)/],
  ['vat', /^No se encontró el desglose de IVA/],
  ['nif', /^El NIF \S+ no es válido/],
  ['number', /^No se encontró el número de factura/],
  ['date', /^(No se detectó la fecha del documento|La fecha de la factura es posterior)/],
  ['reading', /^(Lectura dudosa|Revisa los datos con el documento)/],
  ['recurring', /^Creado por el gasto fijo/],
]

export const REVIEW_LABEL: Record<ReviewKind, string> = {
  currency: 'En moneda extranjera',
  supplier: 'Sin proveedor',
  parties: 'Destinatario dudoso',
  amounts: 'Importes que no cuadran',
  vat: 'Sin desglose de IVA',
  nif: 'NIF no válido',
  number: 'Sin nº de factura',
  date: 'Fecha dudosa',
  reading: 'Lectura dudosa',
  recurring: 'Gasto fijo por confirmar',
}

export function reviewKind(note: string): ReviewKind | null {
  return KINDS.find(([, re]) => re.test(note))?.[0] ?? null
}

/** Avisos de la lectura → los que piden revisión (uno por problema: «sin proveedor» no se repite) */
export function reviewNotesOf(warnings: string[] | null | undefined) {
  const seen = new Set<string>()
  return (warnings ?? []).filter((w) => {
    const kind = reviewKind(w)
    if (!kind) return false
    const key = kind === 'supplier' || kind === 'parties' || kind === 'currency' ? kind : w
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Moneda de un gasto con importes sin convertir a euros */
export function reviewCurrency(notes: string[] | null | undefined) {
  for (const n of notes ?? []) {
    const m = n.match(/^Importes en ([A-Z]{3})\b/)
    if (m && m[1] !== 'EUR') return m[1]!
  }
  return null
}
