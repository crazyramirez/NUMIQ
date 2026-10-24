import { validateNif } from './nif.ts'

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
/** Céntimos de diferencia que aún se leen como el mismo importe (redondeos de un escaneo) */
export const NEAR_CENTS = 2
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
  // Lo que los bancos añaden al concepto: tipo de operación, fechas y meses
  'sepa', 'favor', 'concepto', 'ordenante', 'beneficiario', 'domiciliacion', 'domiciliado', 'abono', 'emitida', 'recibida', 'inmediata',
  'operacion', 'movimiento', 'datafono', 'contactless', 'fecha', 'devolucion', 'periodo',
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'setiembre', 'octubre', 'noviembre', 'diciembre',
  'ene', 'feb', 'abr', 'jun', 'jul', 'ago', 'sep', 'sept', 'oct', 'nov', 'dic',
])
/** Abreviaturas que escriben los bancos y los tickets para lo mismo («Hnos.», «Cía.», «AMZN») */
const ABBREVIATIONS: Readonly<Record<string, string>> = Object.freeze({
  cia: 'compania', hnos: 'hermanos', hmnos: 'hermanos', asoc: 'asociacion', assoc: 'asociacion', fund: 'fundacion', fdn: 'fundacion',
  ayto: 'ayuntamiento', univ: 'universidad', inst: 'instituto', dpto: 'departamento', distrib: 'distribuciones', cdad: 'comunidad',
  amzn: 'amazon', msft: 'microsoft',
})
/** Palabras de enlace que no cuentan para unas siglas («Banco Bilbao Vizcaya Argentaria» = BBVA) */
const LINKS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'i', 'and', 'of', 'en'])

/** «B.B.V.A.» y «b b v a» se leen como una sola palabra */
function joinedLetters(key: string) {
  return key.replace(/\b[a-z](?: [a-z]\b)+/g, m => m.replace(/ /g, ''))
}
/** Palabras que identifican: sin formas jurídicas, relleno del banco ni cifras */
export function significantWords(s?: string | null) {
  return joinedLetters(nameKey(s)).split(' ').map(w => ABBREVIATIONS[w] ?? w).filter(w => w.length >= 3 && !FILLER.has(w) && !/^\d+$/.test(w))
}
const words = significantWords

/** Siglas de un nombre de al menos tres palabras: «El Corte Inglés» → «eci» */
function acronym(s?: string | null) {
  const all = joinedLetters(nameKey(s)).split(' ').filter(w => w && !LINKS.has(w) && !/^\d+$/.test(w))
  return all.length >= 3 ? all.map(w => w[0]).join('') : ''
}

/** Distancia de edición con transposición («Iberdorla» → «Iberdrola» = 1); corta al pasar de `max` */
function editDistance(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev2: number[] = []
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1)
      row.push(v)
      best = Math.min(best, v)
    }
    if (best > max) return max + 1
    prev2 = prev
    prev = row
  }
  return prev[b.length]!
}

/** 2 = la misma palabra o abreviada («Endesa»/«Endes…» desde 5 letras); 1 = con una errata; 0 = otra */
function wordMatch(w: string, x: string): 0 | 1 | 2 {
  if (w === x) return 2
  const min = Math.min(w.length, x.length)
  if (min >= 5 && (x.startsWith(w) || w.startsWith(x))) return 2
  // Erratas solo en palabras largas y con la misma inicial: «García» y «Gracia» siguen siendo dos apellidos
  if (min < 7 || w[0] !== x[0]) return 0
  return editDistance(w, x, min >= 10 ? 2 : 1) <= (min >= 10 ? 2 : 1) ? 1 : 0
}

/**
 * Cuánto se parecen dos nombres, de 0 (nada) a 1 (las mismas palabras). Todas las palabras significativas
 * del más corto deben estar en el otro, como mucho una con una errata: «Endesa» y «Endesa Energía, S.A.U.»,
 * «Telefonica» y «Telefónica de España», «GARCIA LOPEZ MARIA» y «María García López». También las siglas
 * («BBVA» y «Banco Bilbao Vizcaya Argentaria»). Un nombre de una sola palabra necesita 5 letras («Juan» no basta).
 */
export function nameSimilarity(a?: string | null, b?: string | null): number {
  const wa = words(a), wb = words(b)
  if (!wa.length || !wb.length) return 0
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa]
  if (!(short.length === 1 && short[0]!.length < 5)) {
    let typos = 0
    const all = short.every((w) => {
      const best = Math.max(0, ...long.map(x => wordMatch(w, x)))
      if (best === 1) typos++
      return best > 0
    })
    // Una errata en un nombre de una sola palabra exige 8 letras («Vodafone»/«Vodafon»)
    if (all && typos <= 1 && !(typos && short.length === 1 && short[0]!.length < 8)) {
      return Math.max(0.5, short.length / long.length - typos * 0.15)
    }
  }
  // Siglas: «BBVA» (4 letras o más) en el otro texto, o el nombre entero de 3 letras («ECI»)
  for (const [x, y] of [[a, wb], [b, wa]] as const) {
    const ac = acronym(x)
    if (ac.length >= 4 && y.includes(ac)) return 0.7
    if (ac.length === 3 && y.length === 1 && y[0] === ac) return 0.7
  }
  return 0
}

/** ¿Nombran a lo mismo? Ver `nameSimilarity` */
export function similarNames(a?: string | null, b?: string | null): boolean {
  return nameSimilarity(a, b) > 0
}

/** Parecido de un contacto con un nombre leído: el mejor de su razón social y su nombre comercial */
export function contactNameScore(c: DuplicateParty, ...names: Array<string | null | undefined>) {
  return Math.max(0, ...names.flatMap(n => [nameSimilarity(c.name, n), nameSimilarity(c.tradeName, n)]))
}

/**
 * De varios contactos con un nombre parecido, el que destaca: el único, o el que coincide con todas sus
 * palabras cuando los demás solo en parte («María García López» frente a «María García»).
 */
export function bestByName<T extends DuplicateParty>(contacts: T[], ...names: Array<string | null | undefined>): { contact: T, score: number } | undefined {
  const ranked = contacts.map(c => ({ contact: c, score: contactNameScore(c, ...names) })).filter(r => r.score > 0)
    .sort((x, y) => y.score - x.score)
  const [first, second] = ranked
  if (!first) return undefined
  if (second && second.score > first.score - 0.25) return undefined
  return first
}

/**
 * Contacto existente para un cliente o proveedor leído: el del mismo NIF o datos y, si no hay, el que
 * destaca por un nombre parecido («Endesa» creado desde el banco para «Endesa Energía, S.A.U.»).
 * Con NIF solo se une a fichas sin NIF: dos NIF distintos nunca son el mismo contacto.
 */
export function findSimilarContact<T extends DuplicateParty>(contacts: T[], party: DuplicateParty): T | undefined {
  const exact = findImportContact(contacts, party)
  if (exact) return exact
  const nif = nifKey(party.nif)
  return bestByName(contacts.filter(c => !nif || !nifKey(c.nif)), party.name, party.tradeName)?.contact
}

/**
 * ¿Aparece el nombre de un contacto en un concepto del banco? Devuelve cuántas de sus palabras están
 * (0 si falta alguna): «TRANSF SEPA DE ACME CONSULTING SL FRA 23» nombra a «Acme Consulting, S.L.» (2),
 * «COMPRA TARJ LIDL 1234» a «Lidl» (1; en un texto basta con 4 letras si es la palabra entera).
 * Admite una errata en una palabra larga y las siglas («BBVA»).
 */
export function nameInText(name?: string | null, text?: string | null): number {
  const wn = words(name), wt = words(text)
  if (!wn.length || !wt.length) return 0
  if (wn.length === 1 && wn[0]!.length < 5) return wn[0]!.length === 4 && wt.includes(wn[0]!) ? 1 : 0
  let typos = 0
  const all = wn.every((w) => {
    const best = Math.max(0, ...wt.map(x => wordMatch(w, x)))
    if (best === 1) typos++
    return best > 0
  })
  if (all && typos <= 1 && !(typos && wn.length === 1 && wn[0]!.length < 8)) return wn.length - typos * 0.5
  const ac = acronym(name)
  return ac.length >= 4 && wt.includes(ac) ? 1 : 0
}

/**
 * NIF que aparecen en un concepto del banco o un texto: sueltos («B12345678», «ES-B12.345.678») o dentro del
 * identificador de acreedor SEPA de un recibo domiciliado («ES12000B12345678»: país, control, sufijo y NIF).
 * Solo los que pasan la letra o cifra de control: una referencia cualquiera no se toma por un NIF.
 */
export function taxIdsInText(text?: string | null): string[] {
  const t = (text ?? '').toUpperCase().replace(/(?<=[A-Z0-9])[.\-](?=[A-Z0-9])/g, '')
  const out = new Set<string>()
  for (const m of t.matchAll(/ES\d{2}[A-Z0-9]{3}([A-Z0-9]{9})(?![A-Z0-9])/g)) if (validateNif(m[1]!).valid) out.add(m[1]!)
  for (const m of t.matchAll(/(?<![A-Z0-9])(?:ES)?(\d{8}[A-Z]|[XYZ]\d{7}[A-Z]|[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J])(?![A-Z0-9])/g)) {
    if (validateNif(m[1]!).valid) out.add(m[1]!)
  }
  return [...out]
}

/** ¿Cuadra el dígito de control del IBAN? (ISO 13616, módulo 97) */
export function validIban(raw?: string | null) {
  const iban = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const digits = `${iban.slice(4)}${iban.slice(0, 4)}`.replace(/[A-Z]/g, ch => String(ch.charCodeAt(0) - 55))
  let rest = 0
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97
  return rest === 1
}

/** IBAN válidos que aparecen en un texto, con o sin espacios («ES91 2100 0418 4502 0005 1332») */
export function ibansInText(text?: string | null): string[] {
  const t = (text ?? '').toUpperCase()
  const found = new Set<string>()
  for (const m of t.matchAll(/(?<![A-Z0-9])[A-Z]{2}\d{2}[A-Z0-9]{11,30}(?![A-Z0-9])/g)) if (validIban(m[0])) found.add(m[0])
  // En grupos de cuatro: el grupo siguiente puede ser ya el concepto («… 1332 CONC…»), se prueba del más largo al más corto
  for (const m of t.matchAll(/(?<![A-Z0-9])[A-Z]{2}\d{2}(?: [A-Z0-9]{1,4}){3,8}/g)) {
    const groups = m[0].split(' ')
    for (let n = groups.length; n >= 4; n--) {
      const iban = groups.slice(0, n).join('')
      if (validIban(iban)) {
        found.add(iban)
        break
      }
    }
  }
  return [...found]
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
  if (gap == null) return null
  if (!sameTotal) {
    // Unos céntimos de diferencia (una lectura con redondeo): la misma contraparte en fechas cercanas
    const diff = cents(a.total) != null && cents(b.total) != null ? Math.abs(cents(a.total)! - cents(b.total)!) : null
    if (party && diff != null && diff <= NEAR_CENTS && gap <= NEAR_DAYS) {
      return { reason: `Mismo ${expense ? 'proveedor' : 'cliente'} y casi el mismo importe (${diff} ${diff === 1 ? 'céntimo' : 'céntimos'} de diferencia)`, certain: false, days: gap + 1 }
    }
    return null
  }
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

  /** `near`: al buscar, también los importes a unos céntimos */
  private keys(r: DuplicateRecord, near = false) {
    const prefix = group(r)
    if (r.type === 'contact') return partyKeys(r.party).map(k => `${prefix}|${k}`)
    // Por número y por importe: las demás reglas exigen el mismo importe (o casi)
    const total = cents(r.total)
    const totals = total == null ? [] : near ? Array.from({ length: NEAR_CENTS * 2 + 1 }, (_, i) => total - NEAR_CENTS + i) : [total]
    return [
      ...(numberKey(r.number) ? [`${prefix}|number:${numberKey(r.number)}`] : []),
      ...totals.map(t => `${prefix}|total:${t}`),
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
    for (const key of this.keys(record, true)) {
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
