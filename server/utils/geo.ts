import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'

/**
 * Ubicación de un contacto para el mapa de su ficha. En España, CartoCiudad (IGN, gratuito y sin clave)
 * sitúa el portal exacto; si no lo encuentra o la dirección es extranjera, OpenStreetMap (Nominatim).
 * Se guarda en el contacto con la huella de la dirección: solo se vuelve a consultar si la dirección cambia.
 */

export type GeoPrecision = 'exact' | 'street' | 'area'

export interface ContactLocation {
  lat: number
  lng: number
  precision: GeoPrecision
}

interface GeoAddress {
  address: string | null
  postalCode: string | null
  city: string | null
  province: string | null
  country: string
}

type GeoContact = GeoAddress & {
  id: number
  geoLat: number | null
  geoLng: number | null
  geoPrecision: GeoPrecision | 'none' | null
  geoKey: string | null
}

/** Ubicación guardada o, si la dirección ha cambiado desde la última consulta, recién calculada */
export async function contactLocation(contact: GeoContact): Promise<ContactLocation | null> {
  if (!contact.address && !contact.postalCode && !contact.city) return null
  const key = addressKey(contact)
  if (contact.geoKey === key) {
    return contact.geoPrecision && contact.geoPrecision !== 'none' && contact.geoLat != null && contact.geoLng != null
      ? { lat: contact.geoLat, lng: contact.geoLng, precision: contact.geoPrecision }
      : null
  }

  // Dos aperturas seguidas de la misma ficha comparten la consulta
  const flightKey = `${contact.id}|${key}`
  let lookup = inFlight.get(flightKey)
  if (!lookup) {
    lookup = locate(contact).finally(() => inFlight.delete(flightKey))
    inFlight.set(flightKey, lookup)
  }
  // Un fallo de red se propaga sin guardar nada: se reintenta en la próxima apertura
  const found = await lookup
  await useDb().update(tables.contacts).set({
    geoLat: found?.lat ?? null,
    geoLng: found?.lng ?? null,
    geoPrecision: found?.precision ?? 'none',
    geoKey: key,
  }).where(eq(tables.contacts.id, contact.id))
  return found
}

const inFlight = new Map<string, Promise<ContactLocation | null>>()

function addressKey(a: GeoAddress) {
  const norm = [a.address, a.postalCode, a.city, a.province, a.country].map(x => (x ?? '').trim().toLowerCase().replace(/\s+/g, ' '))
  return createHash('sha1').update(norm.join('|')).digest('hex')
}

async function locate(a: GeoAddress): Promise<ContactLocation | null> {
  const country = (a.country || 'ES').toUpperCase()
  const city = a.city?.trim() || null
  const street = a.address ? parseStreet(a.address) : null

  if (country === 'ES' && street && city) {
    const attempts = street.number ? [`${street.query} ${street.number}, ${city}`, `${street.query}, ${city}`] : [`${street.query}, ${city}`]
    for (const q of attempts) {
      const r = await cartoFind(q)
      if (r && (r.type === 'portal' || r.type === 'callejero') && [r.muni, r.poblacion].some(x => sameName(x, city)) && validPoint(r.lat, r.lng)) {
        return { lat: r.lat!, lng: r.lng!, precision: r.type === 'portal' && r.portalNumber != null ? 'exact' : 'street' }
      }
    }
  }

  // OpenStreetMap: la calle con la población (con y sin código postal, que a veces confunde: Eircode, PBK…)
  const countrycodes = country.toLowerCase()
  const postal = a.postalCode?.trim() || null
  const line = streetLine(a.address, [city, postal, a.province])
  if (line) {
    const hasNumber = /\d/.test(line)
    for (const q of [...new Set([[line, [postal, city].filter(Boolean).join(' ')], [line, city]].map(p => p.filter(Boolean).join(', ')))]) {
      const found = await nominatim({ countrycodes, q })
      // Sin número de portal, el punto es la calle aunque OpenStreetMap devuelva un edificio de ella
      if (found) return found.precision === 'exact' && !hasNumber ? { ...found, precision: 'street' } : found
    }
  }
  // Sin calle, el punto solo indica la zona
  const area = (postal && city ? await nominatim({ countrycodes, postalcode: postal, city }) : null)
    ?? (city || a.province ? await nominatim({ countrycodes, q: city ?? a.province! }) : null)
    ?? (postal ? await nominatim({ countrycodes, postalcode: postal }) : null)
  return area && { ...area, precision: 'area' }
}

/** La parte de la dirección que nombra la calle: sin planta, puerta, bloque ni la población repetida */
function streetLine(address: string | null, known: Array<string | null>) {
  if (!address) return null
  const street = parseStreet(address)
  // En España el analizador de calles ya separa tipo de vía, nombre y número
  if (street && !/[,·;]/.test(address)) return [street.query, street.number].filter(Boolean).join(' ')
  const parts = address.split(/[,·;]/).map(s => s.trim()).filter(s =>
    /\p{L}{3}/u.test(s) && !UNIT.test(s) && !known.some(k => k && (sameName(s, k) || s.toLowerCase() === k.toLowerCase())))
  return parts[0] ?? null
}

const UNIT = /^(?:\d+\s*(?:st|nd|rd|th|º|ª)\b|(?:floor|fl|suite|ste|unit|apt|apartment|room|blk|block|building|bldg|house|tower|piso|planta|local|nave|bajo|puerta|pta|escalera|esc|oficina|despacho|edificio|portal)\b)/i

interface CartoResult {
  type?: string
  muni?: string
  poblacion?: string
  portalNumber?: number | null
  lat?: number
  lng?: number
}

async function cartoFind(q: string): Promise<CartoResult | null> {
  const res = await fetch(`https://www.cartociudad.es/geocoder/api/geocoder/find?q=${encodeURIComponent(q)}`, {
    headers: { 'accept': 'application/json', 'user-agent': 'NUMIQ' },
    signal: AbortSignal.timeout(6000),
  })
  if (!res.ok) throw new Error(`CartoCiudad ${res.status}`)
  const text = await res.text()
  return text.trim().startsWith('{') ? JSON.parse(text) as CartoResult : null
}

/** Nominatim admite como mucho una consulta por segundo: van en fila */
let nominatimQueue: Promise<unknown> = Promise.resolve()

async function nominatim(params: Record<string, string | undefined>): Promise<ContactLocation | null> {
  const query = new URLSearchParams({ format: 'jsonv2', limit: '1', addressdetails: '0' })
  for (const [k, v] of Object.entries(params)) if (v) query.set(k, v)
  const run = nominatimQueue.then(async () => {
    const site = useRuntimeConfig().siteUrl
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${query}`, {
      headers: { 'accept': 'application/json', 'accept-language': 'es', 'user-agent': `NUMIQ/1.0${site ? ` (${site})` : ''}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`Nominatim ${res.status}`)
    return await res.json() as Array<{ lat: string, lon: string, place_rank: number }>
  })
  nominatimQueue = run.catch(() => null).then(() => new Promise(r => setTimeout(r, 1100)))
  const [hit] = await run
  if (!hit) return null
  const lat = Number(hit.lat)
  const lng = Number(hit.lon)
  if (!validPoint(lat, lng)) return null
  return { lat, lng, precision: hit.place_rank >= 30 ? 'exact' : hit.place_rank >= 26 ? 'street' : 'area' }
}

const validPoint = (lat: unknown, lng: unknown) =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
