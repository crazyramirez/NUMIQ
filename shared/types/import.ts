/**
 * Importación con IA: lo que la IA lee de un documento y el registro normalizado que se revisa
 * antes de crear facturas, gastos, contactos o productos.
 */

export type ImportDirection = 'issued' | 'received'

export type ExtractedDocType = 'invoice' | 'simplified_invoice' | 'credit_note' | 'quote' | 'proforma' | 'purchase_order' | 'delivery_note' | 'receipt' | 'payroll' | 'bank_statement' | 'contract' | 'tax_form' | 'other'

export interface ExtractedParty {
  name: string
  nif: string | null
  address: string | null
  postalCode: string | null
  city: string | null
  province: string | null
  country: string | null
  email: string | null
  phone: string | null
  isPerson: boolean
}

export interface ExtractedLine {
  description: string
  sku: string | null
  kind: 'service' | 'product'
  quantity: number
  unitPrice: number
  discountPct: number
  vatRate: number | null
  amount: number
}

export interface ExtractedTaxLine {
  base: number
  vatRate: number
  vatAmount: number
  surchargeRate: number
  surchargeAmount: number
}

/** Un documento leído por la IA (un archivo puede traer varios: PDF con varias facturas) */
export interface ExtractedDocument {
  documentType: ExtractedDocType
  /** Identidad del pie y beneficiario del cobro; la cuenta puede pertenecer al pagador (ibanRole). */
  footerName?: string | null
  footerParty?: ExtractedParty | null
  payeeName?: string | null
  /** Por qué la IA cree que el emisor es quien es (logotipo, pie, cuenta de cobro…); las lecturas antiguas no lo traen */
  roleEvidence?: string
  issuer: ExtractedParty | null
  recipient: ExtractedParty | null
  number: string | null
  issueDate: string | null
  dueDate: string | null
  currency: string
  lines: ExtractedLine[]
  taxLines: ExtractedTaxLine[]
  irpfRate: number | null
  irpfAmount: number | null
  total: number | null
  paymentMethod: 'transfer' | 'card' | 'cash' | 'direct_debit' | 'bizum' | 'other' | null
  iban: string | null
  /** La cuenta es de quien cobra o de quien paga; unknown si el documento no lo aclara. */
  ibanRole?: 'payee' | 'payer' | 'unknown'
  /** Texto de precios de presupuestos: «1.000 € + IVA» no es un total con impuestos. */
  vatPresentation?: { mode: 'excluded' | 'included' | 'exempt' | 'unknown', rate: number | null, amount: number | null, evidence: string | null }
  paid: boolean | null
  rectifiedNumber: string | null
  customerReference: string | null
  /** Números de otros documentos que cita: pedido, albarán, presupuesto, contrato… (las lecturas antiguas no lo traen) */
  references?: string[]
  category: string | null
  summary: string | null
  /** Texto descriptivo del cuerpo (asunto, alcance, condiciones…) con marcas sencillas; las lecturas antiguas no lo traen */
  bodyText?: string | null
  confidence: number
  warnings: string[]
}

export type ImportItemType = 'sales' | 'expense' | 'contact' | 'item' | 'vault'
export type ImportItemStatus = 'ready' | 'warning' | 'duplicate' | 'error' | 'imported' | 'excluded'

export interface ImportParty {
  name: string
  nif: string | null
  address: string | null
  postalCode: string | null
  city: string | null
  province: string | null
  country: string
  email: string | null
  phone: string | null
  isPerson: boolean
}

export interface ImportLine {
  description: string
  sku: string | null
  kind: 'service' | 'product'
  quantity: number
  unitPrice: number
  discountPct: number
  vatRate: number
  surchargeRate: number
}

export interface ImportTaxLine {
  base: number
  vatRate: number
  vatAmount: number
  surchargeRate: number
  surchargeAmount: number
}

/** Factura emitida o recibida lista para revisar */
export interface ImportInvoiceData {
  vatCalculation?: string | null
  /** Solo cuando la fecha se tomó del archivo por faltar en el documento. */
  dateFallback?: import('../utils/source-date').SourceFileDate | null
  docType: 'invoice' | 'simplified' | 'credit_note' | 'ticket' | 'quote' | 'proforma'
  party: ImportParty | null
  number: string | null
  issueDate: string | null
  dueDate: string | null
  lines: ImportLine[]
  /** Las líneas reproducen los totales del documento (si no, se importan por tipo de IVA) */
  linesMatch: boolean
  taxLines: ImportTaxLine[]
  irpfRate: number
  irpfAmount: number
  total: number
  /** Moneda de los importes (EUR si no consta); un gasto en otra se pasa a euros al importarlo */
  currency?: string | null
  paymentMethod: 'transfer' | 'card' | 'cash' | 'direct_debit' | 'bizum' | 'other' | null
  /** null = no consta (las antiguas se dan por cobradas o pagadas si así se elige al importar) */
  paid: boolean | null
  rectifiedNumber: string | null
  customerReference: string | null
  /** Otros documentos que cita la factura (pedido, albarán…): sirven para encontrarlos en el lote */
  references?: string[]
  /** Presupuesto emitido: su factura del lote (al importar, la factura queda hecha a partir de él) */
  link?: ImportLink | null
  categoryId: number | null
  description: string | null
  /** Texto descriptivo del documento ("## título", "- viñeta"): descripción de la factura emitida o notas del gasto */
  bodyText?: string | null
  /** El usuario confirmó que no es un duplicado: solo se descartan las coincidencias probables, nunca las seguras */
  allowDuplicate?: boolean
}

export interface ImportContactData {
  party: ImportParty
  isClient: boolean
  isSupplier: boolean
}

export interface ImportCatalogData {
  name: string
  sku: string | null
  kind: 'service' | 'product'
  unitPrice: number
  vatRate: number
  description: string | null
}

export interface ImportVaultData {
  folder: string
  year: number
  quarter: number
  docType: ExtractedDocType
  summary: string | null
  /** Lo leído del documento para encontrar la factura a la que acompaña */
  ref?: ImportDocRef | null
  /** Factura emitida del lote a la que se adjuntará en vez de ir al archivo */
  link?: ImportLink | null
}

export interface ImportDocRef {
  number: string | null
  /** Las partes que no son la empresa (cliente o proveedor del documento) */
  parties: Array<{ name: string, nif: string | null }>
  issueDate: string | null
  total: number | null
  references: string[]
}

export interface ImportLink {
  /** Registro de la factura en el lote (null = el usuario eligió no vincularlo) */
  itemId: number | null
  reason: string | null
  /** Elegido a mano: una nueva lectura del lote no lo cambia */
  manual: boolean
}

export interface ImportDuplicate {
  type: 'sales' | 'expense' | 'contact' | 'item' | 'file'
  id: number
  label: string
  /** false: muy probable pero no seguro (fecha cercana, nombre parecido…); se puede guardar igualmente. Sin indicar: seguro */
  certain?: boolean
  /** Gasto registrado sin su documento (p. ej. desde el banco): se le puede adjuntar el escaneado */
  attachable?: boolean
}

/** Lo que se borra al eliminar una importación con todo lo que creó */
export interface ImportUndoSummary {
  invoices: number
  expenses: number
  contacts: number
  items: number
  files: number
  bytes: number
  /** Movimientos del banco conciliados con lo borrado: vuelven a pendientes */
  bank: number
  /** Correos importados que vuelven a la bandeja */
  mails: number
  /** Lo que se conserva: emitidas con rectificativa o VeriFactu, contactos y productos usados en otros documentos */
  kept: { invoices: number, contacts: number, items: number }
  /** Modelos ya presentados del periodo de lo borrado ("303 · 1T 2025") */
  filed: string[]
}

/** Resultado del escaneo rápido de un documento */
export interface ScanReading {
  fileId: number
  fileName: string
  mime: string
  direction: ImportDirection
  type: ImportItemType
  data: ImportInvoiceData | null
  vault: ImportVaultData | null
  contact: { id: number, name: string } | null
  warnings: string[]
  confidence: number | null
  duplicate: ImportDuplicate | null
  documents: number
}
