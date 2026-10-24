/**
 * Limpieza de los clientes y proveedores que llegan en un listado (Excel, CSV, PDF, texto pegado):
 * cada dato queda en su forma correcta (NIF, email, teléfono, IBAN, código postal y provincia) y se
 * anota qué se ha cambiado y qué hay que revisar. Ningún dato inválido llega a guardarse: lo que no
 * se puede arreglar con seguridad se marca como error para que lo decida el usuario.
 */

export interface ContactDraft {
  kind: 'company' | 'person' | null
  name: string | null
  tradeName: string | null
  contactPerson: string | null
  nif: string | null
  nifType: 'nif' | 'vat_eu' | 'passport' | 'other' | null
  email: string | null
  phone: string | null
  website: string | null
  address: string | null
  postalCode: string | null
  city: string | null
  province: string | null
  country: string | null
  iban: string | null
  paymentTermsDays: number | null
  irpfRate: number | null
  notes: string | null
}

export type ContactDraftField = Exclude<keyof ContactDraft, 'nifType'>

export interface ContactChange {
  field: ContactDraftField
  from: string | null
  to: string | null
  reason: string
  /** Cambio de forma (mayúsculas, puntos de la forma jurídica): no hace falta revisarlo */
  minor?: boolean
  by: 'rule' | 'ai'
}

export interface ContactIssue {
  field: ContactDraftField | null
  level: 'error' | 'warning'
  text: string
  /** Valor propuesto para arreglarlo con un toque */
  fix?: string
}

/** Ficha vacía: todos los campos a null */
export function emptyContactDraft(): ContactDraft {
  return { kind: null, name: null, tradeName: null, contactPerson: null, nif: null, nifType: null, email: null, phone: null, website: null, address: null, postalCode: null, city: null, province: null, country: null, iban: null, paymentTermsDays: null, irpfRate: null, notes: null }
}

/**
 * Deja cada dato en su forma correcta. Es idempotente: pasar dos veces no cambia nada más.
 * `kind` puede quedar null si nada lo indica (sin NIF ni forma jurídica): lo decide la IA o, al final, «empresa».
 */
export function cleanContactDraft(input: Partial<ContactDraft>): { contact: ContactDraft, changes: ContactChange[] } {
  const c: ContactDraft = { ...emptyContactDraft(), ...input }
  const changes: ContactChange[] = []
  const notes: string[] = []

  function set<K extends ContactDraftField>(field: K, value: ContactDraft[K], reason?: string, minor = false) {
    const from = c[field] == null ? null : String(c[field])
    const to = value == null ? null : String(value)
    if (from === to) return
    c[field] = value
    if (reason) changes.push({ field, from, to, reason, minor, by: 'rule' })
  }

  // Espacios sobrantes, saltos de línea y comillas de Excel: sin anotarlo
  for (const k of TEXT_FIELDS) c[k] = tidy(c[k])
  c.notes = c.notes?.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n') || null

  // ─── País ───
  if (c.country) {
    const code = countryCode(c.country)
    if (code) c.country = code
  }

  // ─── NIF ───
  if (c.nif) {
    const read = c.nif
    const n = cleanTaxId(read, c.country)
    c.nif = n.value
    c.nifType = n.type
    if (n.reason) changes.push({ field: 'nif', from: read, to: n.value, reason: n.reason, by: 'rule' })
    if (n.country && n.country !== c.country) set('country', n.country, c.country ? `País según el NIF-IVA (${n.value.slice(0, 2)})` : undefined)
    if (n.kind && n.kind !== c.kind) set('kind', n.kind, c.kind ? (n.kind === 'person' ? 'Por su NIF es una persona física' : 'Por su NIF es una sociedad o entidad') : undefined)
  }
  else c.nifType = null

  // ─── Nombre, nombre comercial y persona de contacto ───
  if (c.name) {
    const legal = normalizeLegalForm(c.name)
    if (legal !== c.name) set('name', legal, 'Forma jurídica escrita de forma estándar', true)
  }
  if (c.tradeName) c.tradeName = normalizeLegalForm(c.tradeName)
  if (!c.name && c.tradeName) {
    set('name', c.tradeName, 'Sin razón social: se usa el nombre comercial')
    c.tradeName = null
  }
  if (!c.name && c.contactPerson) {
    set('name', c.contactPerson, 'Sin razón social: se usa el nombre de la persona')
    c.contactPerson = null
  }
  if (c.tradeName && plain(c.tradeName) === plain(c.name)) set('tradeName', null, 'Era igual que el nombre', true)
  if (c.contactPerson && plain(c.contactPerson) === plain(c.name)) set('contactPerson', null, 'Era igual que el nombre', true)
  if (!c.kind && c.name && looksLikeCompany(c.name)) c.kind = 'company'

  // ─── Email (el primero válido; los demás, a las notas) ───
  if (c.website?.includes('@') && !c.email) {
    set('email', c.website, 'Estaba en la columna de la web')
    c.website = null
  }
  if (c.email) {
    const read = c.email
    const list = splitEmails(read)
    const valid = list.filter(e => EMAIL_RE.test(e.value))
    if (valid.length) {
      const first = valid[0]!
      c.email = first.value
      if (first.fixed) changes.push({ field: 'email', from: read, to: first.value, reason: 'Corregida una errata del dominio', by: 'rule' })
      else if (valid.length > 1) changes.push({ field: 'email', from: read, to: first.value, reason: 'Tenía varios: los demás van a las notas', by: 'rule' })
      if (valid.length > 1) notes.push(`Otros emails: ${valid.slice(1).map(e => e.value).join(', ')}`)
    }
    else c.email = read.trim().toLowerCase()
  }

  // ─── Teléfono (el primero; los demás, a las notas) ───
  if (c.phone) {
    const read = c.phone
    const list = splitPhones(read)
    if (list.length) {
      c.phone = list[0]!
      if (list.length > 1) {
        changes.push({ field: 'phone', from: read, to: list[0]!, reason: 'Tenía varios: los demás van a las notas', by: 'rule' })
        notes.push(`Otros teléfonos: ${list.slice(1).join(', ')}`)
      }
    }
  }

  // ─── Web ───
  if (c.website) c.website = cleanWebsite(c.website)

  // ─── Dirección: mayúsculas, código postal y provincia ───
  if (c.address) {
    const fixed = tidyAddress(c.address)
    if (fixed !== c.address) set('address', fixed, isAllCaps(c.address) ? 'Mayúsculas corregidas' : 'Tipo de vía escrito de forma estándar', true)
  }
  if (c.city && isAllCaps(c.city)) set('city', titleCaseEs(c.city), 'Mayúsculas corregidas', true)
  const spain = !c.country || c.country === 'ES'
  if (c.postalCode && spain) {
    const digits = c.postalCode.replace(/[\s.]/g, '')
    if (/^\d{4}$/.test(digits) && provinceFromPostalCode(`0${digits}`)) set('postalCode', `0${digits}`, 'Añadido el 0 inicial que quita Excel')
    else if (/^\d{5}$/.test(digits)) c.postalCode = digits
  }
  const cpProvince = spain ? provinceFromPostalCode(c.postalCode) : null
  if (cpProvince) {
    if (!c.province) set('province', cpProvince, 'Deducida del código postal')
    else if (!sameProvince(c.province, cpProvince)) set('province', cpProvince, `Corregida según el código postal (ponía «${c.province}»)`)
    else if (isAllCaps(c.province) || plain(c.province) !== plain(cpProvince)) c.province = canonicalProvinceSpelling(c.province, cpProvince)
  }
  else if (c.province) {
    const known = spain ? provinceByName(c.province) : null
    if (known && known !== c.province) set('province', known, 'Nombre de la provincia escrito de forma estándar', true)
    else if (isAllCaps(c.province)) c.province = titleCaseEs(c.province)
  }
  if (spain && !c.country && (cpProvince || c.province)) c.country = 'ES'

  // ─── IBAN ───
  if (c.iban) {
    const read = c.iban
    const v = read.toUpperCase().replace(/^IBAN[:\s]*/, '').replace(/[^A-Z0-9]/g, '')
    if (/^\d{20}$/.test(v) && validCcc(v)) {
      const iban = ibanFromCcc(v)
      set('iban', iban, 'Cuenta de 20 dígitos convertida a IBAN')
    }
    else c.iban = v
  }

  // ─── Plazo de pago y retención ───
  if (c.paymentTermsDays != null) {
    const d = Math.round(Number(c.paymentTermsDays))
    c.paymentTermsDays = Number.isFinite(d) && d >= 0 && d <= 365 ? d : null
  }
  if (c.irpfRate != null) {
    const r = Number(c.irpfRate)
    c.irpfRate = Number.isFinite(r) && r >= 0 && r <= 100 ? Math.round(r * 100) / 100 : null
  }

  // ─── Notas: lo apartado se añade sin repetir ───
  const extra = notes.filter(n => !(c.notes ?? '').includes(n))
  if (extra.length) c.notes = [c.notes, ...extra].filter(Boolean).join('\n')

  for (const [k, max] of LIMITS) {
    const v = c[k]
    if (typeof v === 'string' && v.length > max) c[k] = v.slice(0, max).trim() as never
  }
  return { contact: c, changes }
}

/** Qué falta o está mal en una ficha ya limpia. Los errores impiden guardarla tal cual. */
export function checkContactDraft(c: ContactDraft): ContactIssue[] {
  const issues: ContactIssue[] = []
  if (!c.name?.trim()) issues.push({ field: 'name', level: 'error', text: 'Falta el nombre o la razón social' })

  if (c.nif) {
    if (c.nifType === 'nif' || !c.nifType) {
      if (!validateNif(c.nif).valid) {
        const fix = nifSuggestion(c.nif)
        issues.push({ field: 'nif', level: 'error', text: fix ? `NIF no válido: con estos números el correcto sería ${fix}` : 'NIF no válido: revisa sus números y la letra', ...(fix ? { fix } : {}) })
      }
    }
    else if (c.nifType === 'vat_eu' && !looksLikeEuVat(c.nif)) {
      issues.push({ field: 'nif', level: 'error', text: 'NIF-IVA no válido: empieza por el código del país (FR, DE, PT…)' })
    }
  }
  else issues.push({ field: 'nif', level: 'warning', text: 'Sin NIF: lo necesitarás para que sus facturas sean completas' })

  if (c.email && !EMAIL_RE.test(c.email)) issues.push({ field: 'email', level: 'error', text: 'Email no válido' })
  if (c.iban && !validIban(c.iban)) issues.push({ field: 'iban', level: 'error', text: 'IBAN no válido: revisa los dígitos' })
  if (c.country && !/^[A-Z]{2}$/.test(c.country)) issues.push({ field: 'country', level: 'error', text: `País no reconocido («${c.country}»): elígelo de la lista` })

  const spain = !c.country || c.country === 'ES'
  if (spain && c.postalCode && !provinceFromPostalCode(c.postalCode)) issues.push({ field: 'postalCode', level: 'warning', text: 'Código postal español no válido' })
  if (c.phone && c.phone.replace(/\D/g, '').length < 9) issues.push({ field: 'phone', level: 'warning', text: 'Teléfono incompleto' })
  if (c.address && !c.city && !c.postalCode) issues.push({ field: 'city', level: 'warning', text: 'Falta la población' })
  return issues
}

// ─── NIF ─────────────────────────────────────────────────────────────────────

interface TaxIdClean {
  value: string
  type: 'nif' | 'vat_eu' | 'other'
  kind: 'company' | 'person' | null
  country: string | null
  reason: string | null
}

function kindOfNif(nif: string) {
  const r = validateNif(nif)
  return r.valid ? (r.kind === 'cif' ? 'company' as const : 'person' as const) : null
}

/** NIF español, NIF-IVA de otro país de la UE o documento extranjero, con las erratas seguras corregidas */
function cleanTaxId(raw: string, country: string | null): TaxIdClean {
  let v = normalizeNif(raw).replace(/^(NIF|CIF|DNI|NIE|VAT|NIFIVA)[:#]?/, '').replace(/[^A-Z0-9]/g, '')
  const spanish = (value: string, reason: string | null = null): TaxIdClean => ({ value, type: 'nif', kind: kindOfNif(value), country: null, reason })
  if (validateNif(v).valid) return spanish(v)
  // NIF-IVA español (ES + NIF): se guarda el NIF
  if (v.startsWith('ES') && validateNif(v.slice(2)).valid) return spanish(v.slice(2))
  // DNI al que Excel quitó el 0 inicial
  if (/^\d{7}[A-Z]$/.test(v) && validateNif(`0${v}`).valid) return spanish(`0${v}`, 'Añadido el 0 inicial que quita Excel')
  // Una O o una I donde va una cifra (errata típica al teclear o del OCR)
  const digitsFixed = fixDigitLookalikes(v)
  if (digitsFixed !== v && validateNif(digitsFixed).valid) return spanish(digitsFixed, 'Corregida una letra que debía ser una cifra (O→0, I→1)')
  if (looksLikeEuVat(v) && !v.startsWith('ES')) {
    const cc = v.slice(0, 2)
    return { value: v, type: 'vat_eu', kind: 'company', country: cc === 'EL' ? 'GR' : cc === 'XI' ? 'GB' : cc, reason: null }
  }
  // Documento de otro país (pasaporte, tax ID…): no se puede comprobar
  if (country && country !== 'ES' && !/^[XYZ]?\d{7,8}[A-Z]?$/.test(v) && !/^[A-W]\d{7}[0-9A-J]?$/.test(v)) {
    return { value: v, type: 'other', kind: null, country: null, reason: null }
  }
  return { value: v, type: 'nif', kind: null, country: null, reason: null }
}

/** O → 0 e I/L → 1 en las posiciones que solo admiten cifras */
function fixDigitLookalikes(v: string) {
  const swap = (s: string) => s.replace(/O/g, '0').replace(/[IL]/g, '1')
  if (/^[0-9OIL]{8}[A-Z]$/.test(v)) return swap(v.slice(0, 8)) + v[8]
  if (/^[XYZ][0-9OIL]{7}[A-Z]$/.test(v)) return v[0] + swap(v.slice(1, 8)) + v[8]
  if (/^[ABCDEFGHJNPQRSUVW][0-9OIL]{7}[0-9A-J]$/.test(v)) return v[0] + swap(v.slice(1, 8)) + v[8]
  return v
}

/** El NIF correcto para unos números a los que les falta o no les cuadra la letra (o el dígito) de control */
export function nifSuggestion(raw: string): string | null {
  const v = normalizeNif(raw)
  const letter = (n: number) => DNI_LETTERS[n % 23]
  let m = v.match(/^(\d{7,8})[A-Z]?$/)
  if (m) {
    const digits = m[1]!.padStart(8, '0')
    const fix = digits + letter(Number(digits))
    return fix !== v ? fix : null
  }
  m = v.match(/^([XYZ])(\d{7})[A-Z]?$/)
  if (m) {
    const fix = m[1]! + m[2]! + letter(Number('XYZ'.indexOf(m[1]!) + m[2]!))
    return fix !== v ? fix : null
  }
  m = v.match(/^([ABCDEFGHJNPQRSUVW])(\d{7})[0-9A-J]?$/)
  if (m) {
    let sum = 0
    for (let i = 0; i < 7; i++) {
      let d = Number(m[2]![i])
      if (i % 2 === 0) {
        d *= 2
        d = Math.floor(d / 10) + (d % 10)
      }
      sum += d
    }
    const control = (10 - (sum % 10)) % 10
    const fix = m[1]! + m[2]! + ('NPQRSW'.includes(m[1]!) ? 'JABCDEFGHI'[control] : String(control))
    return fix !== v ? fix : null
  }
  return null
}

// ─── Email, teléfono y web ───────────────────────────────────────────────────

function splitEmails(raw: string) {
  return raw.toLowerCase().replace(/mailto:/g, '').split(/[\s;,/|<>()]+/).map(s => s.replace(/^[.'"]+|[.'"]+$/g, '')).filter(s => s.includes('@')).map((s) => {
    const [user, domain = ''] = s.split('@')
    const fixedDomain = EMAIL_DOMAIN_FIXES[domain] ?? domain.replace(/\.(con|cmo|ocm|comm)$/, '.com').replace(/\.e$/, '.es')
    const value = `${user}@${fixedDomain}`
    return { value, fixed: fixedDomain !== domain && EMAIL_RE.test(value) }
  }).filter((e, i, list) => list.findIndex(x => x.value === e.value) === i)
}

/** Teléfonos españoles como «633 522 482»; los extranjeros, con su prefijo tal cual */
export function formatPhone(raw: string): string | null {
  const s = raw.replace(/^\s*(tel[eé]fono|tel[eé]f|tel|tlf|tfno|telf|m[oó]vil|movil|m[oó]v|fijo|fax|whatsapp)\.?\s*[:.]?\s*/i, '').trim()
  if (!s) return null
  let digits = s.replace(/\D/g, '')
  const intl = s.startsWith('+') || s.startsWith('00')
  if (s.startsWith('00')) digits = digits.slice(2)
  if ((intl || digits.length === 11) && /^34[6789]\d{8}$/.test(digits)) digits = digits.slice(2)
  else if (intl) return `+${digits}`
  if (/^[6789]\d{8}$/.test(digits)) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
  return s.replace(/[^\d+\s()-]/g, '').replace(/\s+/g, ' ').trim() || null
}

function splitPhones(raw: string) {
  const whole = formatPhone(raw)
  if (whole && /^(\d{3} \d{3} \d{3}|\+\d+)$/.test(whole)) return [whole]
  const parts = raw.split(/\s*[;,|/\n]\s*|\s+(?:y|o|ó|-)\s+/i).map(p => p.trim()).filter(Boolean)
  // Dos números pegados con un espacio: «954123456 633522482»
  const digits = raw.replace(/\D/g, '')
  if (parts.length === 1 && digits.length === 18 && /^[6789]\d{8}[6789]\d{8}$/.test(digits)) parts.splice(0, 1, digits.slice(0, 9), digits.slice(9))
  return [...new Set(parts.map(formatPhone).filter((p): p is string => !!p))]
}

function cleanWebsite(raw: string) {
  const v = raw.trim().replace(/\s+/g, '').replace(/\/+$/, '')
  if (!/^[\w-]+(\.[\w-]+)+/.test(v.replace(/^https?:\/\//i, ''))) return v
  const [, scheme = 'https://', rest = ''] = v.match(/^(https?:\/\/)?(.*)$/i) ?? []
  const [host = '', ...path] = rest.split('/')
  return `${scheme.toLowerCase()}${host.toLowerCase()}${path.length ? `/${path.join('/')}` : ''}`
}

// ─── IBAN ────────────────────────────────────────────────────────────────────

function mod97(s: string) {
  let rem = 0
  for (const ch of s) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55)
    for (const d of v) rem = (rem * 10 + Number(d)) % 97
  }
  return rem
}

/** IBAN con su longitud por país y sus dígitos de control */
export function validIban(raw: string) {
  const v = raw.toUpperCase().replace(/\s/g, '')
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v)) return false
  const len = IBAN_LENGTHS[v.slice(0, 2)]
  if (len && v.length !== len) return false
  return mod97(v.slice(4) + v.slice(0, 4)) === 1
}

/** Cuenta española de 20 dígitos (CCC) con sus dos dígitos de control correctos */
function validCcc(ccc: string) {
  const weights = [1, 2, 4, 8, 5, 10, 9, 7, 3, 6]
  const dc = (digits: string) => {
    const r = 11 - (digits.split('').reduce((s, d, i) => s + Number(d) * weights[i]!, 0) % 11)
    return r === 11 ? 0 : r === 10 ? 1 : r
  }
  return `${dc(`00${ccc.slice(0, 8)}`)}${dc(ccc.slice(10))}` === ccc.slice(8, 10)
}

function ibanFromCcc(ccc: string) {
  const check = String(98 - mod97(`${ccc}ES00`)).padStart(2, '0')
  return `ES${check}${ccc}`
}

// ─── Nombres, direcciones y provincias ───────────────────────────────────────

/** Espacios y comillas sobrantes; vacío → null */
function tidy(v: string | null) {
  if (v == null) return null
  const s = String(v).replace(/[ \t\r\n]+/g, ' ').replace(/\s+/g, ' ').replace(/^["'`´\s,;]+|["'`´\s,;]+$/g, '').trim()
  return s && !/^(-+|n\/?a|null|undefined|sin datos|0)$/i.test(s) ? s : null
}

/** Sin tildes, mayúsculas ni signos */
function plain(s: string | null | undefined) {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]+/g, '')
}

function isAllCaps(s: string) {
  return (s.match(/\p{L}/gu)?.length ?? 0) >= 3 && !/\p{Ll}/u.test(s)
}

/** «LOS PALACIOS Y VILLAFRANCA» → «Los Palacios y Villafranca»; las palabras con cifras («8A», «4º») no cambian */
export function titleCaseEs(s: string) {
  let first = true
  return s.split(/(\s+|(?<=[/(-]))/).map((token) => {
    if (!/\p{L}/u.test(token)) return token
    if (/\d/.test(token)) {
      first = false
      return token
    }
    const lower = token.toLocaleLowerCase('es')
    const bare = lower.replace(/[.,;:]+$/, '')
    let out: string
    if (!first && PARTICLES.has(bare)) out = lower
    else if (ROMAN.test(bare)) out = token.toUpperCase()
    else if (bare === 's/n') out = lower
    else out = lower.replace(/(^|['’])(\p{L})/gu, (_m, p: string, l: string) => p + l.toLocaleUpperCase('es'))
    first = false
    return out
  }).join('')
}

/** «S. L. U.», «SLU», «s.l.u» → «S.L.U.» (y lo mismo con S.L., S.A., S.A.U., C.B., S.C.…) */
export function normalizeLegalForm(name: string) {
  const hit = legalForm(name)
  return hit ? `${name.slice(0, hit.at)}${hit.form}` : name
}

/**
 * Forma jurídica al final del nombre. Sin puntos solo cuenta en mayúsculas («Pepe SL»), para no
 * confundir un apellido («María Sa») con una sociedad anónima.
 */
function legalForm(name: string) {
  for (const [re, form] of LEGAL_FORMS) {
    const m = name.match(re)
    if (!m) continue
    const suffix = m[0].slice(m[1]!.length)
    if (!suffix.includes('.') && suffix !== suffix.toUpperCase()) continue
    return { at: m.index! + m[1]!.length, form }
  }
  return null
}

function looksLikeCompany(name: string) {
  return !!legalForm(name) || COMPANY_WORDS.test(plainWords(name))
}

const plainWords = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]+/g, ' ').trim()

/** Tipo de vía estándar y mayúsculas normales */
function tidyAddress(address: string) {
  let a = isAllCaps(address) ? titleCaseEs(address) : address
  a = a.replace(/^(crtra|crta|ctra|carret)\.?\s*/i, 'Ctra. ').replace(/^(avda|avd)\.?\s*/i, 'Avda. ').replace(/^c\s*\/\s*/i, 'C/ ').replace(/^pza\.?\s*/i, 'Pza. ')
  return a.replace(/\s+/g, ' ').trim()
}

let provinceNames: string[] | null = null
function allProvinces() {
  provinceNames ??= Array.from({ length: 52 }, (_, i) => provinceFromPostalCode(`${String(i + 1).padStart(2, '0')}001`)).filter((p): p is string => !!p)
  return provinceNames
}

function provinceKey(s: string) {
  const p = plainWords(s).replace(/^(provincia de|prov\.?|comunidad de|comunitat|region de|principado de)\s+/, '')
  return PROVINCE_ALIASES[p] ?? p
}

function sameProvince(a: string, b: string) {
  const x = provinceKey(a)
  const y = provinceKey(b)
  return x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)))
}

/** Provincia española por su nombre (también con alias: «Vizcaya», «Baleares», «La Coruña»…) */
export function spanishProvince(s: string | null | undefined) {
  const key = s ? provinceKey(s) : ''
  return key ? allProvinces().find(p => provinceKey(p) === key) ?? null : null
}
const provinceByName = spanishProvince

/** Se respeta cómo la escribe el usuario («Alicante», «València») salvo que esté en mayúsculas */
function canonicalProvinceSpelling(given: string, canonical: string) {
  return isAllCaps(given) ? canonical : given
}

/** «España», «Spain», «ESP» → «ES» */
export function countryCode(raw: string | null | undefined): string | null {
  const v = plainWords(raw ?? '')
  if (!v) return null
  const named = COUNTRY_NAMES[v]
  if (named) return named
  const up = (raw ?? '').trim().toUpperCase()
  if (/^[A-Z]{2}$/.test(up)) return up === 'UK' ? 'GB' : up === 'EL' ? 'GR' : up
  return null
}

// ─── Constantes (al final: el autoimport de Nuxt no las necesita) ────────────

const TEXT_FIELDS = Object.freeze(['name', 'tradeName', 'contactPerson', 'nif', 'email', 'phone', 'website', 'address', 'postalCode', 'city', 'province', 'country', 'iban'] as const)

const LIMITS: ReadonlyArray<readonly [ContactDraftField, number]> = Object.freeze([
  ['name', 200], ['tradeName', 200], ['contactPerson', 120], ['nif', 20], ['email', 191], ['phone', 40], ['website', 200],
  ['address', 255], ['postalCode', 10], ['city', 120], ['province', 120], ['iban', 34], ['notes', 5000],
] as const)

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i

const EMAIL_DOMAIN_FIXES: Readonly<Record<string, string>> = Object.freeze({
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmail.co': 'gmail.com',
  'gmail.cm': 'gmail.com', 'gmail.om': 'gmail.com', 'gmaill.com': 'gmail.com', 'gmail.comm': 'gmail.com', 'gmali.com': 'gmail.com',
  'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotamil.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'homail.com': 'hotmail.com',
  'hotmial.es': 'hotmail.es', 'hotmal.es': 'hotmail.es', 'hotmai.es': 'hotmail.es', 'hotamil.es': 'hotmail.es',
  'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahooo.es': 'yahoo.es', 'yaho.es': 'yahoo.es',
  'outlok.com': 'outlook.com', 'outllok.com': 'outlook.com', 'otlook.com': 'outlook.com', 'outlook.co': 'outlook.com', 'outlok.es': 'outlook.es',
  'iclud.com': 'icloud.com', 'icoud.com': 'icloud.com', 'telefonica.ne': 'telefonica.net',
})

const IBAN_LENGTHS: Readonly<Record<string, number>> = Object.freeze({
  ES: 24, PT: 25, FR: 27, DE: 22, IT: 27, GB: 22, IE: 22, NL: 18, BE: 16, LU: 20, AT: 20, CH: 21, AD: 24, PL: 28, SE: 24, DK: 18,
  FI: 18, NO: 15, GR: 27, CZ: 24, SK: 24, HU: 28, RO: 24, BG: 22, HR: 21, SI: 19, EE: 20, LV: 21, LT: 20, MT: 31, CY: 28, MC: 27, GI: 23,
})

const PARTICLES = new Set(Object.freeze(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'i', 'en', 'a', 'al', 'con', 'por', 'para', 'o', 'u', 'dels', 'les', 'sobre']))

const ROMAN = /^(i{2,3}|iv|vi{1,3}|ix|xi{0,3}|xiv|xv|xvi{1,3}|xix|xx)$/

/** Formas jurídicas al final del nombre (la primera que encaja gana: las largas van antes) */
const LEGAL_FORMS: ReadonlyArray<readonly [RegExp, string]> = Object.freeze([
  [/(^|[\s,])S\.?\s?L\.?\s?N\.?\s?E\.?$/i, 'S.L.N.E.'],
  [/(^|[\s,])S\.?\s?L\.?\s?U\.?$/i, 'S.L.U.'],
  [/(^|[\s,])S\.?\s?A\.?\s?U\.?$/i, 'S.A.U.'],
  [/(^|[\s,])S\.?\s?L\.?\s?L\.?$/i, 'S.L.L.'],
  [/(^|[\s,])S\.?\s?L\.?\s?P\.?$/i, 'S.L.P.'],
  [/(^|[\s,])S\.?\s?C\.?\s?P\.?$/i, 'S.C.P.'],
  [/(^|[\s,])S\.?\s?A\.?\s?T\.?$/i, 'S.A.T.'],
  [/(^|[\s,])S\.?\s?COOP\.?(\s?AND(?:ALUZA)?\.?)?$/i, 'S. Coop.'],
  [/(^|[\s,])S\.?\s?L\.?$/i, 'S.L.'],
  [/(^|[\s,])S\.?\s?A\.?$/i, 'S.A.'],
  [/(^|[\s,])S\.?\s?C\.?$/i, 'S.C.'],
  [/(^|[\s,])C\.?\s?B\.?$/i, 'C.B.'],
  [/(^|[\s,])SOCIEDAD LIMITADA UNIPERSONAL$/i, 'S.L.U.'],
  [/(^|[\s,])SOCIEDAD LIMITADA$/i, 'S.L.'],
  [/(^|[\s,])SOCIEDAD AN[OÓ]NIMA$/i, 'S.A.'],
] as const)

const COMPANY_WORDS = /\b(ayuntamiento|ajuntament|diputacion|consejeria|junta de|gobierno|ministerio|universidad|colegio|ceip|ies|instituto|escuela|academia|asociacion|associacio|fundacion|federacion|club|comunidad|cofradia|hermandad|parroquia|obispado|hospital|clinica|consulta|farmacia|laboratorio|centro|grupo|holding|talleres|taller|construcciones|inmobiliaria|promociones|servicios|soluciones|consulting|consultores|asesores|asesoria|gestoria|abogados|estudio|agencia|distribuciones|comercial|transportes|hermanos|hnos|restaurante|bar|hotel|cafeteria|tienda|supermercado|bodegas|industrias|ingenieria|arquitectura|tecnologias|technologies|systems|sistemas|software|digital|media|comunicacion|marketing|eventos|producciones|ute|sat|ltd|limited|gmbh|inc|llc|sarl|srl|bv|spa)\b/

const PROVINCE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'vizcaya': 'bizkaia', 'biscay': 'bizkaia', 'guipuzcoa': 'gipuzkoa', 'baleares': 'illes balears', 'islas baleares': 'illes balears', 'balears': 'illes balears',
  'mallorca': 'illes balears', 'la coruna': 'a coruna', 'coruna': 'a coruna', 'gerona': 'girona', 'lerida': 'lleida', 'orense': 'ourense',
  'alava': 'araba alava', 'araba': 'araba alava', 'tenerife': 'santa cruz de tenerife', 'sc tenerife': 'santa cruz de tenerife', 's c tenerife': 'santa cruz de tenerife',
  'gran canaria': 'las palmas', 'palmas': 'las palmas', 'alacant': 'alicante', 'alacant alicante': 'alicante', 'comunidad foral de navarra': 'navarra', 'castello': 'castellon', 'castellon de la plana': 'castellon', 'valencia': 'valencia', 'nafarroa': 'navarra',
  'rioja': 'la rioja', 'asturies': 'asturias', 'madrid comunidad de': 'madrid',
})

const COUNTRY_NAMES: Readonly<Record<string, string>> = Object.freeze({
  'espana': 'ES', 'spain': 'ES', 'esp': 'ES', 'espanya': 'ES', 'espagne': 'ES', 'reino de espana': 'ES',
  'portugal': 'PT', 'prt': 'PT', 'francia': 'FR', 'france': 'FR', 'fra': 'FR', 'alemania': 'DE', 'germany': 'DE', 'deutschland': 'DE', 'deu': 'DE',
  'italia': 'IT', 'italy': 'IT', 'ita': 'IT', 'reino unido': 'GB', 'united kingdom': 'GB', 'gran bretana': 'GB', 'inglaterra': 'GB', 'uk': 'GB', 'gbr': 'GB',
  'irlanda': 'IE', 'ireland': 'IE', 'paises bajos': 'NL', 'holanda': 'NL', 'netherlands': 'NL', 'belgica': 'BE', 'belgium': 'BE', 'luxemburgo': 'LU', 'luxembourg': 'LU',
  'suiza': 'CH', 'switzerland': 'CH', 'austria': 'AT', 'polonia': 'PL', 'poland': 'PL', 'suecia': 'SE', 'sweden': 'SE', 'dinamarca': 'DK', 'denmark': 'DK',
  'noruega': 'NO', 'norway': 'NO', 'finlandia': 'FI', 'finland': 'FI', 'grecia': 'GR', 'greece': 'GR', 'andorra': 'AD', 'monaco': 'MC', 'gibraltar': 'GI',
  'rumania': 'RO', 'rumanía': 'RO', 'romania': 'RO', 'bulgaria': 'BG', 'republica checa': 'CZ', 'chequia': 'CZ', 'czech republic': 'CZ', 'hungria': 'HU', 'hungary': 'HU',
  'croacia': 'HR', 'croatia': 'HR', 'eslovenia': 'SI', 'eslovaquia': 'SK', 'estonia': 'EE', 'letonia': 'LV', 'lituania': 'LT', 'malta': 'MT', 'chipre': 'CY', 'cyprus': 'CY',
  'estados unidos': 'US', 'eeuu': 'US', 'ee uu': 'US', 'usa': 'US', 'united states': 'US', 'canada': 'CA', 'mexico': 'MX', 'argentina': 'AR', 'colombia': 'CO',
  'chile': 'CL', 'peru': 'PE', 'venezuela': 'VE', 'uruguay': 'UY', 'paraguay': 'PY', 'ecuador': 'EC', 'bolivia': 'BO', 'brasil': 'BR', 'brazil': 'BR',
  'cuba': 'CU', 'republica dominicana': 'DO', 'marruecos': 'MA', 'morocco': 'MA', 'argelia': 'DZ', 'china': 'CN', 'japon': 'JP', 'japan': 'JP', 'india': 'IN',
  'australia': 'AU', 'israel': 'IL', 'turquia': 'TR', 'turkey': 'TR', 'rusia': 'RU', 'ucrania': 'UA', 'emiratos arabes unidos': 'AE',
})
