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
}

const nameKey = (s?: string | null) => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  .replace(/\b(s\s?l\s?u?|s\s?a\s?u?|s\s?l\s?l|s\s?c\s?p|c\s?b|s\s?coop|sociedad (limitada|anonima)( unipersonal)?|slne|sau|slu)$/, '').trim()
const nifKey = (s?: string | null) => {
  const n = (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return /^ES[0-9A-Z]\d{7}[0-9A-Z]$/.test(n) ? n.slice(2) : n
}
const numberKey = (s?: string | null) => (s ?? '').toUpperCase().replace(/[\s.\-/_]/g, '')
const names = (p: DuplicateParty) => [nameKey(p.name), nameKey(p.tradeName)].filter(Boolean)
const emailKey = (p: DuplicateParty) => p.email?.trim().toLowerCase() || ''
const phoneKey = (p: DuplicateParty) => p.phone?.replace(/\D/g, '') || ''

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

const group = (r: DuplicateRecord) => r.type === 'sales'
  ? `sales:${r.kind === 'quote' || r.kind === 'proforma' ? r.kind : 'invoice'}` : r.type

export function importDuplicateReason(a: DuplicateRecord, b: DuplicateRecord): string | null {
  if (group(a) !== group(b)) return null
  const party = sameImportParty(a.party, b.party)
  if (a.type === 'contact') return party ? 'Coinciden los datos del contacto' : null
  const an = numberKey(a.number), bn = numberKey(b.number)
  const sameYear = !a.issueDate || !b.issueDate || a.issueDate.slice(0, 4) === b.issueDate.slice(0, 4)
  if (an && bn) {
    if (an !== bn || !sameYear) return null
    if (a.type === 'sales' || party) return 'Coinciden el número y el ejercicio' + (a.type === 'expense' ? ' del proveedor' : '')
    return null
  }
  if (party && a.issueDate && a.issueDate === b.issueDate && a.total != null && b.total != null
    && Number.isFinite(a.total) && Number.isFinite(b.total) && Math.round(a.total * 100) === Math.round(b.total * 100)) {
    return 'Coinciden el cliente o proveedor, la fecha y el importe'
  }
  return null
}

/** Índice con candidatos múltiples: conserva los homónimos y verifica sus NIF. */
export class ImportDuplicateIndex<T> {
  private entries = new Map<string, Array<{ record: DuplicateRecord, value: T }>>()

  private keys(r: DuplicateRecord) {
    const prefix = group(r)
    const parties = partyKeys(r.party)
    if (r.type === 'contact') return parties.map(k => `${prefix}|${k}`)
    return [
      ...(numberKey(r.number) ? [`${prefix}|number:${numberKey(r.number)}`] : []),
      ...(r.issueDate && r.total != null && Number.isFinite(r.total)
        ? parties.map(k => `${prefix}|${k}|${r.issueDate}|${Math.round(r.total! * 100)}`) : []),
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

  find(record: DuplicateRecord): { value: T, reason: string } | null {
    for (const key of this.keys(record)) {
      for (const entry of this.entries.get(key) ?? []) {
        const reason = importDuplicateReason(record, entry.record)
        if (reason) return { value: entry.value, reason }
      }
    }
    return null
  }
}
