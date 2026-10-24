import { z } from 'zod'

/** Validación de lo que el usuario corrige al revisar una importación */

const text = (max: number) => z.string().trim().max(max).nullish().transform(v => v || null)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha con formato AAAA-MM-DD')
const amount = z.number().finite().min(-99999999).max(99999999)

export const importPartySchema = z.object({
  name: z.string().trim().min(1, 'Escribe el nombre').max(200),
  nif: text(20).transform(v => (v ? normalizeNif(v) : null)),
  address: text(255),
  postalCode: text(10),
  city: text(120),
  province: text(120),
  country: z.string().trim().length(2).toUpperCase().default('ES'),
  email: optionalEmailField(),
  phone: text(40),
  isPerson: z.boolean().default(false),
})

export const importInvoiceSchema = z.object({
  vatCalculation: text(500),
  dateFallback: z.object({ date: isoDate, source: z.enum(['created', 'modified', 'uploaded']) }).nullish(),
  docType: z.enum(['invoice', 'simplified', 'credit_note', 'ticket', 'quote', 'proforma']).default('invoice'),
  party: importPartySchema.nullable(),
  number: text(40),
  issueDate: isoDate.nullable(),
  dueDate: isoDate.nullish().transform(v => v ?? null),
  lines: z.array(z.object({
    description: z.string().trim().min(1, 'Describe el concepto').max(2000),
    sku: text(60),
    kind: z.enum(['service', 'product']).default('service'),
    quantity: z.number().finite().min(-999999).max(999999),
    unitPrice: amount,
    discountPct: z.number().min(0).max(100).default(0),
    vatRate: z.number().min(0).max(100),
    surchargeRate: z.number().min(0).max(100).default(0),
  })).max(500),
  linesMatch: z.boolean().default(false),
  taxLines: z.array(z.object({
    base: amount,
    vatRate: z.number().min(0).max(100),
    vatAmount: amount,
    surchargeRate: z.number().min(0).max(100).default(0),
    surchargeAmount: amount.default(0),
  })).min(1, 'Indica al menos una base imponible').max(10),
  irpfRate: z.number().min(0).max(100).default(0),
  irpfAmount: amount.default(0),
  total: amount,
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform(v => v.toUpperCase()).nullish(),
  paymentMethod: z.enum(['transfer', 'card', 'cash', 'direct_debit', 'bizum', 'other']).nullish().transform(v => v ?? null),
  paid: z.boolean().nullable().default(null),
  rectifiedNumber: text(60),
  customerReference: text(80),
  references: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  link: z.object({ itemId: z.number().int().positive().nullable(), reason: z.string().max(200).nullable(), manual: z.boolean() }).nullish(),
  categoryId: z.number().int().positive().nullish().transform(v => v ?? null),
  description: text(255),
  bodyText: text(8000),
  allowDuplicate: z.boolean().optional(),
})

export const importContactSchema = z.object({
  party: importPartySchema,
  isClient: z.boolean(),
  isSupplier: z.boolean(),
})

export const importCatalogSchema = z.object({
  name: z.string().trim().min(1, 'Escribe un nombre').max(200),
  sku: text(60),
  kind: z.enum(['service', 'product']),
  unitPrice: z.number().finite().min(0),
  vatRate: z.number().min(0).max(100),
  description: text(2000),
})

export const importVaultSchema = z.object({
  folder: z.string().trim().min(1).max(60),
  year: z.number().int().min(1990).max(2100),
  quarter: z.number().int().min(1).max(4),
  docType: z.enum(['invoice', 'simplified_invoice', 'credit_note', 'quote', 'proforma', 'purchase_order', 'delivery_note', 'receipt', 'payroll', 'bank_statement', 'contract', 'tax_form', 'other']).default('other'),
  summary: text(255),
})
