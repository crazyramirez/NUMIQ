/** Nombre de cada tipo de documento que lee la IA, para listados y avisos ("La factura cita el pedido 45001") */

export function docTypeLabel(type: string | null | undefined) {
  return DOC_TYPES[type ?? '']?.label ?? 'Documento'
}

/** Con artículo y en minúscula: "el pedido", "la proforma" */
export function docTypeNoun(type: string | null | undefined) {
  return DOC_TYPES[type ?? '']?.noun ?? 'el documento'
}

const DOC_TYPES: Record<string, { label: string, noun: string }> = {
  invoice: { label: 'Factura', noun: 'la factura' },
  simplified_invoice: { label: 'Factura simplificada', noun: 'la factura simplificada' },
  credit_note: { label: 'Rectificativa', noun: 'la rectificativa' },
  quote: { label: 'Presupuesto', noun: 'el presupuesto' },
  proforma: { label: 'Proforma', noun: 'la proforma' },
  purchase_order: { label: 'Orden de pedido', noun: 'el pedido' },
  delivery_note: { label: 'Albarán', noun: 'el albarán' },
  receipt: { label: 'Recibo', noun: 'el recibo' },
  payroll: { label: 'Nómina', noun: 'la nómina' },
  bank_statement: { label: 'Extracto bancario', noun: 'el extracto' },
  contract: { label: 'Contrato', noun: 'el contrato' },
  tax_form: { label: 'Modelo de Hacienda', noun: 'el modelo' },
  other: { label: 'Documento', noun: 'el documento' },
}
