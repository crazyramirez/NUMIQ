import type { ExtractedDocument, ExtractedParty, ImportDirection } from '../../shared/types/import'
import { findImportContact, sameImportParty } from '../../shared/utils/duplicate-matching'
import type { DuplicateParty } from '../../shared/utils/duplicate-matching'

export interface ImportCompanyIdentity {
  legalName: string
  tradeName: string | null
  nif: string
  ibans?: string[]
  contact?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  postalCode?: string | null
  city?: string | null
  province?: string | null
  country?: string | null
  defaultVatRate?: number | null
}

export interface ImportKnownParty extends DuplicateParty {
  name: string
  isClient?: boolean
  isSupplier?: boolean
  iban?: string | null
  /** Ventas (facturas y presupuestos) y gastos ya guardados con este contacto: dicen si es cliente o proveedor habitual */
  issuedCount?: number
  receivedCount?: number
}

const bankKey = (value?: string | null) => (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const taxKey = (value?: string | null) => {
  const key = (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return /^ES[0-9A-Z]\d{7}[0-9A-Z]$/.test(key) ? key.slice(2) : key
}
const PERSON_NIF = /^(\d{8}[A-Z]|[KLMXYZ]\d{7}[A-Z])$/
const ENTITY_NIF = /^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/
/** Tipos de retención de actividades profesionales y de módulos: solo los practica una empresa al pagar a una persona física */
const PERSON_RETENTION_RATES = [1, 2, 7, 15]

export function isOwnImportParty(party: DuplicateParty | null | undefined, company: ImportCompanyIdentity) {
  return sameImportParty(party, { ...company, name: company.legalName })
}

/**
 * Papel de un contacto guardado (positivo: cliente; negativo: proveedor). Su historial de ventas y gastos pesa
 * más que las casillas de cliente o proveedor; con historial mixto solo cuenta si un lado domina claramente.
 */
export function contactRoleWeight(c?: ImportKnownParty) {
  if (!c) return 0
  const issued = c.issuedCount ?? 0, received = c.receivedCount ?? 0
  if (issued && !received) return issued >= 2 ? 3 : 2
  if (received && !issued) return received >= 2 ? -3 : -2
  if (issued || received) return issued >= 4 * received && issued >= 4 ? 1 : received >= 4 * issued && received >= 4 ? -1 : 0
  return c.isClient !== c.isSupplier ? (c.isClient ? 1 : -1) : 0
}

/**
 * Retención profesional (7 o 15 %, o la de módulos): la factura la emite la persona física y la paga la empresa.
 * Positivo si la empresa usuaria es la persona y la contraparte una sociedad (emitida); negativo al revés.
 */
function retentionWeight(d: ExtractedDocument, company: ImportCompanyIdentity, counterpartNif?: string | null) {
  const base = d.taxLines.reduce((s, t) => s + t.base, 0)
  const rate = d.irpfRate || (d.irpfAmount && base ? Math.abs(d.irpfAmount / base) * 100 : 0)
  if (!rate || !PERSON_RETENTION_RATES.some(r => Math.abs(r - Math.abs(rate)) < 0.2)) return 0
  const ownNif = taxKey(company.nif), other = taxKey(counterpartNif)
  if (PERSON_NIF.test(ownNif) && ENTITY_NIF.test(other)) return 3
  if (ENTITY_NIF.test(ownNif) && PERSON_NIF.test(other)) return -3
  return 0
}

const sign = (n: number): ImportDirection | null => n > 0 ? 'issued' : n < 0 ? 'received' : null

/**
 * Resuelve identidad y papel por separado: el orden de los bloques no identifica al contacto. Cada prueba suma a
 * favor de emitida (positivo) o recibida (negativo): la cuenta de cobro o de cargo, el pie y el titular del cobro,
 * la retención profesional, el historial del contacto y, por último, qué bloque leyó la IA como emisor.
 */
export function resolveInvoiceParties(d: ExtractedDocument, company: ImportCompanyIdentity, contacts: ImportKnownParty[] = [], fallback?: ImportDirection | null, chosen?: ImportDirection | null) {
  const own = (p?: DuplicateParty | null) => isOwnImportParty(p, company)
  const issuerOwn = own(d.issuer), recipientOwn = own(d.recipient)
  const read: ImportDirection | null = issuerOwn !== recipientOwn ? (issuerOwn ? 'issued' : 'received') : null
  const externalContacts = contacts.filter(c => !own(c))
  const known = (p: DuplicateParty | null | undefined) => p ? findImportContact(externalContacts, p) : undefined
  let counterparty = issuerOwn !== recipientOwn ? (issuerOwn ? d.recipient : d.issuer) : null
  const account = bankKey(d.iban)
  const ownAccount = !!account && (company.ibans ?? []).some(iban => bankKey(iban) === account)
  const bankContacts = account ? externalContacts.filter(c => bankKey(c.iban) === account) : []
  const bankContact = bankContacts.length === 1 ? bankContacts[0] : undefined
  // Una cuenta de domiciliación pertenece al pagador, no a quien cobra.
  const bankRole = d.paymentMethod === 'direct_debit' ? 'payer'
    : d.ibanRole ?? (d.paymentMethod === 'transfer' || d.payeeName ? 'payee' : 'unknown')
  const bankWeight = bankRole === 'unknown' ? 0
    : ownAccount ? (bankRole === 'payee' ? 4 : -4)
      : bankContact ? (bankRole === 'payee' ? -3 : 3) : 0

  const footer = d.footerParty ?? (d.footerName ? { name: d.footerName } : null)
  const payee = d.paymentMethod !== 'direct_debit' && d.payeeName ? { name: d.payeeName } : null
  const parties = [d.issuer, d.recipient].filter((p): p is ExtractedParty => !!p && !own(p))
  const evidenceWeight = (p: DuplicateParty | null) => {
    if (!p) return 0
    const matchesOwn = own(p)
    const matchesOther = !!known(p) || parties.some(other => sameImportParty(other, p))
    // Un nombre compartido por dos NIF distintos no basta para decidir quién es.
    if (matchesOwn && matchesOther) return 0
    if (matchesOwn) return 3
    // Repetir como pie o titular al mismo emisor que leyó la IA no es una prueba nueva: es su misma lectura
    // (lo hace al confundir los bloques, con una cuenta sin titular o sin pie de página).
    if (!matchesOther || (d.issuer && !own(d.issuer) && sameImportParty(d.issuer, p))) return 0
    return -3
  }
  const footerWeight = evidenceWeight(footer)
  const payeeWeight = evidenceWeight(payee)
  const strong = [bankWeight, footerWeight, payeeWeight].filter(Boolean)
  const conflict = strong.some(w => w > 0) && strong.some(w => w < 0)

  if (!counterparty && !(issuerOwn && recipientOwn)) {
    const matches = parties.filter(p => !!known(p))
    const bankMatches = bankContact ? parties.filter(p => sameImportParty(p, bankContact)) : []
    if (bankMatches.length === 1) counterparty = bankMatches[0]!
    else if (matches.length === 1) counterparty = matches[0]!
    else if (parties.length === 1 && (ownAccount || footerWeight > 0 || payeeWeight > 0)) counterparty = parties[0]!
  }
  const saved = known(counterparty)
  const contactWeight = contactRoleWeight(saved)
  const counterpartNifs = [...new Set(parties.map(p => taxKey(p.nif)).filter(Boolean))]
  const retention = retentionWeight(d, company, counterparty?.nif ?? (counterpartNifs.length === 1 ? counterpartNifs[0] : null))
  const readWeight = read === 'issued' ? 2 : read === 'received' ? -2 : 0
  // Primero lo que prueba el propio documento; si no dice nada, el historial del contacto y la lectura de la IA
  // (un cliente habitual pesa más que una lectura que pudo cruzar los bloques). En empate, la prueba más fiable.
  const documentScore = bankWeight + footerWeight + payeeWeight + retention
  const historyScore = contactWeight + readWeight
  const decided = sign(documentScore) ?? sign(historyScore)
    ?? sign([bankWeight, footerWeight, payeeWeight, retention, contactWeight, readWeight].find(Boolean) ?? 0)
  const quote = d.documentType === 'quote' || d.documentType === 'proforma'
  // Lo que el usuario eligió al importar (emitidas o recibidas) manda: las pruebas solo sirven para hallar la contraparte
  const confirmedReceived = chosen ? chosen === 'received' : !conflict && decided === 'received' && (documentScore < 0 || historyScore <= -2)
  const direction: ImportDirection = chosen ?? (quote && !confirmedReceived ? 'issued' : decided ?? fallback ?? 'received')
  const detectedOwnParty = issuerOwn ? d.issuer : recipientOwn ? d.recipient : null
  let warning: string | null = null
  const unrelated = !issuerOwn && !recipientOwn && !!taxKey(d.issuer?.nif) && !!taxKey(d.recipient?.nif)
    && taxKey(d.issuer?.nif) !== taxKey(d.recipient?.nif)
  if (!counterparty && !detectedOwnParty && !strong.length) counterparty = quote && parties.length === 1 ? parties[0]! : direction === 'issued' ? d.recipient : d.issuer
  if (own(counterparty)) counterparty = null

  // NIF exacto del contacto: corrige un nombre propio que la IA haya mezclado con ese NIF.
  const canonical = known(counterparty)
  if (counterparty && canonical?.nif && taxKey(canonical.nif) === taxKey(counterparty.nif)
    && own({ name: counterparty.name })) {
    counterparty = { ...counterparty, name: canonical.name }
    for (const field of ['email', 'phone', 'address'] as const) {
      if (counterparty[field] && counterparty[field] === company[field]) counterparty[field] = canonical[field] ?? null
    }
  }

  const companyAsParty: ExtractedParty = {
    name: company.legalName,
    nif: company.nif,
    address: company.address ?? null,
    postalCode: company.postalCode ?? null,
    city: company.city ?? null,
    province: company.province ?? null,
    country: company.country ?? 'ES',
    email: company.email ?? null,
    phone: company.phone ?? null,
    isPerson: false,
  }
  const ownParty = detectedOwnParty ?? companyAsParty

  if (issuerOwn && recipientOwn) warning = 'Ambas partes corresponden a tu empresa: no se ha podido identificar al cliente o proveedor'
  else if (conflict && !chosen) warning = 'La cuenta de pago y los datos del emisor se contradicen: revisa las partes del documento'
  else if (unrelated) warning = 'Los NIF de ambas partes son distintos del de tu empresa: revisa a quién corresponde el documento'
  else if (chosen) warning = !counterparty && !['receipt', 'simplified_invoice'].includes(d.documentType) ? `No se ha podido identificar al ${direction === 'issued' ? 'cliente' : 'proveedor'} con los datos del documento y de la app` : null
  else if (!quote && !read && !strong.length && !retention && !contactWeight) warning = 'No se ha podido contrastar quién emite el documento con los datos de tu empresa y tus contactos'
  // Sin cuenta, pie ni retención que lo confirmen, el historial del contacto ha contradicho a la lectura
  else if (!quote && !strong.length && !retention && counterparty && Math.abs(contactWeight) >= 2 && sign(contactWeight) === direction && sign(readWeight) && sign(readWeight) !== direction) {
    warning = direction === 'issued'
      ? `${saved?.name ?? counterparty.name} es cliente habitual: se ha tomado como factura emitida aunque la lectura situaba a tu empresa como destinataria. Revísalo`
      : `${saved?.name ?? counterparty.name} es proveedor habitual: se ha tomado como gasto aunque la lectura situaba a tu empresa como emisora. Revísalo`
  }
  else if (!counterparty && !['receipt', 'simplified_invoice'].includes(d.documentType)) warning = `No se ha podido identificar al ${direction === 'issued' ? 'cliente' : 'proveedor'} con los datos del documento y de la app`
  const swapped = !!counterparty && (direction === 'issued' ? counterparty === d.issuer : counterparty === d.recipient)
  return {
    direction, swapped, warning, confirmedReceived,
    // Nunca crear un contacto con los datos de la propia empresa por una lectura invertida.
    blocking: (issuerOwn && recipientOwn) || (conflict && !chosen),
    document: { ...d, issuer: direction === 'issued' ? ownParty : counterparty, recipient: direction === 'issued' ? counterparty : ownParty },
  }
}
