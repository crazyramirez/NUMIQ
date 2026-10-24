/** Los campos de dirección de un contacto leído (de una factura o del alta rápida) */
interface Address {
  address: string | null
  postalCode: string | null
  city: string | null
  province: string | null
  country?: string | null
}

/**
 * Código postal a partir de la dirección, para los contactos leídos de un documento que no lo traen.
 * Se consulta CartoCiudad (geocodificador oficial del IGN, gratuito y sin clave), que tolera las erratas
 * del OCR pero a veces devuelve otra calle u otro municipio parecidos: solo se acepta si la calle y la
 * población coinciden con las leídas y el código postal es único.
 */

export interface PostalLookup {
  postalCode: string
  city: string | null
  province: string | null
}

/** Rellena el código postal (y la provincia si falta) de un contacto español leído sin él */
export async function completePostalCode(p: Address | null | undefined) {
  if (!p || p.postalCode || (p.country && p.country !== 'ES')) return false
  if (takeInlinePostalCode(p)) {
    p.province ||= provinceFromPostalCode(p.postalCode)
    return true
  }
  if (!p.address || !p.city) return false
  const found = await findPostalCode({ address: p.address, city: p.city, province: p.province })
  if (!found) return false
  p.postalCode = found.postalCode
  p.province ||= found.province
  return true
}

/** Completa los contactos de varios registros a la vez (los repetidos se consultan una sola vez) */
export async function completePostalCodes(parties: Array<Address | null | undefined>, limit = 60) {
  const pending = parties.filter((p): p is Address =>!!p && !p.postalCode && !!(p.address || p.city)).slice(0, limit)
  await runLimited(pending.map(p => () => completePostalCode(p)), 4)
}

/**
 * El código postal leído dentro de la dirección ("C/ Mayor 3, 28013 Madrid") o de la población
 * ("29602 Marbella"): se pasa a su campo y se quita de donde estaba.
 */
function takeInlinePostalCode(p: Address) {
  const cityMatch = p.city?.match(INLINE_CP)
  if (cityMatch) {
    p.postalCode = cityMatch[1]!
    p.city = p.city!.replace(INLINE_CP, ' ').replace(/^[\s,()-]+|[\s,()-]+$/g, '').replace(/\s+/g, ' ') || null
    return true
  }
  const m = p.address?.match(INLINE_CP)
  if (!m) return false
  p.postalCode = m[1]!
  // Solo se recorta si detrás del código postal va la población (o nada)
  const tail = p.address!.slice(m.index! + m[0].length).replace(/^[\s,]+|[\s,.]+$/g, '')
  if (!tail || (p.city && plain(tail).startsWith(plain(p.city)))) p.address = p.address!.slice(0, m.index).replace(/[\s,-]+$/, '') || null
  else if (!p.city && /^\p{L}[\p{L}\s'-]*$/u.test(tail)) {
    p.city = tail
    p.address = p.address!.slice(0, m.index).replace(/[\s,-]+$/, '') || null
  }
  return true
}

/**
 * Busca por calle y población (sin población no: la misma calle existe en muchos municipios de una
 * provincia, y añadir la provincia a la consulta hace que CartoCiudad no encuentre nada).
 */
export async function findPostalCode(input: { address: string, city: string, province: string | null }): Promise<PostalLookup | null> {
  const street = parseStreet(input.address)
  const city = input.city.trim()
  if (!street || !city) return null
  const key = `${street.query}|${street.number ?? ''}|${plain(city)}|${plain(input.province)}`
  const cached = cache.get(key)
  if (cached) return cached
  const lookup = (async () => {
    // Con el número se obtiene el del portal; sin él, solo vale si toda la calle tiene el mismo
    const attempts = street.number ? [`${street.query} ${street.number}, ${city}`, `${street.query}, ${city}`] : [`${street.query}, ${city}`]
    for (const q of attempts) {
      const r = await geocode(q)
      const found = r && acceptable(r, street.name, input)
      if (found) return found
    }
    return null
  })()
  cache.set(key, lookup)
  if (cache.size > 500) cache.delete(cache.keys().next().value!)
  // Un fallo de red no se recuerda: se vuelve a intentar en la siguiente lectura
  lookup.catch(() => cache.delete(key))
  return lookup.catch(() => null)
}

/** Calle leída → tipo de vía, nombre y número (sin piso, local ni puerta) */
export function parseStreet(address: string) {
  let s = address.toLowerCase().replace(/\s+/g, ' ').trim()
  let type: string | null = null
  for (const [re, full] of STREET_TYPES) {
    const m = s.match(re)
    if (m) {
      type = full
      s = s.slice(m[0].length).trim()
      break
    }
  }
  // "nº 6", "n.º6", "núm. 6" → "6"; "s/n" no tiene número
  s = s.replace(/\bs\/n\b/g, ' ').replace(/(?:\bn[.\s]*[º°o]\.?|\bnú?m\.?|\bn[úu]mero|\bnro\.?)\s*(?=\d)/g, ' ')
  // Lo que va tras "local", "piso", "nave"… o tras un código postal escrito en la dirección no es la calle
  s = s.replace(EXTRAS, '').replace(/[\s,]+\d{5}\b.*$/, '').replace(/\s+/g, ' ').trim()
  const m = s.match(/^(.*?\p{L}.*?)[\s,]+(\d{1,4})(?!\d)/u)
  const name = (m ? m[1]! : s).replace(/[\s,.;-]+$/, '').trim()
  if (plain(name).length < 3) return null
  return { type, name, number: m ? Number(m[2]) : null, query: [type, name].filter(Boolean).join(' ') }
}

interface CartoResult {
  type?: string
  address?: string
  postalCode?: string
  muni?: string
  poblacion?: string
  province?: string
}

async function geocode(q: string): Promise<CartoResult | null> {
  const res = await fetch(`${ENDPOINT}?q=${encodeURIComponent(q)}`, {
    headers: { 'accept': 'application/json', 'user-agent': 'NUMIQ' },
    signal: AbortSignal.timeout(6000),
  })
  if (!res.ok) throw new Error(`CartoCiudad ${res.status}`)
  const text = await res.text()
  if (!text.trim().startsWith('{')) return null
  return JSON.parse(text) as CartoResult
}

/** La respuesta vale si es una calle con un único código postal, de la misma población (y provincia) y con el mismo nombre */
function acceptable(r: CartoResult, streetName: string, input: { city: string, province: string | null }): PostalLookup | null {
  const cp = (r.postalCode ?? '').trim()
  if (!/^\d{5}$/.test(cp) || (r.type !== 'portal' && r.type !== 'callejero')) return null
  if (![r.muni, r.poblacion].some(x => sameName(x, input.city))) return null
  if (input.province && !sameName(provinceName(r.province), provinceName(input.province))) return null
  if (!sameStreet(r.address ?? '', streetName)) return null
  return { postalCode: cp, city: r.poblacion || r.muni || null, province: r.province?.split('/').pop()?.trim() || null }
}

/** Provincias que se escriben de dos formas: "Vizcaya" = "Bizkaia", "Baleares" = "Illes Balears" */
function provinceName(s: string | null | undefined) {
  const p = plain(s)
  return PROVINCE_ALIASES[p] ?? p
}

/** "Marbella" = "MARBELLA"; "Alicante" está en "Alacant/Alicante"; "Palma de Mallorca" contiene "Palma" */
function sameName(a: string | null | undefined, b: string | null | undefined) {
  const x = plain(a)
  const y = plain(b)
  return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x))))
}

/** Mismo nombre de calle aunque el OCR tenga erratas ("Caledron") o falte parte ("Larios" = "Marqués de Larios") */
function sameStreet(found: string, read: string) {
  const a = words(found)
  const b = words(read)
  if (!a.length || !b.length) return false
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (short.every(w => long.includes(w))) return true
  return dice(a.join(''), b.join('')) >= 0.7
}

const words = (s: string) => plain(s).split(' ').filter(w => w && !STOPWORDS.has(w))

/** Sin tildes, mayúsculas ni signos */
function plain(s: string | null | undefined) {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Parecido entre dos textos (coeficiente de Dice sobre pares de letras) */
function dice(a: string, b: string) {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const pairs = new Map<string, number>()
  for (let i = 0; i < a.length - 1; i++) pairs.set(a.slice(i, i + 2), (pairs.get(a.slice(i, i + 2)) ?? 0) + 1)
  let common = 0
  for (let i = 0; i < b.length - 1; i++) {
    const p = b.slice(i, i + 2)
    const n = pairs.get(p) ?? 0
    if (n) {
      common++
      pairs.set(p, n - 1)
    }
  }
  return (2 * common) / (a.length + b.length - 2)
}

const ENDPOINT = 'https://www.cartociudad.es/geocoder/api/geocoder/find'

const cache = new Map<string, Promise<PostalLookup | null>>()

/** Código postal español suelto (01000–52999) */
const INLINE_CP = /(?:^|[\s,(])((?:0[1-9]|[1-4]\d|5[0-2])\d{3})(?=[\s,)]|$)/

const PROVINCE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'vizcaya': 'bizkaia', 'guipuzcoa': 'gipuzkoa', 'baleares': 'balears', 'islas baleares': 'balears', 'orense': 'ourense',
  'gerona': 'girona', 'lerida': 'lleida', 'castellon de la plana': 'castellon', 'la coruna': 'coruna', 'a coruna': 'coruna',
})

const STOPWORDS = new Set(Object.freeze(['de', 'del', 'la', 'las', 'el', 'los', 'l', 'd', 'y', 'i', 'dels', 'les', 'calle', 'carrer', 'avenida', 'plaza', 'paseo']))

/** Abreviaturas de tipo de vía al principio de la dirección */
const STREET_TYPES: ReadonlyArray<readonly [RegExp, string]> = Object.freeze([
  [/^(?:c\s*\/\s*|c\.\s*|cl\.?\s+|cll\.?\s+|calle\s+)/, 'calle'],
  [/^carrer\s+/, 'carrer'],
  [/^(?:avda\.?\s*|avd\.?\s*|av\.\s*|av\s+|avenida\s+|avinguda\s+)/, 'avenida'],
  [/^(?:pza\.?\s*|plza\.?\s*|pl\.\s*|plaza\s+|plaça\s+)/, 'plaza'],
  [/^(?:p\.?\s*º\s*|pso\.?\s*|paseo\s+|passeig\s+)/, 'paseo'],
  [/^(?:ctra\.?\s*|crta\.?\s*|carretera\s+)/, 'carretera'],
  [/^(?:cno\.?\s+|cmno\.?\s*|camino\s+)/, 'camino'],
  [/^(?:rda\.?\s*|ronda\s+)/, 'ronda'],
  [/^(?:trav\.?\s*|travesía\s+|travesia\s+)/, 'travesía'],
  [/^(?:gta\.?\s*|glorieta\s+)/, 'glorieta'],
  [/^(?:urb\.?\s*|urbanización\s+|urbanizacion\s+)/, 'urbanización'],
  [/^(?:pol\.?\s*ind\.?\s*|p\.\s*i\.\s*|polígono(?: industrial)?\s+|poligono(?: industrial)?\s+)/, 'polígono'],
  [/^(?:pje\.?\s*|pasaje\s+)/, 'pasaje'],
] as const)

const EXTRAS = /[\s,]+(?:(?:local|loc|nave|bajo|bj|piso|planta|puerta|pta|esc|escalera|bloque|blq|oficina|of|despacho|edificio|edif|apartado|apdo)\b|\d{1,3}\s*[º°ª]).*$/
