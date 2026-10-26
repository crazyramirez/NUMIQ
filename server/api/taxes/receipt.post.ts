import { createHash } from 'node:crypto'

interface Receipt {
  model: string | null
  year: number | null
  period: string | null
  nif: string | null
  csv: string | null
  nrc: string | null
  amount: number | null
  outcome: 'ingresar' | 'devolver' | 'compensar' | 'cero' | null
  presentedAt: string | null
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['model', 'year', 'period', 'nif', 'csv', 'nrc', 'amount', 'outcome', 'presentedAt'],
  properties: {
    model: { type: ['string', 'null'] },
    year: { type: ['integer', 'null'] },
    period: { type: ['string', 'null'] },
    nif: { type: ['string', 'null'] },
    csv: { type: ['string', 'null'] },
    nrc: { type: ['string', 'null'] },
    amount: { type: ['number', 'null'] },
    outcome: { type: ['string', 'null'], enum: ['ingresar', 'devolver', 'compensar', 'cero', null] },
    presentedAt: { type: ['string', 'null'] },
  },
}

const SYSTEM = `Lees justificantes de presentación de la Agencia Tributaria española (autoliquidaciones como los modelos 303, 130, 111, 115, 390…).
Devuelve solo lo que figure en el documento, o null:
- model: número del modelo (p. ej. "303"). year: ejercicio. period: periodo tal como figura normalizado a 1T, 2T, 3T, 4T, 0A (anual) o 01..12 (mensual).
- nif: NIF del declarante sin espacios. csv: Código Seguro de Verificación. nrc: NRC del ingreso si lo hay.
- amount: importe del resultado (positivo). outcome: ingresar, devolver, compensar o cero.
- presentedAt: fecha de presentación AAAA-MM-DD.`

/** Lee con IA el justificante de presentación (PDF o foto) y lo guarda en el archivo del trimestre */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompanyOrAdvisor(event, 'taxes')
  await requireAi('Sin clave de OpenAI no se puede leer el justificante: introduce sus datos a mano o añade tu clave en Ajustes → Inteligencia artificial')
  const parts = (await readMultipartFormData(event)) ?? []
  const file = parts.find(p => p.name === 'file' && p.data?.length)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'Elige el justificante (PDF o foto)' })
  const name = safeFilename(file.filename ?? 'justificante.pdf')
  const kind = importKind(file.data, name)
  if (!kind || (kind.family !== 'pdf' && kind.family !== 'image')) throw createError({ statusCode: 415, statusMessage: 'Sube el justificante en PDF o como foto' })
  if (file.data.length > MAX_VAULT_BYTES) throw createError({ statusCode: 413, statusMessage: 'El archivo supera 25 MB' })

  let data: Receipt
  try {
    data = (await aiJson<Receipt>({ name: 'justificante', schema: SCHEMA, system: SYSTEM, parts: aiPartsFor(kind, file.data, name), effort: 'low' })).data
  }
  catch (err) {
    throw createError({ statusCode: err instanceof AiError ? err.status : 502, statusMessage: err instanceof AiError ? err.message : 'No se pudo leer el justificante' })
  }
  const q = data.period?.match(/^([1-4])T$/)
  const year = data.year ?? new Date().getFullYear()
  const quarter = q ? Number(q[1]) : quarterOf(data.presentedAt && /^\d{4}-\d{2}-\d{2}$/.test(data.presentedAt) ? data.presentedAt : new Date())
  const path = await saveCompanyFile(company.id, `vault/${year}-${quarter}`, file.data, kind.ext)
  const [res] = await useDb().insert(tables.files).values({
    companyId: company.id,
    kind: 'vault',
    originalName: name,
    mime: kind.mime,
    size: file.data.length,
    path,
    sha256: createHash('sha256').update(file.data).digest('hex'),
    year,
    quarter,
    folder: 'impuestos',
    notes: [data.model ? `Justificante modelo ${data.model}` : 'Justificante AEAT', data.period, data.csv ? `CSV ${data.csv}` : null].filter(Boolean).join(' · ').slice(0, 255),
    uploadedBy: user.id,
  }).$returningId()
  return { fileId: res!.id, ...data, nifMatches: data.nif ? normalizeNif(data.nif) === normalizeNif(company.nif) : null }
})
