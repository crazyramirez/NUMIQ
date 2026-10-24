/** Identidad de importación: nunca se considera duplicado solo por compartir importe. */
export interface DuplicateParty {
  name?: string | null
  tradeName?: string | null
  nif?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
}

export interface DuplicateRecord {
  type: 'sales' | 'expense' | 'contact'
  kind?: string
  party?: DuplicateParty | null
  number?: string | null
  issueDate?: string | null
  total?: number | null
  /** Concepto: identifica gastos sin proveedor (cuota de autónomos, tickets, cargos del banco…) */
  description?: string | null
  /** Gasto creado desde un cargo del banco, aún sin su documento: la fecha es la del pago y la factura suele ser anterior */
  paidOnBank?: boolean
}

/**
 * Coincidencia con un registro existente. `certain`: es el mismo documento sin lugar a dudas (mismo número,
 * mismo archivo o misma contraparte, fecha e importe). Si no, es muy probable y se puede guardar igualmente.
 */
export interface DuplicateMatch {
  reason: string
  certain: boolean
  /** Días entre las dos fechas: entre varias coincidencias probables, la más cercana */
  days?: number
}

/** Días de margen entre dos fechas del mismo documento (un escaneo mal leído, fecha de operación…) */
export const NEAR_DAYS = 5
/** Un cargo del banco llega hasta 35 días después de la fecha de su factura (recibos, domiciliaciones) */
export const BANK_DAYS = 35

const nameKey = (s?: string | null) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  .replace(/\b(s\s?l\s?u?|s\s?a\s?u?|s\s?l\s?l|s\s?c\s?p|c\s?b|s\s?coop|sociedad (limitada|anonima)( unipersonal)?|slne|sau|slu)$/, '').trim()
/** NIF comparable: sin separadores ni el prefijo ES de los NIF-IVA españoles */
export function taxIdKey(s?: string | null) {
  const n = (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return /^ES[0-9A-Z]\d{7}[0-9A-Z]$/.test(n) ? n.slice(2) : n
}
const nifKey = taxIdKey
const numberKey = (s?: string | null) => (s ?? '').toUpperCase().replace(/[\s.\-/_]/g, '')
/** «FE26-000123» y «FE26/123»: el mismo número con otros ceros a la izquierda o separadores */
const zerolessKey = (s?: string | null) => (s ?? '').toUpperCase().match(/[A-Z]+|\d+/g)?.map(t => t.replace(/^0+(?=\d)/, '')).join('|') ?? ''
/** «F-0046/2026» y «46-2026»: solo las cifras, sin ceros a la izquierda (la serie se omite a veces) */
const looseNumberKey = (s?: string | null) => (s ?? '').match(/\d+/g)?.map(g => g.replace(/^0+(?=\d)/, '')).join('.') ?? ''
const names = (p: DuplicateParty) => [nameKey(p.name), nameKey(p.tradeName)].filter(Boolean)
const emailKey = (p: DuplicateParty) => p.email?.trim().toLowerCase() || ''
const phoneKey = (p: DuplicateParty) => p.phone?.replace(/\D/g, '') || ''
const cents = (n?: number | null) => (n != null && Number.isFinite(n) ? Math.round(n * 100) : null)
const dayGap = (a?: string | null, b?: string | null) => (a && b
  ? Math.abs(Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000))
  : null)

function partyKeys(p?: DuplicateParty | null): string[] {
  if (!p) return []
  return [
    ...(nifKey(p.nif) ? [`nif:${nifKey(p.nif)}`] : []),
    ...names(p).map(n => `name:${n}`),
    ...(emailKey(p) ? [`email:${emailKey(p)}`] : []),
    ...(phoneKey(p).length >= 9 && nameKey(p.address) ? [`phone-address:${phoneKey(p)}|${nameKey(p.address)}`] : []),
  ]
}

export function sameImportParty(a?: DuplicateParty | null, b?: DuplicateParty | null): boolean {
  if (!a || !b) return false
  const an = nifKey(a.nif), bn = nifKey(b.nif)
  // Un nombre o correo compartido nunca prevalece sobre dos NIF distintos.
  if (an && bn) return an === bn
  const keys = new Set(partyKeys(a))
  return partyKeys(b).some(k => keys.has(k))
}

export function findImportContact<T extends DuplicateParty>(contacts: T[], party: DuplicateParty): T | undefined {
  const nif = nifKey(party.nif)
  if (nif) {
    const exact = contacts.find(c => nifKey(c.nif) === nif)
    if (exact) return exact
  }
  const matches = contacts.filter(c => sameImportParty(c, party))
  // Una coincidencia ambigua requiere revisión; no se adjudica a una persona al azar.
  return matches.length === 1 ? matches[0] : undefined
}

/** Palabras que no identifican a nadie: formas jurídicas, artículos y lo que añaden los bancos al concepto */
const FILLER = new Set([
  'sl', 'slu', 'sa', 'sau', 'slp', 'sll', 'scp', 'cb', 'coop', 'sociedad', 'limitada', 'anonima', 'unipersonal', 'grupo', 'espana', 'spain', 'iberica',
  'servicios', 'services', 'comercial', 'del', 'las', 'los', 'and', 'the', 'por', 'para', 'con', 'compra', 'pago', 'recibo', 'factura', 'fra',
  'ticket', 'tarjeta', 'tarj', 'cargo', 'adeudo', 'transferencia', 'transf', 'trf', 'bizum', 'cuota', 'mensual', 'eur', 'euros', 'ref', 'num',
])
/** Palabras que identifican: sin formas jurídicas, relleno del banco ni cifras */
export function significantWords(s?: string | null) {
  return nameKey(s).split(' ').filter(w => w.length >= 3 && !FILLER.has(w) && !/^\d+$/.test(w))
}
const words = significantWords

/**
 * ¿Nombran a lo mismo? Todas las palabras significativas del más corto aparecen en el otro:
 * «Endesa» y «Endesa Energía, S.A.U.», «Cuota de autónomos» y «Cuota autónomos octubre».
 * Un nombre de una sola palabra necesita al menos 5 letras («Juan» no basta).
 */
export function similarNames(a?: string | null, b?: string | null): boolean {
  const wa = words(a), wb = words(b)
  if (!wa.length || !wb.length) return false
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa]
  if (short.length === 1 && short[0]!.length < 5) return false
  return short.every(w => long.some(x => x === w || (Math.min(w.length, x.length) >= 5 && (x.startsWith(w) || w.startsWith(x)))))
}

/**
 * Contacto existente para un cliente o proveedor leído: el del mismo NIF o datos y, si no hay, el único
 * con un nombre parecido («Endesa» creado desde el banco para «Endesa Energía, S.A.U.»).
 * Con NIF solo se une a fichas sin NIF: dos NIF distintos nunca son el mismo contacto.
 */
export function findSimilarContact<T extends DuplicateParty>(contacts: T[], party: DuplicateParty): T | undefined {
  const exact = findImportContact(contacts, party)
  if (exact) return exact
  const nif = nifKey(party.nif)
  const hits = contacts.filter(c => (!nif || !nifKey(c.nif))
    && [party.name, party.tradeName].some(n => similarNames(c.name, n) || similarNames(c.tradeName, n)))
  return hits.length === 1 ? hits[0] : undefined
}

const group = (r: DuplicateRecord) => r.type === 'sales'
  ? `sales:${r.kind === 'quote' || r.kind === 'proforma' ? r.kind : 'invoice'}` : r.type

const texts = (r: DuplicateRecord) => [r.party?.name, r.party?.tradeName, r.description].filter((t): t is string => !!t)

export function duplicateMatch(a: DuplicateRecord, b: DuplicateRecord): DuplicateMatch | null {
  if (group(a) !== group(b)) return null
  const party = sameImportParty(a.party, b.party)
  if (a.type === 'contact') return party ? { reason: 'Coinciden los datos del contacto', certain: true } : null
  const an = nifKey(a.party?.nif), bn = nifKey(b.party?.nif)
  const conflict = !!an && !!bn && an !== bn
  const sameTotal = cents(a.total) != null && cents(a.total) === cents(b.total)
  const gap = dayGap(a.issueDate, b.issueDate)
  const expense = a.type === 'expense'
  const na = numberKey(a.number), nb = numberKey(b.number)
  if (na && nb) {
    if (a.issueDate && b.issueDate && a.issueDate.slice(0, 4) !== b.issueDate.slice(0, 4)) return null
    if (na === nb || zerolessKey(a.number) === zerolessKey(b.number)) {
      if (!expense || party) return { reason: `Coinciden el número y el ejercicio${expense ? ' del proveedor' : ''}`, certain: true }
      // El mismo número y total de un proveedor escrito de otra forma («REPSOL» y «Repsol Comercial…»)
      if (!conflict && sameTotal) return { reason: 'Coinciden el número, el importe y el ejercicio', certain: true }
      return null
    }
    // Solo las cifras cuando uno omite la serie; dos series distintas («A-12» y «B-12») son dos documentos
    const series = (n?: string | null) => (n ?? '').toUpperCase().replace(/[^A-Z]/g, '')
    const la = !series(a.number) || !series(b.number) ? looseNumberKey(a.number) : ''
    if (la && la === looseNumberKey(b.number) && sameTotal && !conflict && (party || (gap != null && gap <= NEAR_DAYS))) {
      return { reason: `El número es el mismo escrito de otra forma (${a.number} y ${b.number}) y coincide el importe`, certain: false }
    }
    // Dos números distintos son dos documentos distintos
    return null
  }
  if (!sameTotal || gap == null) return null
  if (party && gap === 0) return { reason: 'Coinciden el cliente o proveedor, la fecha y el importe', certain: true, days: 0 }
  // Fechas cercanas o, con un gasto creado desde el banco, la factura de hasta 35 días antes del cargo
  const bank = !!a.paidOnBank !== !!b.paidOnBank ? (a.paidOnBank ? a : b) : null
  const doc = bank === a ? b : a
  // Positivo: el cargo es posterior a la fecha del documento
  const paidAfter = bank ? Math.round((Date.parse(`${bank.issueDate}T12:00:00Z`) - Date.parse(`${doc.issueDate}T12:00:00Z`)) / 86_400_000) : 0
  const viaBank = !!bank && gap > NEAR_DAYS && paidAfter > 0 && paidAfter <= BANK_DAYS
  if (gap > NEAR_DAYS && !viaBank) return null
  const when = viaBank ? `pagado en el banco ${gap} días después de su fecha` : `con ${gap} ${gap === 1 ? 'día' : 'días'} de diferencia`
  if (party) return { reason: `Mismo ${expense ? 'proveedor' : 'cliente'} e importe, ${when}`, certain: false, days: gap }
  if (conflict) return null
  // Sin contraparte común: el nombre o el concepto (el gasto «Repsol» del banco y el ticket de «REPSOL ESTACIÓN…»)
  if (texts(a).some(x => texts(b).some(y => similarNames(x, y)))) {
    return { reason: gap === 0 ? 'Coinciden la fecha, el importe y el nombre' : `Mismo importe y nombre parecido, ${when}`, certain: false, days: gap }
  }
  return null
}

export function importDuplicateReason(a: DuplicateRecord, b: DuplicateRecord): string | null {
  return duplicateMatch(a, b)?.reason ?? null
}

/** Índice con candidatos múltiples: conserva los homónimos y verifica sus NIF. */
export class ImportDuplicateIndex<T> {
  private entries = new Map<string, Array<{ record: DuplicateRecord, value: T }>>()

  private keys(r: DuplicateRecord) {
    const prefix = group(r)
    if (r.type === 'contact') return partyKeys(r.party).map(k => `${prefix}|${k}`)
    // Por número y por importe: las demás reglas exigen el mismo importe
    return [
      ...(numberKey(r.number) ? [`${prefix}|number:${numberKey(r.number)}`] : []),
      ...(cents(r.total) != null ? [`${prefix}|total:${cents(r.total)}`] : []),
    ]
  }

  add(record: DuplicateRecord, value: T) {
    const entry = { record, value }
    for (const key of this.keys(record)) {
      const rows = this.entries.get(key) ?? []
      rows.push(entry)
      this.entries.set(key, rows)
    }
  }

  /** Primero lo seguro; `certainOnly` descarta lo probable (el usuario ya confirmó que no es un duplicado) */
  find(record: DuplicateRecord, opts: { certainOnly?: boolean } = {}): ({ value: T } & DuplicateMatch) | null {
    let likely: ({ value: T } & DuplicateMatch) | null = null
    for (const key of this.keys(record)) {
      for (const entry of this.entries.get(key) ?? []) {
        const match = duplicateMatch(record, entry.record)
        if (match?.certain) return { value: entry.value, ...match }
        // Entre varias probables, la de fecha más cercana (el cargo de este mes, no el del anterior)
        if (match && !opts.certainOnly && (!likely || (match.days ?? 0) < (likely.days ?? 0))) likely = { value: entry.value, ...match }
      }
    }
    return likely
  }
}
