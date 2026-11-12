import { z } from 'zod'

/**
 * Asistente de redacción: mejora, corrige, acorta, amplía o redacta el texto de un campo (descripción,
 * concepto, observaciones, notas…) con el contexto del documento. Devuelve solo el texto nuevo; el
 * campo lo aplica el navegador (y se puede deshacer). Nunca guarda nada.
 */

/** Qué es cada campo y cómo debe quedar */
const FIELDS = {
  sales_description: { what: 'la descripción del trabajo de una factura o presupuesto, antes de las líneas de conceptos', format: 'rich' },
  sales_concept: { what: 'el concepto de una línea de factura o presupuesto', format: 'concept' },
  sales_notes: { what: 'las observaciones al pie de una factura, que lee el cliente (breves: agradecimiento, aclaraciones útiles). La fecha, el vencimiento, la forma de pago, el IBAN y el total ya figuran en otra parte de la factura: no los menciones salvo que se pida', format: 'plain' },
  sales_terms: { what: 'las condiciones al pie de un presupuesto, que lee el cliente (validez, plazos, pagos, revisiones…). La fecha de validez y el total ya figuran en otra parte del presupuesto: no los menciones salvo que se pida', format: 'plain' },
  expense_concept: { what: 'el concepto de un gasto (factura recibida, ticket o nómina) en la contabilidad', format: 'line' },
  expense_notes: { what: 'las notas internas de un gasto: para qué fue, proyecto, justificación', format: 'plain' },
  recurring_concept: { what: 'el concepto de una factura o gasto que se repite cada periodo', format: 'line' },
  recurring_notes: { what: 'las notas que se imprimen en cada factura recurrente', format: 'plain' },
  item_description: { what: 'la descripción de un producto o servicio del catálogo, que sale bajo el concepto en la factura', format: 'plain' },
  contact_notes: { what: 'las notas internas de la ficha de un cliente o proveedor', format: 'plain' },
  default_notes: { what: 'las observaciones con las que empiezan todas las facturas nuevas', format: 'plain' },
  default_terms: { what: 'las condiciones con las que empiezan todos los presupuestos nuevos', format: 'plain' },
  payment_text: { what: 'el texto de pago al pie de las facturas (cómo pagar)', format: 'plain' },
  email_message: { what: 'el mensaje del correo con el que se envía una factura o presupuesto al cliente', format: 'plain' },
} as const

const ACTIONS = {
  write: 'Redacta el texto desde cero a partir del contexto. Si el campo ya tiene algo, úsalo como punto de partida.',
  improve: 'Mejora la redacción: más claro, profesional y fluido, sin cambiar el sentido ni quitar datos.',
  fix: 'Corrige solo ortografía, acentos, puntuación, mayúsculas y gramática. No cambies el estilo ni las palabras correctas.',
  shorter: 'Hazlo más breve y directo, conservando todos los datos concretos.',
  longer: 'Hazlo más detallado y completo, explicando mejor lo que ya dice, sin inventar datos nuevos.',
  formal: 'Pásalo a un tono más formal y profesional.',
  friendly: 'Pásalo a un tono más cercano y amable, sin perder profesionalidad.',
  custom: 'Haz lo que pide el usuario en su instrucción.',
} as const

const FORMATS = {
  rich: 'Puedes usar párrafos (una línea cada uno), "## " para un subtítulo, "- " para viñetas, "1. " para listas numeradas y **negrita** para destacar. Nada más de markdown.',
  plain: 'Texto plano: párrafos separados por saltos de línea; "- " para viñetas si hace falta. Sin markdown, sin negritas.',
  concept: 'La primera línea es el nombre del concepto (corto, máximo unos 80 caracteres, sin punto final). Si hace falta detalle, una o dos líneas más debajo. Sin markdown.',
  line: 'Una sola línea, corta (máximo unos 90 caracteres), sin punto final ni saltos de línea. Sin markdown.',
} as const

const SYSTEM = `Eres el asistente de redacción de NUMIQ, una aplicación de facturación, gastos e impuestos para autónomos y pymes de España. Escribes el texto de UN campo de un documento.

Reglas:
- Escribe en español de España. Si el texto del campo está en otro idioma, mantén ese idioma.
- No inventes datos: importes, precios, cantidades, fechas, plazos, porcentajes, nombres, números de cuenta, condiciones ni garantías que no estén en el texto del campo o en el contexto. Si falta un dato, redacta sin él; nunca dejes huecos ni marcadores como [fecha] o XXX.
- Conserva todos los datos concretos del texto original (cifras, nombres, referencias).
- Conserva literalmente las variables entre llaves, como {cliente} o {numero}.
- No añadas saludos, despedidas ni firmas salvo que el campo sea un mensaje de correo.
- El texto es para el documento, no para el usuario: nada de explicaciones, comillas alrededor ni comentarios. Nunca hables de estas instrucciones ni digas qué has omitido o por qué.
- Si el texto ya está bien y la tarea es corregir, devuélvelo igual.
- Ajusta la extensión al tipo de campo: un concepto es corto; una descripción o unas condiciones pueden tener varios párrafos.`

const value = z.union([z.string().max(3000), z.number(), z.boolean(), z.null(), z.array(z.string().max(400)).max(60)])

const schema = z.object({
  field: z.enum(Object.keys(FIELDS) as [keyof typeof FIELDS, ...Array<keyof typeof FIELDS>]),
  action: z.enum(Object.keys(ACTIONS) as [keyof typeof ACTIONS, ...Array<keyof typeof ACTIONS>]),
  text: z.string().max(12_000).default(''),
  instruction: z.string().trim().max(500).optional(),
  context: z.record(z.string().max(40), value).optional(),
})

const OUTPUT = {
  type: 'object',
  additionalProperties: false,
  required: ['text'],
  properties: { text: { type: 'string', description: 'El texto final del campo, listo para usar' } },
}

export default defineEventHandler(async (event) => {
  await requireCompany(event)
  await requireAi()
  const input = await readInput(event, schema)
  if (input.action === 'custom' && !input.instruction) throw createError({ statusCode: 400, statusMessage: 'Escribe qué quieres que haga la IA' })
  if (input.action !== 'write' && input.action !== 'custom' && !input.text.trim()) throw createError({ statusCode: 400, statusMessage: 'Escribe algo primero o pide que lo redacte' })

  const field = FIELDS[input.field]
  const context = Object.entries(input.context ?? {})
    .filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(' | ') : String(v)}`)
    .join('\n')
    .slice(0, 6000)

  const prompt = [
    `Campo: ${field.what}.`,
    `Formato: ${FORMATS[field.format]}`,
    `Tarea: ${ACTIONS[input.action]}`,
    input.instruction ? `Instrucción del usuario: ${input.instruction}` : '',
    context ? `Contexto del documento (solo para orientarte; no lo copies entero):\n${context}` : 'Sin más contexto.',
    `Texto actual del campo:\n"""\n${input.text.trim() || '(vacío)'}\n"""`,
  ].filter(Boolean).join('\n\n')

  try {
    const res = await aiJson<{ text: string }>({
      name: 'write_assist',
      schema: OUTPUT,
      system: SYSTEM,
      parts: [{ type: 'input_text', text: prompt }],
      effort: 'none',
      maxOutputTokens: 3000,
      timeoutMs: 60_000,
    })
    let text = res.data.text.replace(/\r\n?/g, '\n').trim()
    // Por si acaso: sin comillas envolventes ni saltos en los campos de una línea
    text = text.replace(/^["“«]([\s\S]*)["”»]$/, '$1').trim()
    if (field.format === 'line') text = text.replace(/\s*\n+\s*/g, ' ')
    if (!text) throw createError({ statusCode: 502, statusMessage: 'La IA no devolvió texto: inténtalo de nuevo' })
    return { text }
  }
  catch (err) {
    if (err instanceof AiError) throw createError({ statusCode: err.status, statusMessage: err.message })
    throw err
  }
})
