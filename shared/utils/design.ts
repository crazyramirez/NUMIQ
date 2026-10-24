/**
 * Diseño de las facturas: estructura, color, tipografía y contenidos opcionales. Lo usan la vista
 * en pantalla (hoja HTML) y el PDF del servidor, para que se parezcan lo máximo posible.
 */

export type DesignLayout = 'modern' | 'classic' | 'minimal' | 'bold'
export type DesignFont = 'Inter' | 'Lora' | 'Manrope'

export interface InvoiceDesign {
  layout: DesignLayout
  accentColor: string
  font: DesignFont
  showLogo: boolean
  /** Columna de descuento: solo si alguna línea lo lleva, o siempre */
  discountColumn: 'auto' | 'always'
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
    showLogo: true,
    discountColumn: 'auto',
    showItemCodes: false,
    showPaymentInfo: true,
    paymentText: '',
    customerReferenceLabel: 'Orden de Pedido',
    notesLabel: 'Observaciones',
    termsLabel: 'Condiciones',
    defaultNotes: '',
    defaultTerms: 'Presupuesto válido durante 30 días desde su fecha. Precios sin IVA salvo indicación.',
    defaultEmailSubject: 'Factura {numero} · {empresa}',
    defaultEmailMessage: 'Hola{cliente ? `, ${cliente}` : \'\'}:\n\nTe enviamos la factura {numero} por importe de {importe}{vencimiento ? `, con vencimiento el ${vencimiento}` : \'\'}.\n\nGracias por tu confianza.\n\nUn saludo,\n{empresa}',
    defaultEmailSubjectQuote: 'Presupuesto {numero} · {empresa}',
    defaultEmailMessageQuote: 'Hola{cliente ? `, ${cliente}` : \'\'}:\n\nTe enviamos el presupuesto {numero} por {importe}.\n\nQuedamos a tu disposición para cualquier duda o ajuste.\n\nUn saludo,\n{empresa}',
    footerText: '',
  }
}

/** Mezcla lo guardado con los valores por defecto (campos nuevos, datos antiguos) */
export function normalizeDesign(raw: Partial<InvoiceDesign> | null | undefined, accentColor?: string | null): InvoiceDesign {
  const d = defaultDesign(accentColor)
  if (!raw) return d
  return {
    layout: (['modern', 'classic', 'minimal', 'bold'] as const).includes(raw.layout as DesignLayout) ? raw.layout as DesignLayout : d.layout,
    accentColor: raw.accentColor && /^#[0-9a-f]{6}$/i.test(raw.accentColor) ? raw.accentColor : d.accentColor,
    font: (['Inter', 'Lora', 'Manrope'] as const).includes(raw.font as DesignFont) ? raw.font as DesignFont : d.font,
    showLogo: raw.showLogo ?? d.showLogo,
    discountColumn: raw.discountColumn === 'always' ? 'always' : 'auto',
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
    defaultEmailMessage: (raw.defaultEmailMessage ?? d.defaultEmailMessage).slice(0, 3000),
    defaultEmailSubjectQuote: (raw.defaultEmailSubjectQuote ?? d.defaultEmailSubjectQuote).slice(0, 200),
    defaultEmailMessageQuote: (raw.defaultEmailMessageQuote ?? d.defaultEmailMessageQuote).slice(0, 3000),
    footerText: (raw.footerText ?? '').slice(0, 600),
  }
}

/** Reemplaza variables en plantillas de correo como {cliente}, {numero}, {importe}, etc. */
export function renderEmailTemplate(template: string, vars: Record<string, string>): string {
  if (!template) return ''
  let res = template
  // Manejo de condicionales ternarios JS simples como {cliente ? `, ${cliente}` : ''}
  res = res.replace(/\{(\w+)\s*\?\s*`([^`]*)`\s*:\s*`([^`]*)`\}/g, (_, k, ifTrue, ifFalse) => {
    return vars[k] ? ifTrue.replace(`\${${k}}`, vars[k]) : ifFalse
  })
  // Manejo de tokens directos {cliente}, {numero}, {importe}, {vencimiento}, {empresa}, {tipo}
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
