interface ContactReading {
  kind: 'company' | 'person'
  name: string | null
  tradeName: string | null
  nif: string | null
  email: string | null
  phone: string | null
  website: string | null
  address: string | null
  postalCode: string | null
  city: string | null
  province: string | null
  country: string | null
  iban: string | null
}

const str = { type: ['string', 'null'] }
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'name', 'tradeName', 'nif', 'email', 'phone', 'website', 'address', 'postalCode', 'city', 'province', 'country', 'iban'],
  properties: {
    kind: { type: 'string', enum: ['company', 'person'] },
    name: str, tradeName: str, nif: str, email: str, phone: str, website: str,
    address: str, postalCode: str, city: str, province: str, country: str, iban: str,
  },
}

const SYSTEM = `Extraes los datos de un cliente o proveedor español de un texto, una foto o un PDF (firma de correo, tarjeta de visita, cabecera de factura, pie de una web, escritura…).
Devuelve solo lo que aparezca; si no aparece, null. No inventes.
- name: razón social completa (con su forma jurídica: S.L., S.A.…) o nombre y apellidos. tradeName: nombre comercial si es distinto.
- kind: person si es una persona física (nombre y apellidos, DNI/NIE), company si es una empresa.
- nif: en mayúsculas sin espacios ni guiones. country: código ISO de 2 letras (España = ES). iban sin espacios.
- province: la provincia española que corresponda a la población o al código postal si se puede deducir con seguridad.`

/** Alta rápida de contactos: lee sus datos de un texto pegado, una foto o un PDF */
export default defineEventHandler(async (event) => {
  await requireCompany(event)
  await requireAi()
  const parts: AiPart[] = []
  const ct = getRequestHeader(event, 'content-type') ?? ''
  if (ct.includes('multipart/form-data')) {
    const file = ((await readMultipartFormData(event)) ?? []).find(p => p.name === 'file' && p.data?.length)
    if (!file) throw createError({ statusCode: 400, statusMessage: 'Elige una foto o un documento' })
    if (file.data.length > 20 * 1024 * 1024) throw createError({ statusCode: 413, statusMessage: 'El archivo supera 20 MB' })
    const kind = importKind(file.data, file.filename ?? 'documento')
    if (!kind || kind.family === 'zip' || kind.family === 'sheet') throw createError({ statusCode: 415, statusMessage: 'Sube una foto, un PDF o un Word' })
    parts.push(...aiPartsFor(kind, file.data, file.filename ?? 'documento'))
  }
  else {
    const body = await readBody<{ text?: string }>(event).catch(() => ({ text: '' }))
    const text = String(body?.text ?? '').trim()
    if (text.length < 3) throw createError({ statusCode: 400, statusMessage: 'Pega algún dato del contacto' })
    parts.push({ type: 'input_text', text: text.slice(0, 20_000) })
  }
  try {
    const { data } = await aiJson<ContactReading>({ name: 'contacto', schema: SCHEMA, system: SYSTEM, parts, effort: 'low' })
    const nif = data.nif ? normalizeNif(data.nif) : null
    const contact = {
      ...data,
      nif,
      nifType: nif && !validateNif(nif).valid && looksLikeEuVat(nif) ? 'vat_eu' : 'nif',
      country: data.country && /^[A-Za-z]{2}$/.test(data.country) ? data.country.toUpperCase() : 'ES',
      iban: data.iban?.replace(/\s/g, '').toUpperCase() || null,
      email: data.email?.trim().toLowerCase() || null,
    }
    // Sin código postal en el documento: se busca por la dirección
    await completePostalCode(contact)
    return contact
  }
  catch (err) {
    throw createError({ statusCode: err instanceof AiError ? err.status : 502, statusMessage: err instanceof AiError ? err.message : 'No se pudieron leer los datos' })
  }
})
