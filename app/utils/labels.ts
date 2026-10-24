/** Textos y tonos de los estados que se muestran en toda la app */

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'ai'

export const SALES_STATUS: Record<string, { label: string, tone: Tone }> = {
  draft: { label: 'Borrador', tone: 'neutral' },
  issued: { label: 'Emitida', tone: 'brand' },
  sent: { label: 'Enviada', tone: 'info' },
  partial: { label: 'Cobro parcial', tone: 'warning' },
  paid: { label: 'Cobrada', tone: 'success' },
  cancelled: { label: 'Anulada', tone: 'neutral' },
  accepted: { label: 'Aceptado', tone: 'success' },
  rejected: { label: 'Rechazado', tone: 'danger' },
  expired: { label: 'Caducado', tone: 'neutral' },
  invoiced: { label: 'Facturado', tone: 'success' },
}

/** Presupuestos: pendiente, enviado, aceptado o rechazado (sin borrador ni caducidad; facturado cuenta como aceptado) */
export const QUOTE_STATUS: Record<string, { label: string, tone: Tone }> = {
  ...SALES_STATUS,
  issued: { label: 'Pendiente', tone: 'brand' },
  sent: { label: 'Enviado', tone: 'info' },
  invoiced: { label: 'Aceptado', tone: 'success' },
  expired: { label: 'Rechazado', tone: 'danger' },
}

/** Estados que se pueden elegir a mano en un presupuesto */
export const QUOTE_STATUS_OPTIONS = [
  { value: 'issued', label: 'Pendiente', icon: 'ph:clock' },
  { value: 'sent', label: 'Enviado', icon: 'ph:paper-plane-tilt' },
  { value: 'accepted', label: 'Aceptado', icon: 'ph:thumbs-up' },
  { value: 'rejected', label: 'Rechazado', icon: 'ph:thumbs-down' },
] as const

export const salesStatus = (kind: string, status: string, overdue = false) => {
  const quote = kind === 'quote' || kind === 'proforma'
  // Solo las facturas vencen: un presupuesto pasado de validez sigue con su estado
  if (overdue && !quote) return { label: 'Vencida', tone: 'danger' as Tone }
  return (quote ? QUOTE_STATUS : SALES_STATUS)[status] ?? { label: status, tone: 'neutral' as Tone }
}

export const KIND_LABEL: Record<string, string> = {
  invoice: 'Factura',
  rectifying: 'Factura rectificativa',
  quote: 'Presupuesto',
  proforma: 'Proforma',
}

export const PAYMENT_METHODS: Record<string, string> = {
  transfer: 'Transferencia',
  card: 'Tarjeta',
  cash: 'Efectivo',
  direct_debit: 'Domiciliación',
  bizum: 'Bizum',
  other: 'Otro',
}

export const EXPENSE_KIND: Record<string, string> = {
  invoice: 'Factura',
  ticket: 'Ticket',
  payroll: 'Nómina',
  social_security: 'Seguridad Social',
  tax: 'Impuesto',
  other: 'Otro',
}

export const TAX_REGIMES: Record<string, { label: string, hint: string }> = {
  directa_simplificada: { label: 'Estimación directa simplificada', hint: 'La más común entre autónomos (facturación < 600.000 €)' },
  directa_normal: { label: 'Estimación directa normal', hint: 'Obligatoria por encima de 600.000 € o si renuncias a la simplificada' },
  modulos: { label: 'Estimación objetiva (módulos)', hint: 'Tributas por índices de la actividad, no por beneficio real' },
  sociedades: { label: 'Impuesto sobre Sociedades', hint: 'Sociedades limitadas y anónimas' },
}

export const VAT_REGIMES: Record<string, { label: string, hint: string }> = {
  general: { label: 'Régimen general', hint: 'Repercutes IVA en tus facturas y lo declaras cada trimestre' },
  recargo_equivalencia: { label: 'Recargo de equivalencia', hint: 'Comercio minorista: tu proveedor te cobra el recargo y no presentas 303' },
  criterio_caja: { label: 'Criterio de caja', hint: 'Declaras el IVA cuando cobras o pagas, no al facturar' },
  exento: { label: 'Exento de IVA', hint: 'Actividades exentas (formación reglada, sanidad…)' },
}
