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
    customerReferenceLabel: 'Orden de Pedido',
    notesLabel: 'Observaciones',
    termsLabel: 'Condiciones',
    defaultNotes: '',
    defaultTerms: 'Presupuesto válido durante 30 días desde su fecha. Precios sin IVA salvo indicación.',
    defaultEmailSubject: 'Factura {numero} · {empresa}',
    defaultEmailMessage: 'Hola, {cliente}:\n\nTe enviamos la factura {numero} por importe de {importe}, con vencimiento el {vencimiento}.\n\nGracias por tu confianza.\n\nUn saludo,\n{empresa}',
    defaultEmailSubjectQuote: 'Presupuesto {numero} · {empresa}',
    defaultEmailMessageQuote: 'Hola, {cliente}:\n\nTe enviamos el presupuesto {numero} por {importe}.\n\nQuedamos a tu disposición para cualquier duda o ajuste.\n\nUn saludo,\n{empresa}',
    footerText: '',
  }
}

// Plantillas por defecto de antes, con sintaxis de código (se veía tal cual en Ajustes): se cambian por las nuevas
const LEGACY_EMAIL_MESSAGE = 'Hola{cliente ? `, ${cliente}` : \'\'}:\n\nTe enviamos la factura {numero} por importe de {importe}{vencimiento ? `, con vencimiento el ${vencimiento}` : \'\'}.\n\nGracias por tu confianza.\n\nUn saludo,\n{empresa}'
const LEGACY_EMAIL_MESSAGE_QUOTE = 'Hola{cliente ? `, ${cliente}` : \'\'}:\n\nTe enviamos el presupuesto {numero} por {importe}.\n\nQuedamos a tu disposición para cualquier duda o ajuste.\n\nUn saludo,\n{empresa}'
const upgrade = (v: string | undefined, legacy: string, current: string) => (v === legacy ? current : v)

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
    customerReferenceLabel: (raw.customerReferenceLabel ?? d.customerReferenceLabel).slice(0, 40),
    // Un título vacío es intencionado (sin título); solo falta en diseños guardados antes de existir
    notesLabel: (raw.notesLabel ?? d.notesLabel).slice(0, 40),
    termsLabel: (raw.termsLabel ?? d.termsLabel).slice(0, 40),
    defaultNotes: (raw.defaultNotes ?? d.defaultNotes).slice(0, 1000),
    defaultTerms: (raw.defaultTerms ?? d.defaultTerms).slice(0, 1000),
    defaultEmailSubject: (raw.defaultEmailSubject ?? d.defaultEmailSubject).slice(0, 200),
    defaultEmailMessage: (upgrade(raw.defaultEmailMessage, LEGACY_EMAIL_MESSAGE, d.defaultEmailMessage) ?? d.defaultEmailMessage).slice(0, 3000),
    defaultEmailSubjectQuote: (raw.defaultEmailSubjectQuote ?? d.defaultEmailSubjectQuote).slice(0, 200),
    defaultEmailMessageQuote: (upgrade(raw.defaultEmailMessageQuote, LEGACY_EMAIL_MESSAGE_QUOTE, d.defaultEmailMessageQuote) ?? d.defaultEmailMessageQuote).slice(0, 3000),
    footerText: (raw.footerText ?? '').slice(0, 600),
  }
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
