/**
 * Diseño de las facturas: estructura, color, tipografía y contenidos opcionales. Lo usan la vista
 * en pantalla (hoja HTML) y el PDF del servidor, para que se parezcan lo máximo posible.
 */

export type DesignLayout = 'modern' | 'classic' | 'minimal' | 'bold'
export type DesignFont = 'Inter' | 'Lora' | 'Manrope'
/** Tamaño de letra y espaciado: `compact` mete más contenido en cada página */
export type DesignDensity = 'normal' | 'compact'
/**
 * Tabla de conceptos: `auto` solo enseña lo que aporta (cantidad y precio si alguna cantidad no es 1,
 * IVA si hay varios tipos), `full` todas las columnas, `amount` concepto e importe y `concept` solo el concepto
 * (los importes quedan en el cuadro de totales).
 */
export type LineColumnsMode = 'auto' | 'full' | 'amount' | 'concept'
export const LINE_COLUMNS_MODES: LineColumnsMode[] = ['auto', 'full', 'amount', 'concept']
export type SignatureImageSize = 'sm' | 'md' | 'lg'
export type DocPaymentMethod = 'transfer' | 'card' | 'cash' | 'direct_debit' | 'bizum' | 'other'
export const DOC_PAYMENT_METHODS = Object.freeze(['transfer', 'card', 'cash', 'direct_debit', 'bizum', 'other'] as const)

export interface InvoiceDesign {
  layout: DesignLayout
  accentColor: string
  font: DesignFont
  density: DesignDensity
  showLogo: boolean
  /** Columna de descuento: solo si alguna línea lo lleva, o siempre */
  discountColumn: 'auto' | 'always'
  /** Columnas de la tabla de conceptos (ver `lineColumns`) */
  lineColumns: LineColumnsMode
  /** Referencia (SKU) de los productos del catálogo */
  showItemCodes: boolean
  /** IBAN y forma de pago al pie */
  showPaymentInfo: boolean
  /** Texto de pago (p. ej. "Pago a 30 días mediante transferencia"), puede tener varias líneas */
  paymentText: string
  /** Forma de pago con la que empiezan las facturas nuevas (null: sin forma de pago en el documento) */
  paymentMethod: DocPaymentMethod | null
  /** Forma de pago con la que empiezan los presupuestos nuevos (null: sin forma de pago) */
  quotePaymentMethod: DocPaymentMethod | null
  /** Las facturas nuevas llevan fecha de vencimiento */
  showDueDate: boolean
  /** Los presupuestos nuevos llevan «Válido hasta» */
  quoteShowDueDate: boolean
  /** Etiqueta que encabeza la referencia del cliente o número de pedido (por defecto "Orden de Pedido") */
  customerReferenceLabel: string
  /** Título del bloque de observaciones de las facturas (vacío: sin título) */
  notesLabel: string
  /** Título del bloque de condiciones de los presupuestos (vacío: sin título) */
  termsLabel: string
  /** Observaciones con las que empiezan las facturas nuevas */
  defaultNotes: string
  /** Condiciones con las que empiezan los presupuestos nuevos */
  defaultTerms: string
  /** Asunto por defecto al enviar una factura por email */
  defaultEmailSubject: string
  /** Mensaje por defecto al enviar una factura por email */
  defaultEmailMessage: string
  /** Asunto por defecto al enviar un presupuesto por email */
  defaultEmailSubjectQuote: string
  /** Mensaje por defecto al enviar un presupuesto por email */
  defaultEmailMessageQuote: string
  /** Firma al pie de los correos a clientes, con formato y campos de la empresa ({web}, {telefono}…) */
  emailSignature: RichDoc | null
  /** Tamaño de la imagen de la firma */
  emailSignatureImageSize: SignatureImageSize
  /** Imagen de la firma debajo del texto o a su izquierda */
  emailSignatureImageLayout: 'below' | 'left'
  /** Pie legal: registro mercantil, protección de datos… */
  footerText: string
}

export function defaultDesign(accentColor?: string | null): InvoiceDesign {
  return {
    layout: 'modern',
    accentColor: accentColor && /^#[0-9a-f]{6}$/i.test(accentColor) ? accentColor : '#4f46e5',
    font: 'Inter',
    density: 'normal',
    showLogo: true,
    discountColumn: 'auto',
    lineColumns: 'auto',
    showItemCodes: false,
    showPaymentInfo: true,
    paymentText: '',
    paymentMethod: 'transfer',
    quotePaymentMethod: 'transfer',
    showDueDate: true,
    quoteShowDueDate: true,
    customerReferenceLabel: 'Orden de Pedido',
    notesLabel: 'Observaciones',
    termsLabel: 'Condiciones',
    defaultNotes: '',
    defaultTerms: 'Presupuesto válido durante 30 días desde su fecha. Precios sin IVA salvo indicación.',
    defaultEmailSubject: 'Factura {numero} · {empresa}',
    // Sin importe (va en el PDF) ni despedida: la firma del correo cierra el mensaje
    defaultEmailMessage: 'Hola, {cliente}:\n\nTe enviamos la factura {numero}, con vencimiento el {vencimiento}.\n\nGracias por tu confianza.',
    defaultEmailSubjectQuote: 'Presupuesto {numero} · {empresa}',
    defaultEmailMessageQuote: 'Hola, {cliente}:\n\nTe enviamos el presupuesto {numero}.\n\nQuedamos a tu disposición para cualquier duda o ajuste.',
    emailSignature: null,
    emailSignatureImageSize: 'md',
    emailSignatureImageLayout: 'below',
    footerText: '',
  }
}

// Plantillas por defecto de antes (con sintaxis de código, con el importe y «Un saludo»): si siguen tal cual o
// vacías, pasan a las nuevas. Las que el usuario cambió se respetan
const LEGACY_EMAIL_MESSAGES = Object.freeze([
  'Hola{cliente ? `, ${cliente}` : \'\'}:\n\nTe enviamos la factura {numero} por importe de {importe}{vencimiento ? `, con vencimiento el ${vencimiento}` : \'\'}.\n\nGracias por tu confianza.\n\nUn saludo,\n{empresa}',
  'Hola, {cliente}:\n\nTe enviamos la factura {numero} por importe de {importe}, con vencimiento el {vencimiento}.\n\nGracias por tu confianza.\n\nUn saludo,\n{empresa}',
])
const LEGACY_EMAIL_MESSAGES_QUOTE = Object.freeze([
  'Hola{cliente ? `, ${cliente}` : \'\'}:\n\nTe enviamos el presupuesto {numero} por {importe}.\n\nQuedamos a tu disposición para cualquier duda o ajuste.\n\nUn saludo,\n{empresa}',
  'Hola, {cliente}:\n\nTe enviamos el presupuesto {numero} por {importe}.\n\nQuedamos a tu disposición para cualquier duda o ajuste.\n\nUn saludo,\n{empresa}',
])
const upgrade = (v: string | undefined, legacy: readonly string[], current: string) => (!v?.trim() || legacy.includes(v) ? current : v)

/** Mezcla lo guardado con los valores por defecto (campos nuevos, datos antiguos) */
export function normalizeDesign(raw: Partial<InvoiceDesign> | null | undefined, accentColor?: string | null): InvoiceDesign {
  const d = defaultDesign(accentColor)
  if (!raw) return d
  return {
    layout: (['modern', 'classic', 'minimal', 'bold'] as const).includes(raw.layout as DesignLayout) ? raw.layout as DesignLayout : d.layout,
    accentColor: raw.accentColor && /^#[0-9a-f]{6}$/i.test(raw.accentColor) ? raw.accentColor : d.accentColor,
    font: (['Inter', 'Lora', 'Manrope'] as const).includes(raw.font as DesignFont) ? raw.font as DesignFont : d.font,
    density: raw.density === 'compact' ? 'compact' : 'normal',
    showLogo: raw.showLogo ?? d.showLogo,
    discountColumn: raw.discountColumn === 'always' ? 'always' : 'auto',
    lineColumns: LINE_COLUMNS_MODES.includes(raw.lineColumns as LineColumnsMode) ? raw.lineColumns as LineColumnsMode : d.lineColumns,
    showItemCodes: raw.showItemCodes ?? d.showItemCodes,
    showPaymentInfo: raw.showPaymentInfo ?? d.showPaymentInfo,
    paymentText: (raw.paymentText ?? '').slice(0, 500),
    // null es intencionado (quitada del documento); solo falta en diseños guardados antes de existir
    paymentMethod: paymentPref(raw.paymentMethod, d.paymentMethod),
    quotePaymentMethod: paymentPref(raw.quotePaymentMethod, d.quotePaymentMethod),
    showDueDate: raw.showDueDate ?? d.showDueDate,
    quoteShowDueDate: raw.quoteShowDueDate ?? d.quoteShowDueDate,
    customerReferenceLabel: (raw.customerReferenceLabel ?? d.customerReferenceLabel).slice(0, 40),
    // Un título vacío es intencionado (sin título); solo falta en diseños guardados antes de existir
    notesLabel: (raw.notesLabel ?? d.notesLabel).slice(0, 40),
    termsLabel: (raw.termsLabel ?? d.termsLabel).slice(0, 40),
    defaultNotes: (raw.defaultNotes ?? d.defaultNotes).slice(0, 1000),
    defaultTerms: (raw.defaultTerms ?? d.defaultTerms).slice(0, 1000),
    defaultEmailSubject: (raw.defaultEmailSubject ?? d.defaultEmailSubject).slice(0, 200),
    defaultEmailMessage: upgrade(raw.defaultEmailMessage, LEGACY_EMAIL_MESSAGES, d.defaultEmailMessage).slice(0, 3000),
    defaultEmailSubjectQuote: (raw.defaultEmailSubjectQuote ?? d.defaultEmailSubjectQuote).slice(0, 200),
    defaultEmailMessageQuote: upgrade(raw.defaultEmailMessageQuote, LEGACY_EMAIL_MESSAGES_QUOTE, d.defaultEmailMessageQuote).slice(0, 3000),
    emailSignature: signatureDoc(raw.emailSignature),
    emailSignatureImageSize: (['sm', 'md', 'lg'] as const).includes(raw.emailSignatureImageSize as SignatureImageSize) ? raw.emailSignatureImageSize as SignatureImageSize : d.emailSignatureImageSize,
    emailSignatureImageLayout: raw.emailSignatureImageLayout === 'left' ? 'left' : 'below',
    footerText: (raw.footerText ?? '').slice(0, 600),
  }
}

function paymentPref(v: unknown, fallback: DocPaymentMethod | null): DocPaymentMethod | null {
  if (v === null) return null
  return DOC_PAYMENT_METHODS.includes(v as DocPaymentMethod) ? v as DocPaymentMethod : fallback
}

/** Campos de la empresa que admite la firma de los correos */
export function signatureTokens(c: { legalName: string, tradeName?: string | null, nif: string, email?: string | null, phone?: string | null, website?: string | null, address?: string | null, postalCode?: string | null, city?: string | null }): Record<string, string> {
  const place = [c.postalCode, c.city].filter(Boolean).join(' ')
  return {
    empresa: c.tradeName || c.legalName,
    razon_social: c.legalName,
    nif: c.nif,
    email: c.email ?? '',
    telefono: c.phone ?? '',
    web: (c.website ?? '').replace(/^https?:\/\//i, '').replace(/\/+$/, ''),
    direccion: [c.address, place].filter(Boolean).join(', '),
  }
}

/** Firma guardada como documento con formato (las primeras se guardaron como texto: cada línea, un párrafo) */
function signatureDoc(raw: unknown): RichDoc | null {
  if (typeof raw === 'string') return normalizeRich(raw.slice(0, 1000).split(/\r?\n/).map(t => ({ k: 'p' as const, c: [{ t }] })))
  return Array.isArray(raw) ? normalizeRich(raw as RichDoc) : null
}

/** Firma con sus campos rellenos; una línea cuyos campos están todos vacíos («Tel. {telefono}») desaparece */
export function renderSignature(doc: RichDoc | null | undefined, tokens: Record<string, string>): RichDoc | null {
  if (!doc) return null
  const line = (spans: RichSpan[]): RichSpan[] | null => {
    const keys = [...spansText(spans).matchAll(/\{(\w+)\}/g)].map(m => m[1]!).filter(k => k in tokens)
    if (keys.length && keys.every(k => !tokens[k])) return null
    const out = mergeSpans(spans.map(s => ({ ...s, t: renderEmailTemplate(s.t, tokens) })))
    if (!keys.length) return out
    // «{empresa} · {web}» sin web: fuera el separador que queda colgando
    const sep = /[\s·•|,/–-]+/
    while (out.length && !out[0]!.t.replace(new RegExp(`^${sep.source}`), '')) out.shift()
    while (out.length && !out.at(-1)!.t.replace(new RegExp(`${sep.source}$`), '')) out.pop()
    if (out.length) {
      out[0] = { ...out[0]!, t: out[0]!.t.replace(new RegExp(`^${sep.source}`), '') }
      out[out.length - 1] = { ...out.at(-1)!, t: out.at(-1)!.t.replace(new RegExp(`${sep.source}$`), '') }
    }
    return out
  }
  const out: RichDoc = []
  for (const b of doc) {
    if ('c' in b) {
      const c = line(b.c)
      if (c) out.push({ k: b.k, c })
    }
    else {
      const items = b.items.map(line).filter((it): it is RichSpan[] => !!it)
      if (items.length) out.push({ k: b.k, items })
    }
  }
  return normalizeRich(out)
}

/**
 * Reemplaza variables en plantillas de correo como {cliente}, {numero}, {importe}, etc.
 * Si una variable está vacía se lleva con ella su inciso: «Hola {cliente}:» → «Hola:» y
 * «…de {importe}, con vencimiento el {vencimiento}.» → «…de {importe}.»
 */
export function renderEmailTemplate(template: string, vars: Record<string, string>): string {
  if (!template) return ''
  let res = template
  // Condicionales de las plantillas antiguas: {cliente ? `, ${cliente}` : ''} (comillas ``, '' o "")
  res = res.replace(/\{(\w+)\s*\?\s*(['"`])([^'"`]*)\2\s*:\s*(['"`])([^'"`]*)\4\}/g, (_, k: string, _q1, ifTrue: string, _q2, ifFalse: string) =>
    vars[k] ? ifTrue.replace(/\$\{(\w+)\}/g, (m, v: string) => vars[v] ?? m) : ifFalse)
  for (const [k, v] of Object.entries(vars)) {
    if (v) continue
    res = res.replace(new RegExp(`,[^,.:;\\n{}]*\\{${k}\\}`, 'g'), '').replace(new RegExp(`[ \\t]*\\{${k}\\}`, 'g'), '')
  }
  // Tokens directos {cliente}, {numero}, {importe}, {vencimiento}, {empresa}, {tipo}
  res = res.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m)
  return res
}

const SALES_LABELS: Record<string, string> = { invoice: 'factura', rectifying: 'factura rectificativa', quote: 'presupuesto', proforma: 'proforma' }

/**
 * Asunto y mensaje por defecto al enviar una factura o presupuesto (ventana Enviar, facturas recurrentes,
 * asistente): las plantillas de Ajustes › Diseño de factura con los datos del documento. Sin despedida:
 * el correo lo cierra la firma (la de Ajustes o, si no hay, «Un saludo» con el nombre de la empresa).
 * Importes y fechas llegan ya escritos (cada lado los formatea a su manera).
 */
export function salesEmailDraft(
  design: Pick<InvoiceDesign, 'defaultEmailSubject' | 'defaultEmailMessage' | 'defaultEmailSubjectQuote' | 'defaultEmailMessageQuote'>,
  o: { kind: string, number: string | null, brand: string, firstName: string, client: string, amount: string, pending: string, due: string, reminder?: boolean, internal?: boolean, draft?: boolean },
): { subject: string, message: string } {
  const isQuote = o.kind === 'quote' || o.kind === 'proforma'
  const label = SALES_LABELS[o.kind] ?? 'documento'
  const Label = label.charAt(0).toUpperCase() + label.slice(1)
  const n = o.number ?? ''
  const hello = `Hola${o.firstName ? `, ${o.firstName}` : ''}:`
  // Copia para la propia empresa: con el importe, para revisarla de un vistazo
  if (o.internal) {
    const what = o.draft ? `${label} en borrador` : `${label} ${n}`
    return {
      subject: `${o.draft ? 'Borrador para revisar' : 'Copia'} · ${Label}${n ? ` ${n}` : ''}${o.client ? ` · ${o.client}` : ''}`,
      message: `Hola:\n\nTe adjunto la ${what}${o.client ? ` para ${o.client}` : ''} por importe de ${o.amount}${o.due ? ` (${isQuote ? 'válido hasta' : 'vence'} el ${o.due})` : ''}${o.draft ? ', para que la revises antes de emitirla. No se ha enviado al cliente' : ''}.`,
    }
  }
  if (o.reminder) {
    return {
      subject: `Recordatorio de pago · factura ${n}`,
      message: `${hello}\n\nTe escribimos para recordarte que la factura ${n} tiene ${o.pending} pendientes de pago${o.due ? ` desde el ${o.due}` : ''}.\n\nSi ya la has abonado, ignora este mensaje. Te adjuntamos de nuevo la factura por si la necesitas.`,
    }
  }
  const d = defaultDesign()
  const tokens: Record<string, string> = { cliente: o.firstName || o.client, numero: n, importe: o.amount, vencimiento: o.due, empresa: o.brand, tipo: label }
  const subjectTpl = (isQuote ? design.defaultEmailSubjectQuote : design.defaultEmailSubject) || (isQuote ? d.defaultEmailSubjectQuote : d.defaultEmailSubject)
  const messageTpl = (isQuote ? design.defaultEmailMessageQuote : design.defaultEmailMessage) || (isQuote ? d.defaultEmailMessageQuote : d.defaultEmailMessage)
  return { subject: renderEmailTemplate(subjectTpl, tokens), message: renderEmailTemplate(messageTpl, tokens) }
}

/** Color de texto legible sobre un fondo (blanco o tinta) según su luminancia */
export function onColor(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.4 ? '#11141b' : '#ffffff'
}

/** Mezcla un color con blanco (0 = color, 1 = blanco): fondos suaves del acento */
export function tint(hex: string, amount: number) {
  const n = Number.parseInt(hex.slice(1), 16)
  const mix = (c: number) => Math.round(c + (255 - c) * amount).toString(16).padStart(2, '0')
  return `#${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`
}

/** Qué columnas lleva la tabla de conceptos de un documento con este diseño */
export function lineColumns(design: Pick<InvoiceDesign, 'lineColumns' | 'discountColumn'>, lines: ReadonlyArray<{ quantity: number, discountPct: number, vatRate: number }>) {
  const mode = design.lineColumns ?? 'auto'
  const anyDiscount = lines.some(l => l.discountPct > 0)
  if (mode === 'concept') return { quantity: false, price: false, discount: false, vat: false, amount: false }
  if (mode === 'amount') return { quantity: false, price: false, discount: false, vat: false, amount: true }
  const discount = design.discountColumn === 'always' || anyDiscount
  if (mode === 'full') return { quantity: true, price: true, discount, vat: true, amount: true }
  const quantity = lines.some(l => l.quantity !== 1)
  return { quantity, price: quantity || discount, discount, vat: new Set(lines.map(l => l.vatRate)).size > 1, amount: true }
}

// Al final del archivo: una constante con literal de objeto oculta al auto-import la exportación siguiente
/** Caja máxima (px) de la imagen de la firma en el correo */
export const SIGNATURE_IMAGE_BOX: Readonly<Record<SignatureImageSize, { w: number, h: number }>> = Object.freeze({ sm: { w: 120, h: 60 }, md: { w: 180, h: 90 }, lg: { w: 260, h: 130 } })
