import type { ExtractedDocType, ExtractedDocument, ExtractedParty, ImportDirection, ImportInvoiceData, ImportLine, ImportParty, ImportTaxLine } from '../../shared/types/import'
import { folderSignals } from './doc-read'
import type { FolderKind, FolderSignals } from './doc-read'
import { resolveDocumentDate } from '../../shared/utils/source-date'
import type { SourceFileDate } from '../../shared/utils/source-date'
import { resolveInvoiceParties } from './document-parties'
import type { ImportCompanyIdentity, ImportKnownParty } from './document-parties'
import { resolveQuoteVat } from './quote-vat'

/**
 * Lectura de facturas con IA y su validación fiscal. La IA solo transcribe; aquí se comprueba que
 * los importes cuadren, se normalizan NIF y fechas y se decide si es emitida o recibida.
 */

export interface ExtractContext {
  fileDate?: SourceFileDate | null
  /** ibans: cuentas de la empresa (la de sus datos y las del banco), para reconocer sus facturas por la cuenta de cobro */
  company: ImportCompanyIdentity
  contacts?: ImportKnownParty[]
  categories: Array<{ id: number, name: string }>
  /** Ruta o nombre del archivo (las carpetas dan pistas) */
  path: string
  direction: ImportDirection | 'auto'
  today: string
}

// ─── Esquema de la respuesta (JSON estricto) ─────────────────────────────────

const nullable = (type: string) => ({ type: [type, 'null'] })

function partySchema() {
  return {
    type: ['object', 'null'],
    additionalProperties: false,
    required: ['name', 'nif', 'address', 'postalCode', 'city', 'province', 'country', 'email', 'phone', 'isPerson'],
    properties: {
      name: { type: 'string' },
      nif: nullable('string'),
      address: nullable('string'),
      postalCode: nullable('string'),
      city: nullable('string'),
      province: nullable('string'),
      country: nullable('string'),
      email: nullable('string'),
      phone: nullable('string'),
      isPerson: { type: 'boolean' },
    },
  }
}

function documentSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['documentType', 'footerName', 'footerParty', 'payeeName', 'roleEvidence', 'issuer', 'recipient', 'number', 'issueDate', 'dueDate', 'currency', 'lines', 'taxLines', 'irpfRate', 'irpfAmount', 'total', 'paymentMethod', 'iban', 'ibanRole', 'vatPresentation', 'paid', 'rectifiedNumber', 'customerReference', 'references', 'category', 'summary', 'bodyText', 'itemized', 'confidence', 'warnings'],
    properties: {
      documentType: { type: 'string', enum: ['invoice', 'simplified_invoice', 'credit_note', 'quote', 'proforma', 'purchase_order', 'delivery_note', 'receipt', 'payroll', 'bank_statement', 'contract', 'tax_form', 'other'] },
      footerName: nullable('string'),
      footerParty: partySchema(),
      payeeName: nullable('string'),
      roleEvidence: { type: 'string' },
      issuer: partySchema(),
      recipient: partySchema(),
      number: nullable('string'),
      issueDate: nullable('string'),
      dueDate: nullable('string'),
      currency: { type: 'string' },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['description', 'sku', 'kind', 'quantity', 'unitPrice', 'discountPct', 'vatRate', 'amount'],
          properties: {
            description: { type: 'string' },
            sku: nullable('string'),
            kind: { type: 'string', enum: ['service', 'product'] },
            quantity: { type: 'number' },
            unitPrice: { type: 'number' },
            discountPct: { type: 'number' },
            vatRate: nullable('number'),
            amount: { type: 'number' },
          },
        },
      },
      taxLines: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['base', 'vatRate', 'vatAmount', 'surchargeRate', 'surchargeAmount'],
          properties: {
            base: { type: 'number' },
            vatRate: { type: 'number' },
            vatAmount: { type: 'number' },
            surchargeRate: { type: 'number' },
            surchargeAmount: { type: 'number' },
          },
        },
      },
      irpfRate: nullable('number'),
      irpfAmount: nullable('number'),
      total: nullable('number'),
      paymentMethod: { type: ['string', 'null'], enum: ['transfer', 'card', 'cash', 'direct_debit', 'bizum', 'other', null] },
      iban: nullable('string'),
      ibanRole: { type: 'string', enum: ['payee', 'payer', 'unknown'] },
      vatPresentation: {
        type: 'object', additionalProperties: false,
        required: ['mode', 'rate', 'amount', 'evidence'],
        properties: {
          mode: { type: 'string', enum: ['excluded', 'included', 'exempt', 'unknown'] },
          rate: nullable('number'), amount: nullable('number'), evidence: nullable('string'),
        },
      },
      paid: nullable('boolean'),
      rectifiedNumber: nullable('string'),
      customerReference: nullable('string'),
      references: { type: 'array', items: { type: 'string' } },
      category: nullable('string'),
      summary: nullable('string'),
      bodyText: nullable('string'),
      itemized: { type: 'boolean' },
      confidence: { type: 'integer' },
      warnings: { type: 'array', items: { type: 'string' } },
    },
  }
}

function extractionSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['documents'],
    properties: { documents: { type: 'array', items: documentSchema() } },
  }
}

const SYSTEM = `Eres un experto contable español que lee facturas, tickets y documentos fiscales (OCR) con precisión absoluta.

Reglas:
- Devuelve solo lo que aparece en el documento. Si un dato no aparece, null. Nunca inventes NIF, números, fechas ni importes.
- Un archivo puede contener varios documentos (p. ej. un PDF con varias facturas seguidas): devuelve uno por factura. Una factura de varias páginas es UN solo documento. Si no hay ningún documento legible, devuelve la lista vacía.
- Fechas en formato AAAA-MM-DD. En España las fechas se escriben día/mes/año.
- Importes como números con punto decimal: 1.234,56 € → 1234.56.
- NIF, CIF y NIE en mayúsculas, sin espacios, puntos ni guiones (B-12.345.678 → B12345678). NIF-IVA europeo con su prefijo de país. country: código ISO de 2 letras (España = ES).
- issuer: quien emite la factura y la cobra (el vendedor). recipient: el cliente al que se factura (null si no figura, típico de los tickets).
- Para distinguirlos NO te guíes por la posición en la página: muchas facturas ponen el cliente arriba a la izquierda y el emisor a la derecha. Pistas del emisor: el logotipo o membrete, el pie de página con su dirección, web o datos registrales, la cuenta bancaria a la que hay que pagar ("realizar el pago mediante transferencia a…"; en una domiciliación la cuenta es la del cliente) y quien firma. Pistas del cliente: rótulos como "Cliente", "Facturar a", "Destinatario" o "Datos del cliente".
- Muchas plantillas ponen arriba una tabla «NIF/CIF | Nº Factura | Fecha» sin nombre: ese NIF suele ser el del CLIENTE (el dato fiscal del destinatario que pide la factura), no el del emisor. Asigna cada NIF al bloque de nombre y dirección al que pertenece: si un bloque ya trae su propio NIF, el NIF suelto de la cabecera es del otro.
- Un recuadro con solo nombre y dirección postal (la ventana del sobre) es el destinatario. Un bloque sin rótulo con nombre, dirección, NIF y email de contacto suele ser el emisor.
- Retención de IRPF del 7 % o del 15 % (o del 1 % o 2 %): la practica la empresa que paga a un profesional persona física, así que el emisor es la persona física (DNI o NIE) y el cliente la sociedad (CIF que empieza por letra).
- footerName: el nombre de la empresa o persona cuyos datos (dirección, web, teléfono) aparecen en el pie de página; null si no hay pie. Una línea suelta con el IBAN o las condiciones de pago no es un pie.
- footerParty: transcribe los datos identificativos de esa empresa en el pie (NIF, email, dirección y teléfono); null si no hay. Nunca mezcles su NIF con el nombre del cliente.
- Contrasta siempre los bloques con el NIF, nombre comercial, datos de contacto y cuentas de la empresa usuaria. La posición izquierda/derecha o arriba/abajo no determina quién es el cliente. No copies datos de la empresa usuaria a la contraparte.
- ibanRole: payee si es la cuenta de destino de una transferencia/cobro; payer si es la cuenta a la que se carga una domiciliación o del pagador; unknown si no se especifica.
- payeeName: el titular de la cuenta bancaria a la que se pide pagar, solo si el documento escribe su nombre junto a la cuenta ("realizar el pago a…", "transferencia a…", "titular: …"); null si solo figura «IBAN: …» sin titular (no lo deduzcas del emisor) o si es una domiciliación en la cuenta del cliente.
- roleEvidence: antes de rellenar issuer y recipient, anota en pocas palabras qué te indica quién emite el documento (p. ej. "pago a Estudio Gráfico SL y su pie de página: emite Estudio Gráfico"). Si uno de los bloques es la empresa usuaria, di qué la delata como emisora o como cliente.
- Si el título o el encabezado dice FACTURA, es una factura aunque el texto mencione un presupuesto, una proforma o un pedido anterior.
- isPerson: true si es una persona física (nombre y apellidos o DNI/NIE), false si es una empresa.
- lines: cada concepto facturado. description: el concepto completo, incluido su texto de detalle: todo lo que está dentro de la celda del concepto en la tabla (periodo, detalle, referencias como OP, pedido o código de proyecto) va en esa description, con un salto de línea entre datos o frases distintas (sin cortar una frase donde el ancho de la celda la parte), y nunca en bodyText. amount: base de la línea sin IVA, después del descuento. vatRate: el tipo de IVA de la línea si se conoce.
- taxLines: una por cada tipo de IVA del cuadro de impuestos (base, tipo, cuota y recargo de equivalencia si lo hay). Operación exenta, intracomunitaria o con inversión del sujeto pasivo: vatRate 0 y vatAmount 0.
- vatPresentation: transcribe cómo se presenta el precio, especialmente en presupuestos. «1.000 € + IVA», «más IVA», «IVA no incluido» o «sin IVA» => mode excluded y amount 1000 (precio antes de IVA). «IVA incluido» => included y amount precio final. «Exento de IVA» => exempt. Si no consta => unknown. rate es el porcentaje expresamente escrito, null si no figura; evidence es el fragmento literal que lo indica. No supongas un porcentaje al transcribir.
- Si solo hay «precio + IVA» sin cuadro fiscal, taxLines debe estar vacío (no inventes una línea al 0 %). total es el total final con impuestos solo cuando aparece explícitamente: para «1.000 € + IVA» sin total final, total=null. El sistema calculará después el IVA usando el tipo escrito o el configurado en la empresa. La ausencia de desglose en ese formato de presupuesto no es un error ni requiere pedir datos al usuario.
- Ticket o factura simplificada que solo muestra el total "IVA incluido" y el tipo: calcula base y cuota (base = total / (1 + tipo/100)) y avisa de que lo has calculado. Si la base y la cuota figuran, no avises.
- irpfRate e irpfAmount: la retención de IRPF si la hay, en positivo.
- total: el importe total del documento (lo que hay que pagar).
- Factura rectificativa o abono: documentType credit_note, importes negativos tal y como figuran y rectifiedNumber con la factura que corrige.
- paid: true solo si consta pagada (ticket pagado con tarjeta o en efectivo, recibo domiciliado ya cargado, sello o texto "pagado"); false solo si dice expresamente que está pendiente o impagada; null en cualquier otro caso (una fecha de vencimiento no significa que esté sin pagar).
- customerReference: número de pedido o referencia del cliente si figura.
- references: números de OTROS documentos que se citan (pedido, orden de compra, albarán, presupuesto, contrato, factura), tal y como figuran, p. ej. "Su pedido nº 4500123" → "4500123", "Albarán A-77" → "A-77". Nunca el número del propio documento. Lista vacía si no cita ninguno.
- Orden de pedido u orden de compra (OP, PO, purchase order, "pedido nº"): documentType purchase_order. issuer = la empresa que hace el pedido (el comprador, normalmente la del membrete); recipient = el proveedor al que se le pide (el bloque rotulado "Proveedor"). number = el número del pedido.
- Albarán o nota de entrega: documentType delivery_note. issuer = quien entrega (el vendedor), recipient = quien recibe.
- Presupuestos y proformas: con sus líneas y sus impuestos si figuran; no confundas el precio antes de IVA con el total final. Si solo consta «+ IVA», guarda ese precio en vatPresentation.amount y total=null.
- Pedidos y albaranes: con sus líneas, sus impuestos si figuran y su total (si no hay total con IVA, la suma sin impuestos).
- Modelos y justificantes de Hacienda o de la Seguridad Social (303, 130, 111, 115, 390, 190, 347, cartas de pago, recibos de liquidación): documentType tax_form.
- Extractos bancarios, nóminas, contratos y otros documentos que no son facturas: su documentType, sin líneas ni impuestos, con issueDate (fecha o fin del periodo) y summary.
- Las carpetas donde el usuario guardó el archivo (si se indican) son una pista fuerte del tipo de documento y de si es emitido o recibido: úsalas salvo que el documento diga claramente otra cosa (p. ej. FACTURA en el título dentro de una carpeta de presupuestos).
- category: la categoría de gasto más adecuada de la lista dada (texto exacto) o null.
- summary: de 3 a 8 palabras que describan el documento (p. ej. "Fibra y móvil de octubre").
- bodyText: el texto descriptivo del cuerpo del documento que está FUERA de la tabla de conceptos: asunto o título del trabajo, alcance, descripción del servicio, condiciones, costes explicados, plazos u observaciones. Transcríbelo completo y literal, en el mismo orden y sin resumir. Formato: cada línea del original en su propia línea; los títulos de apartado y el asunto empiezan por "## "; las viñetas por "- " y las listas numeradas por "1. ". No repitas el texto de los conceptos: si el título o el párrafo encima de la tabla dice lo mismo que una línea, omítelo. No incluyas el encabezado con el número o la fecha, los datos del emisor y del cliente, la tabla de conceptos, el cuadro de bases, IVA y total, los datos bancarios ni los textos legales del pie (protección de datos, registro mercantil). null si no hay texto así (lo normal en tickets).
- itemized: true si el documento detalla lo facturado en conceptos con su propio importe, cantidad o precio (tabla o lista de líneas con importes). false si solo describe el trabajo con texto (asunto, descripción, periodo) y los importes aparecen únicamente en el cuadro de base, IVA y total. Con itemized false, pon ese texto completo en bodyText y una sola línea por tipo de IVA con su base.
- confidence: de 0 a 100, tu seguridad en la lectura (baja si está borroso, cortado o manuscrito).
- warnings: avisos breves en español solo si algo no cuadra, es ilegible o falta un dato importante. No avises de quién emite o recibe el documento ni de si encaja con las carpetas o con lo que indica el usuario (eso lo decide la app con roleEvidence y sus propios datos), ni de cómo has normalizado nombres, NIF o formatos, ni de erratas del original.`

function contextText(ctx: ExtractContext) {
  const c = ctx.company
  return [
    `Empresa usuaria de la app (es el emisor de sus facturas emitidas y el receptor de las recibidas): ${c.legalName}${c.tradeName && c.tradeName !== c.legalName ? ` (${c.tradeName})` : ''}, NIF ${c.nif}.`,
    /^(\d{8}[A-Z]|[KLMXYZ]\d{7}[A-Z])$/.test(comparableNif(c.nif))
      ? 'Es un autónomo (persona física): en sus facturas a sociedades con retención de IRPF, él es el emisor y la sociedad el cliente.'
      : '',
    c.contact ? `Sus datos de contacto: ${c.contact}. Contrástalos con cada bloque y con el pie para identificar a la empresa; no confundas los datos del destinatario con los del emisor.` : '',
    c.ibans?.length ? `Cuentas propias registradas en la app: ${c.ibans.join(', ')}. Si la cuenta es de cobro, la empresa emite; si se carga una domiciliación en ella, la empresa recibe. Una cuenta sin papel indicado no decide por sí sola.` : '',
    `Categorías de gasto: ${ctx.categories.map(x => x.name).join(', ') || 'ninguna'}.`,
    ctx.direction !== 'auto'
      ? ctx.direction === 'issued'
        ? 'El usuario indica que son facturas EMITIDAS: la empresa usuaria es el emisor (issuer) y la otra parte el cliente (recipient), aunque un bloque o un NIF de la cabecera parezca decir otra cosa.'
        : 'El usuario indica que son facturas RECIBIDAS: la otra parte es el emisor (issuer) y la empresa usuaria el cliente (recipient).'
      : '',
    folderText(folderSignals(ctx.path), ctx.direction === 'auto'),
    `Fecha de hoy: ${ctx.today}.`,
    `Archivo: ${ctx.path}`,
  ].filter(Boolean).join('\n')
}

// ─── Comprobaciones ──────────────────────────────────────────────────────────

const INVOICE_TYPES = new Set(['invoice', 'simplified_invoice', 'credit_note', 'receipt'])

export const isInvoiceDoc = (d: Pick<ExtractedDocument, 'documentType'>) => INVOICE_TYPES.has(d.documentType)

/** ¿Cuadran base + IVA + recargo − retención con el total? */
export function amountsAddUp(d: Pick<ExtractedDocument, 'taxLines' | 'irpfAmount' | 'total'>) {
  if (d.total == null || !d.taxLines.length) return false
  const sum = d.taxLines.reduce((s, t) => s + t.base + t.vatAmount + t.surchargeAmount, 0) - Math.abs(d.irpfAmount ?? 0) * Math.sign(d.total || 1)
  return Math.abs(round2(sum) - d.total) <= 0.05
}

/** Una lectura es mejor si cuadra más documentos y con más confianza */
function readingScore(docs: ExtractedDocument[]) {
  if (!docs.length) return -1
  const invoices = docs.filter(isInvoiceDoc)
  const ok = invoices.filter(amountsAddUp).length
  const conf = docs.reduce((s, d) => s + d.confidence, 0) / docs.length
  return (invoices.length ? ok / invoices.length : 1) * 1000 + conf
}

function needsSecondLook(docs: ExtractedDocument[]) {
  if (!docs.length) return true
  return docs.some(d => (isInvoiceDoc(d) && !amountsAddUp(d)) || d.confidence < 70)
}

export interface Extraction {
  documents: ExtractedDocument[]
  model: string
  ms: number
  tokens: { input: number, output: number }
}

/**
 * Lee un documento con el modelo rápido; si algo no cuadra, lo relee con el modelo avanzado
 * y se queda con la mejor lectura.
 */
export async function extractDocuments(parts: AiPart[], ctx: ExtractContext): Promise<Extraction> {
  const s = aiSettings()
  const request = (model: string, effort: AiEffort) => aiJson<{ documents: ExtractedDocument[] }>({
    name: 'documentos',
    schema: extractionSchema(),
    system: SYSTEM,
    parts: [{ type: 'input_text', text: contextText(ctx) }, ...parts],
    model,
    effort,
  })
  const first = await request(s.model, 'low')
  let best = first
  if (needsSecondLook(first.data.documents) && s.proModel !== s.model) {
    const second = await request(s.proModel, 'medium').catch(() => null)
    if (second && readingScore(second.data.documents) > readingScore(first.data.documents)) best = second
    if (second) {
      best = { ...best, ms: first.ms + second.ms, tokens: { input: first.tokens.input + second.tokens.input, output: first.tokens.output + second.tokens.output } }
    }
  }
  const documents = best.data.documents.map(d => ({ ...d, warnings: usefulAiWarnings(d.warnings) }))
  return { documents, model: best.model, ms: best.ms, tokens: best.tokens }
}

// Avisos de la IA que no le sirven al usuario y lo confunden: quién emite o recibe y si encaja con la carpeta (lo decide
// resolveInvoiceParties con sus pruebas y avisa él mismo; folderMismatch, del tipo) y notas de transcripción
// (un nombre o un NIF normalizado, una errata del original)
const NOISE_WARNING = /carpeta|emitid[oa]|recibid[oa]|dirigid[oa]|tercero|emisor|destinatari|receptor|normaliz|errata|transcri/i
export const usefulAiWarnings = (warnings: string[]) => warnings.filter(w => !NOISE_WARNING.test(w))

/** Partes de la petición a la IA según el tipo de archivo */
export function aiPartsFor(kind: ImportKind, data: Buffer, name: string): AiPart[] {
  if (kind.family === 'pdf') return [{ type: 'input_file', filename: safeFilename(name).replace(/\.[^.]*$/, '') + '.pdf', file_data: `data:application/pdf;base64,${data.toString('base64')}` }]
  if (kind.family === 'image') return [{ type: 'input_image', image_url: `data:${kind.mime};base64,${data.toString('base64')}`, detail: 'high' }]
  if (kind.family === 'word') {
    const content = kind.ext === 'doc' ? readLegacyDoc(data) : readWordZip(data, kind.ext)
    const parts: AiPart[] = [{ type: 'input_text', text: `Contenido del documento:\n\n${content.text.slice(0, 150_000)}` }]
    // Factura escaneada pegada en un Word: poco texto y una imagen grande
    if (content.text.replace(/\s/g, '').length < 120 && content.images[0]) {
      const img = content.images[0]
      parts.push({ type: 'input_image', image_url: `data:${img.mime};base64,${img.data.toString('base64')}`, detail: 'high' })
    }
    return parts
  }
  return [{ type: 'input_text', text: `Contenido del documento:\n\n${decodeText(data).slice(0, 150_000)}` }]
}

// ─── Normalización a lo que se importa ───────────────────────────────────────

const LEGAL_FORMS = /\b(s\.?\s?l\.?\s?u?|s\.?\s?a\.?\s?u?|s\.?\s?l\.?\s?l|s\.?\s?c\.?\s?p|c\.?\s?b|s\.?\s?coop|sociedad (limitada|anonima)( unipersonal)?|slne|sau|slu)\.?$/

/** Nombre comparable: sin tildes, mayúsculas, signos ni forma jurídica ("Endesa, S.A." = "ENDESA SA") */
export function comparableName(name: string | null | undefined) {
  return (name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,;:'"`´()[\]{}&/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LEGAL_FORMS, '')
    .trim()
}

/** NIF comparable: los españoles sin el prefijo ES del NIF-IVA */
export function comparableNif(nif: string | null | undefined) {
  const n = normalizeNif(nif ?? '')
  return /^ES[0-9A-Z]\d{7}[0-9A-Z]$/.test(n) ? n.slice(2) : n
}

export function toImportParty(p: ExtractedParty): ImportParty {
  const clean = (v: string | null, max: number) => (v?.replace(/\s+/g, ' ').trim().slice(0, max) || null)
  const nif = p.nif ? comparableNif(p.nif) || null : null
  const country = (p.country ?? '').trim().toUpperCase()
  return {
    name: clean(p.name, 200) ?? 'Sin nombre',
    nif: nif?.slice(0, 20) ?? null,
    address: clean(p.address, 255),
    postalCode: clean(p.postalCode, 10),
    city: clean(p.city, 120),
    province: clean(p.province, 120),
    country: /^[A-Z]{2}$/.test(country) ? country : nif && /^[A-Z]{2}/.test(nif) && !validateNif(nif).valid && looksLikeEuVat(nif) ? nif.slice(0, 2) : 'ES',
    email: p.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim()) ? p.email.trim().toLowerCase().slice(0, 191) : null,
    phone: clean(p.phone, 40),
    isPerson: p.isPerson,
  }
}

export type DirectionResult = ReturnType<typeof resolveInvoiceParties>

/** Si el usuario eligió emitidas o recibidas, manda su elección; si no, la evidencia del documento y, como alternativa, las carpetas. */
export function detectDirection(d: ExtractedDocument, ctx: ExtractContext, hint: ImportDirection | null): DirectionResult {
  const chosen = ctx.direction !== 'auto' ? ctx.direction : null
  return resolveInvoiceParties(d, ctx.company, ctx.contacts, folderHint(ctx.path) ?? hint, chosen)
}

/** Emitidas o recibidas según las carpetas de la ruta (sin el nombre del archivo) */
export const folderHint = (path: string) => folderSignals(path).direction

/** Lo que dicen las carpetas, en una frase para la IA */
function folderText(f: FolderSignals, withDirection: boolean) {
  // Ventas o compras solo dice algo de facturas, presupuestos, pedidos y albaranes (no de nóminas o extractos)
  const direction = withDirection && (!f.kind || FOLDER_SIDED.includes(f.kind)) ? f.direction : null
  if (!f.kind && !direction) return ''
  const what = f.kind ? FOLDER_KIND_TEXT[f.kind] : 'documentos'
  // En ventas, los pedidos los hace el cliente; en compras, la empresa a sus proveedores
  const who = !direction
    ? ''
    : f.kind === 'purchase_order'
      ? direction === 'issued' ? ' de clientes (la empresa usuaria es el proveedor)' : ' que la empresa usuaria hace a sus proveedores'
      : direction === 'issued' ? ' de ventas, emitidos por la empresa usuaria (ella es el emisor)' : ' de compras, recibidos de proveedores (la empresa usuaria es el cliente)'
  return `Carpetas del archivo: «${f.folders}». Por su nombre contienen ${what}${who}.`
}

/** El documento no es lo que dice su carpeta: se avisa (manda lo leído, que ya tuvo en cuenta la carpeta) */
export function folderMismatch(type: ExtractedDocType, f: FolderSignals) {
  if (!f.kind || FOLDER_KIND_TYPES[f.kind].includes(type) || (type === 'other' && FOLDER_KIND_ADOPT[f.kind])) return null
  return `Está en la carpeta «${f.folders.split('/').pop()}», pero parece ${docTypeArticle(type)}: revisa el tipo`
}

/** La IA no supo qué era ("other") y la carpeta lo dice (albaranes, nóminas, extractos, modelos…): se toma de la carpeta */
export const typeFromFolder = (type: ExtractedDocType, f: FolderSignals): ExtractedDocType =>
  (type === 'other' && f.kind && FOLDER_KIND_ADOPT[f.kind]) || type

const docTypeArticle = (type: ExtractedDocType) => {
  const noun = docTypeNoun(type)
  return noun.replace(/^el /, 'un ').replace(/^la /, 'una ')
}

const round4 = (n: number) => Math.round(n * 10000) / 10000

/** Tipo sacado de importe ÷ base: el habitual si solo difiere por redondeos; si no, el exacto (nóminas: 12,43 %) */
function irpfFromAmount(rate: number) {
  const nearest = IRPF_RATES.reduce((best, r) => (Math.abs(r - rate) < Math.abs(best - rate) ? r : best), 0)
  return Math.abs(nearest - rate) <= 0.1 ? nearest : round2(rate)
}

function validDate(s: string | null | undefined) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && d.getUTCFullYear() >= 1990 ? s : null
}

/** Un gasto se pasa a euros al importarlo (cambio del BCE); una factura emitida, no */
export function currencyWarning(currency: string, direction: ImportDirection) {
  return direction === 'received'
    ? `Importes en ${currency}: se pasarán a euros con el cambio oficial del BCE de su fecha al importar`
    : `Importes en ${currency}: conviértelos a euros`
}

export interface InvoiceConversion {
  data: ImportInvoiceData
  warnings: string[]
  /** Falta algo imprescindible (fecha o importes) */
  blocking: boolean
}

/** Documento leído → factura a importar, con avisos de todo lo que no cuadra */
export function toInvoiceData(d: ExtractedDocument, direction: ImportDirection, ctx: ExtractContext): InvoiceConversion {
  const vat = resolveQuoteVat(d, ctx.company.defaultVatRate)
  d = vat.document
  const warnings = [...d.warnings]
  const party = direction === 'issued' ? d.recipient : d.issuer
  const importParty = party ? toImportParty(party) : null

  // Impuestos: los del cuadro resumen; si no hay, agrupando las líneas
  let taxLines: ImportTaxLine[] = d.taxLines.map(t => ({
    base: round2(t.base),
    vatRate: t.vatRate,
    vatAmount: round2(t.vatAmount),
    surchargeRate: t.surchargeRate || (t.surchargeAmount ? (SURCHARGE_BY_VAT[t.vatRate] ?? 0) : 0),
    surchargeAmount: round2(t.surchargeAmount),
  }))
  if (!taxLines.length && d.lines.length) {
    const groups = new Map<number, number>()
    for (const l of d.lines) groups.set(l.vatRate ?? 0, round2((groups.get(l.vatRate ?? 0) ?? 0) + l.amount))
    taxLines = [...groups].map(([vatRate, base]) => ({ base, vatRate, vatAmount: pctOf(base, vatRate), surchargeRate: 0, surchargeAmount: 0 }))
  }
  if (!taxLines.length && d.total != null) {
    taxLines = [{ base: round2(d.total), vatRate: 0, vatAmount: 0, surchargeRate: 0, surchargeAmount: 0 }]
    warnings.push('No se encontró el desglose de IVA: revisa la base y el tipo')
  }
  for (const t of taxLines) {
    if (Math.abs(t.vatAmount - pctOf(t.base, t.vatRate)) > Math.max(0.05, Math.abs(t.base) * 0.002)) warnings.push(`La cuota del IVA ${t.vatRate} % no corresponde a su base`)
  }

  const taxBase = round2(taxLines.reduce((s, t) => s + t.base, 0))
  let irpfRate = d.irpfRate ?? 0
  let irpfAmount = Math.abs(d.irpfAmount ?? 0)
  if (irpfAmount && !irpfRate && taxBase) irpfRate = irpfFromAmount(irpfAmount / Math.abs(taxBase) * 100)
  if (irpfRate && !irpfAmount) irpfAmount = Math.abs(pctOf(taxBase, irpfRate))
  if (taxBase < 0) irpfAmount = -irpfAmount
  const computed = round2(taxLines.reduce((s, t) => s + t.base + t.vatAmount + t.surchargeAmount, 0) - irpfAmount)
  const total = d.total ?? computed
  if (d.total != null && Math.abs(computed - d.total) > 0.05) warnings.push(`Los importes no cuadran: base + IVA − retención suman ${eurText(computed)} y el total es ${eurText(d.total)}`)

  // Líneas: se usan si reproducen las bases por tipo; si no, una línea por tipo de IVA
  const singleRate = taxLines.length === 1 ? taxLines[0]!.vatRate : null
  const lines: ImportLine[] = d.lines.filter(l => l.description.trim()).map((l) => {
    const vatRate = l.vatRate ?? singleRate ?? 0
    const surchargeRate = taxLines.find(t => t.vatRate === vatRate)?.surchargeRate ?? 0
    const quantity = l.quantity || 1
    const discountPct = Math.min(Math.max(l.discountPct || 0, 0), 100)
    let unitPrice = l.unitPrice
    if (Math.abs(lineAmounts({ quantity, unitPrice, discountPct, vatRate }).base - l.amount) > 0.02 && discountPct < 100) {
      unitPrice = round4(l.amount / quantity / (1 - discountPct / 100))
    }
    return { description: unwrapLines(l.description.replace(/(\s*\n){2,}/g, '\n')).trim().slice(0, 2000), sku: l.sku?.trim().slice(0, 60) || null, kind: l.kind, quantity, unitPrice, discountPct, vatRate, surchargeRate }
  })

  const resolvedDate = resolveDocumentDate(d.issueDate, ctx.fileDate)
  const issueDate = resolvedDate.date
  if (resolvedDate.warning) warnings.push(resolvedDate.warning)
  const dueDate = validDate(d.dueDate)
  if (!issueDate) warnings.push('Falta la fecha de la factura')
  else if (issueDate > ctx.today) warnings.push('La fecha de la factura es posterior a hoy')
  const docType = d.documentType === 'credit_note' ? 'credit_note' : d.documentType === 'simplified_invoice' ? 'simplified' : d.documentType === 'receipt' ? 'ticket' : d.documentType === 'quote' || d.documentType === 'proforma' ? d.documentType : 'invoice'
  if (!d.number && docType === 'invoice') warnings.push('No se encontró el número de factura')
  if (importParty?.nif && importParty.country === 'ES' && !validateNif(importParty.nif).valid) warnings.push(`El NIF ${importParty.nif} no es válido: revísalo`)
  if (!importParty && docType === 'invoice') warnings.push(direction === 'issued' ? 'No figura el cliente' : 'No figura el proveedor')
  if (d.confidence < 75) warnings.push(`Lectura dudosa (confianza ${d.confidence} %): compárala con el original`)
  if (d.currency && d.currency.toUpperCase() !== 'EUR') warnings.push(currencyWarning(d.currency.toUpperCase(), direction))

  const category = d.category ? ctx.categories.find(c => comparableName(c.name) === comparableName(d.category)) : null
  const data = reconcileInvoiceLines({
    vatCalculation: vat.calculation,
    docType,
    party: importParty,
    number: d.number?.trim().slice(0, 40) || null,
    issueDate,
    dateFallback: resolvedDate.fallback,
    dueDate: dueDate && issueDate && dueDate < issueDate ? null : dueDate,
    lines,
    linesMatch: true,
    taxLines,
    irpfRate,
    irpfAmount,
    total: round2(total),
    currency: d.currency?.trim().toUpperCase().slice(0, 3) || 'EUR',
    paymentMethod: d.paymentMethod,
    paid: docType === 'quote' || docType === 'proforma' ? null : d.paid ?? (docType === 'ticket' || docType === 'simplified' ? true : null),
    rectifiedNumber: d.rectifiedNumber?.trim().slice(0, 60) || null,
    customerReference: d.customerReference?.trim().slice(0, 80) || null,
    references: cleanReferences(d.references, d.number),
    categoryId: direction === 'received' ? category?.id ?? null : null,
    description: d.summary?.trim().slice(0, 255) || null,
    ...(d.itemized === false && docType !== 'ticket'
      ? { conceptless: true, bodyText: conceptlessBody(d.bodyText, d.lines.map(l => l.description)) }
      : { bodyText: withoutRepeatedBody(d.bodyText, d.lines.map(l => l.description)) }),
  })
  return {
    data,
    warnings: [...new Set(warnings)],
    blocking: !issueDate || !taxLines.length,
  }
}

/**
 * Une los renglones que el ancho de la página partió a media frase: el siguiente sigue en minúscula y el
 * anterior no acaba en punto, dos puntos ni paréntesis («…certificado de seguridad para\nlaboratorio.com»).
 */
export function unwrapLines(text: string) {
  return text.replace(/\r\n?/g, '\n').replace(/([^\n.:;!?)])[ \t]*\n[ \t]*(?=\p{Ll})/gu, '$1 ')
}

/** Texto del cuerpo: sin espacios sobrantes, renglones partidos ni más de una línea en blanco seguida */
export function cleanBodyText(text: string | null | undefined) {
  const clean = unwrapLines(text ?? '')
    .split('\n')
    .map(l => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return clean.slice(0, 8000) || null
}

const comparableText = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/**
 * Quita del texto del cuerpo lo que ya dicen los conceptos: muchas facturas repiten el concepto como título
 * encima de la tabla y la factura importada lo mostraría dos veces. Se descartan las líneas del cuerpo que
 * están enteras en algún concepto (también partidas en varias líneas) y se conserva el resto (alcance, condiciones…).
 */
export function withoutRepeatedBody(body: string | null | undefined, lineDescriptions: string[]) {
  const text = cleanBodyText(body)
  if (!text) return null
  const concepts = lineDescriptions.map(comparableText).filter(Boolean)
  if (!concepts.length) return text
  const all = concepts.join(' ')
  // Todo el cuerpo junto ya es un concepto (o varios seguidos)
  const whole = comparableText(text.replace(/^#+\s*/gm, ''))
  if (!whole || all.includes(whole)) return null
  const kept = text.split('\n').filter((l) => {
    const c = comparableText(l.replace(/^(#+|-|\d+\.)\s*/, ''))
    // Un título corto («## Diseño») ordena lo que sigue aunque su palabra aparezca en un concepto
    if (!c || (/^#/.test(l) && c.split(' ').length < 3)) return true
    return !concepts.some(x => x.includes(c))
  })
  return tidyHeadings(kept)
}

/**
 * Factura «solo descripción»: todo su texto va a la descripción. Lo que la IA puso como concepto se suma
 * al cuerpo si no lo dice ya (sin repetirlo), en el orden del documento.
 */
export function conceptlessBody(body: string | null | undefined, lineDescriptions: string[]) {
  const parts = [cleanBodyText(body) ?? '']
  for (const desc of lineDescriptions.map(x => cleanBodyText(x)).filter((x): x is string => !!x)) {
    if (!comparableText(parts.join(' ')).includes(comparableText(desc))) parts.push(desc)
  }
  return cleanBodyText(parts.filter(Boolean).join('\n'))
}

/**
 * Títulos que no titulan nada: se quita el que se queda sin texto debajo («## Descripción» tras quitar el
 * concepto repetido) y, si todo son varios títulos, eran datos sueltos («## OP: 26 1376») y pasan a texto normal.
 */
function tidyHeadings(lines: string[]) {
  const isHeading = (l: string) => /^#+\s/.test(l)
  const content = lines.filter(l => l.trim())
  if (content.length && content.every(isHeading)) {
    if (content.length > 1) return cleanBodyText(content.map(l => l.replace(/^#+\s*/, '')).join('\n'))
    // Un único título: el asunto del trabajo se queda; una palabra suelta («Descripción») no dice nada
    return comparableText(content[0]!).split(' ').length < 3 ? null : cleanBodyText(content[0])
  }
  const out = lines.filter((l, i) => {
    if (!isHeading(l)) return true
    const next = lines.slice(i + 1).find(x => x.trim())
    return !!next && !isHeading(next)
  })
  return cleanBodyText(out.join('\n'))
}

/**
 * Las líneas valen si reproducen las bases de cada tipo de IVA; si no (o tras corregir importes
 * a mano), se sustituyen por una línea por tipo con el importe exacto del documento.
 */
export function reconcileInvoiceLines(d: ImportInvoiceData): ImportInvoiceData {
  // Sin conceptos: una línea sin texto por tipo de IVA, con la base del documento (editable en la revisión)
  if (d.conceptless) {
    return {
      ...d,
      linesMatch: false,
      lines: d.taxLines.map(t => ({ description: '', sku: null, kind: 'service' as const, quantity: 1, unitPrice: t.base, discountPct: 0, vatRate: t.vatRate, surchargeRate: t.surchargeRate })),
    }
  }
  if (d.lines.some(l => !l.description.trim())) d = { ...d, lines: d.lines.filter(l => l.description.trim()) }
  const fromLines = computeTotals(d.lines.map(l => ({ ...l, irpfApplies: true })), d.irpfRate)
  const match = d.lines.length > 0
    && d.taxLines.every(t => fromLines.groups.some(g => g.vatRate === t.vatRate && Math.abs(g.base - t.base) <= 0.02))
    && fromLines.groups.length === new Set(d.taxLines.map(t => t.vatRate)).size
  if (match) return { ...d, linesMatch: true }
  const first = d.lines[0]?.description.replace(/ \(IVA [\d.,]+ %\)$/, '').split('\n')[0]
  const concept = (d.linesMatch ? first : null) || d.description || first || (d.number ? `Factura ${d.number}` : 'Importe según factura original')
  return {
    ...d,
    linesMatch: false,
    lines: d.taxLines.map(t => ({
      description: d.taxLines.length > 1 ? `${concept} (IVA ${t.vatRate} %)` : concept,
      sku: null, kind: 'service' as const, quantity: 1, unitPrice: t.base, discountPct: 0, vatRate: t.vatRate, surchargeRate: t.surchargeRate,
    })),
  }
}

/** Números citados, sin repetir ni incluir el del propio documento */
export function cleanReferences(refs: string[] | null | undefined, own: string | null) {
  const out = new Map<string, string>()
  for (const r of refs ?? []) {
    const v = r.replace(/\s+/g, ' ').trim().slice(0, 80)
    const key = normalizeDocNumber(v)
    if (key && key !== normalizeDocNumber(own) && /\d/.test(v)) out.set(key, v)
  }
  return [...out.values()].slice(0, 20)
}

/** Nº de documento comparable: mayúsculas y sin espacios, puntos, guiones ni barras */
export const normalizeDocNumber = (n: string | null | undefined) => (n ?? '').toUpperCase().replace(/[\s.\-/_]/g, '')

/** Las partes de un documento que no son la empresa (el cliente o el proveedor) */
export function otherParties(d: Pick<ExtractedDocument, 'issuer' | 'recipient'>, ctx: Pick<ExtractContext, 'company'>) {
  const own = comparableNif(ctx.company.nif)
  const names = [ctx.company.legalName, ctx.company.tradeName].map(comparableName).filter(Boolean)
  const isUs = (p: ExtractedParty) => (!!p.nif && comparableNif(p.nif) === own) || names.includes(comparableName(p.name))
  return [d.issuer, d.recipient]
    .filter((p): p is ExtractedParty => !!p && !!p.name?.trim() && !isUs(p))
    .map(p => ({ name: p.name.replace(/\s+/g, ' ').trim().slice(0, 200), nif: p.nif ? comparableNif(p.nif) || null : null }))
}

/** Carpeta del archivo trimestral que corresponde a un documento que no es factura */
export function vaultFolderFor(type: ExtractedDocument['documentType'], folder?: FolderKind | null) {
  // La carpeta del usuario manda si es de archivo (Nóminas, Bancos, Impuestos, Seguros, Legal)
  const fromFolder = folder ? FOLDER_VAULT[folder] : undefined
  if (fromFolder && (type === 'other' || FOLDER_KIND_TYPES[folder!].includes(type))) return fromFolder
  if (type === 'tax_form') return 'impuestos'
  if (type === 'bank_statement') return 'banco'
  if (type === 'contract') return 'legal'
  if (type === 'payroll') return 'nominas'
  return 'otros'
}

/** 1.234,56 € en texto, para avisos generados en el servidor */
export function eurText(n: number) {
  return `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }).format(n)} €`
}

// ─── Carpetas ↔ tipos de documento ───────────────────────────────────────────

const FOLDER_KIND_TEXT: Readonly<Record<FolderKind, string>> = Object.freeze({
  invoice: 'facturas',
  credit_note: 'facturas rectificativas o abonos',
  ticket: 'tickets o recibos',
  quote: 'presupuestos',
  proforma: 'facturas proforma',
  purchase_order: 'pedidos u órdenes de compra',
  delivery_note: 'albaranes',
  payroll: 'nóminas y seguros sociales',
  bank_statement: 'extractos bancarios',
  contract: 'contratos y documentos legales',
  tax: 'modelos e impuestos de Hacienda',
  insurance: 'seguros',
})

/** Lo que cabe esperar en cada clase de carpeta */
const FOLDER_KIND_TYPES: Readonly<Record<FolderKind, ExtractedDocType[]>> = Object.freeze({
  invoice: ['invoice', 'simplified_invoice', 'credit_note', 'receipt'],
  credit_note: ['credit_note'],
  ticket: ['receipt', 'simplified_invoice', 'invoice'],
  quote: ['quote', 'proforma'],
  proforma: ['proforma', 'quote'],
  purchase_order: ['purchase_order'],
  delivery_note: ['delivery_note'],
  payroll: ['payroll', 'tax_form'],
  bank_statement: ['bank_statement'],
  contract: ['contract'],
  tax: ['tax_form'],
  insurance: ['contract', 'receipt', 'invoice', 'simplified_invoice'],
})

/** Carpetas que dan el tipo cuando la IA no lo sabe (solo documentos que van al archivo, sin importes que leer) */
const FOLDER_KIND_ADOPT: Readonly<Partial<Record<FolderKind, ExtractedDocType>>> = Object.freeze({
  purchase_order: 'purchase_order',
  delivery_note: 'delivery_note',
  payroll: 'payroll',
  bank_statement: 'bank_statement',
  contract: 'contract',
  tax: 'tax_form',
})

/** Clases de carpeta en las que "ventas" o "compras" dice quién emite */
const FOLDER_SIDED: ReadonlyArray<FolderKind> = Object.freeze(['invoice', 'credit_note', 'ticket', 'quote', 'proforma', 'purchase_order', 'delivery_note'])

/** Carpeta del archivo trimestral que corresponde a cada clase de carpeta del usuario */
const FOLDER_VAULT: Readonly<Partial<Record<FolderKind, string>>> = Object.freeze({
  payroll: 'nominas',
  bank_statement: 'banco',
  contract: 'legal',
  tax: 'impuestos',
  insurance: 'seguros',
})
