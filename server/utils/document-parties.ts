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
}

const bankKey = (value?: string | null) => (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const taxKey = (value?: string | null) => {
  const key = (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return /^ES[0-9A-Z]\d{7}[0-9A-Z]$/.test(key) ? key.slice(2) : key
}

export function isOwnImportParty(party: DuplicateParty | null | undefined, company: ImportCompanyIdentity) {
  return sameImportParty(party, { ...company, name: company.legalName })
}

/** Resuelve identidad y papel por separado: el orden de los bloques no identifica al contacto. */
export function resolveInvoiceParties(d: ExtractedDocument, company: ImportCompanyIdentity, contacts: ImportKnownParty[] = [], fallback?: ImportDirection | null) {
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
  const bankDirection: ImportDirection | null = bankRole === 'unknown' ? null
    : ownAccount ? (bankRole === 'payee' ? 'issued' : 'received')
      : bankContact ? (bankRole === 'payee' ? 'received' : 'issued') : null

  const footer = d.footerParty ?? (d.footerName ? { name: d.footerName } : null)
  const payee = d.paymentMethod !== 'direct_debit' && d.payeeName ? { name: d.payeeName } : null
  const parties = [d.issuer, d.recipient].filter((p): p is ExtractedParty => !!p && !own(p))
  const evidenceDirection = (p: DuplicateParty | null): ImportDirection | null => {
    if (!p) return null
    const matchesOwn = own(p)
    const matchesOther = !!known(p) || parties.some(other => sameImportParty(other, p))
    // Un nombre compartido por dos NIF distintos no basta para decidir quién es.
    if (matchesOwn && matchesOther) return null
    return matchesOwn ? 'issued' : matchesOther ? 'received' : null
  }
  const footerDirection = evidenceDirection(footer)
  const payeeDirection = evidenceDirection(payee)
  const strong = [bankDirection, footerDirection, payeeDirection].filter((v): v is ImportDirection => !!v)
  const conflict = new Set(strong).size > 1

  if (!counterparty && !(issuerOwn && recipientOwn)) {
    const matches = parties.filter(p => !!known(p))
    const bankMatches = bankContact ? parties.filter(p => sameImportParty(p, bankContact)) : []
    if (bankMatches.length === 1) counterparty = bankMatches[0]!
    else if (matches.length === 1) counterparty = matches[0]!
    else if (parties.length === 1 && (ownAccount || footerDirection === 'issued' || payeeDirection === 'issued')) counterparty = parties[0]!
  }
  const saved = known(counterparty)
  const contactDirection: ImportDirection | null = saved?.isClient !== saved?.isSupplier
    ? saved?.isClient ? 'issued' : saved?.isSupplier ? 'received' : null : null
  const quote = d.documentType === 'quote' || d.documentType === 'proforma'
  const confirmedReceived = !conflict && (strong.length ? strong.includes('received')
    : (read !== 'issued' && contactDirection === 'received')
      || (contactDirection !== 'issued' && read === 'received' && !!taxKey(d.issuer?.nif) && taxKey(d.recipient?.nif) === taxKey(company.nif)))
  const direction: ImportDirection = quote && !confirmedReceived ? 'issued'
    : bankDirection ?? footerDirection ?? payeeDirection ?? read ?? contactDirection ?? fallback ?? 'received'
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
  else if (conflict) warning = 'La cuenta de pago y los datos del emisor se contradicen: revisa las partes del documento'
  else if (unrelated) warning = 'Los NIF de ambas partes son distintos del de tu empresa: revisa a quién corresponde el documento'
  else if (!quote && !read && !strong.length && !contactDirection) warning = 'No se ha podido contrastar quién emite el documento con los datos de tu empresa y tus contactos'
  else if (!counterparty && !['receipt', 'simplified_invoice'].includes(d.documentType)) warning = `No se ha podido identificar al ${direction === 'issued' ? 'cliente' : 'proveedor'} con los datos del documento y de la app`
  const swapped = !!counterparty && (direction === 'issued' ? counterparty === d.issuer : counterparty === d.recipient)
  return {
    direction, swapped, warning, confirmedReceived,
    // Nunca crear un contacto con los datos de la propia empresa por una lectura invertida.
    blocking: (issuerOwn && recipientOwn) || conflict,
    document: { ...d, issuer: direction === 'issued' ? ownParty : counterparty, recipient: direction === 'issued' ? counterparty : ownParty },
  }
}
