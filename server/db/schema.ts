import { sql } from 'drizzle-orm'
import type { AiActionPreview, AiActionResult } from '../../shared/types/assistant'
import type { ExtractedDocument, ImportCatalogData, ImportContactData, ImportDuplicate, ImportInvoiceData, ImportVaultData } from '../../shared/types/import'
import type { RichDoc } from '../../shared/utils/rich'
import type { SourceFileDate } from '../../shared/utils/source-date'
import {
  boolean,
  customType,
  date,
  datetime,
  decimal,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core'

/**
 * JSON guardado como LONGTEXT: compatible con MySQL y MariaDB
 * (MariaDB devuelve JSON como string y rompe el tipo json nativo).
 */
const jsonText = <T>(name: string) =>
  customType<{ data: T, driverData: string | null }>({
    dataType: () => 'longtext',
    toDriver: value => JSON.stringify(value),
    fromDriver: (value) => {
      if (value == null) return null as T
      try {
        return JSON.parse(value) as T
      }
      catch {
        return null as T
      }
    },
  })(name)

/**
 * DEFAULT CURRENT_TIMESTAMP (no `DEFAULT (now())`): funciona en MySQL 5.7, MySQL 8 y MariaDB.
 * Fechas opcionales en DATETIME: TIMESTAMP nulo se comporta mal con explicit_defaults_for_timestamp=OFF.
 */
const now = sql`CURRENT_TIMESTAMP`
const createdAt = () => timestamp('created_at').notNull().default(now)
const updatedAt = () => timestamp('updated_at').notNull().default(now).onUpdateNow()

/** Importes en euros con 2 decimales; como number en JS (los cálculos se redondean en shared/utils/tax.ts) */
const money = (name: string) => decimal(name, { precision: 14, scale: 2, mode: 'number' }).notNull().default(0)
/** Porcentajes (IVA, IRPF, recargo, descuento) */
const pct = (name: string) => decimal(name, { precision: 5, scale: 2, mode: 'number' }).notNull().default(0)
/** Fechas fiscales sin hora ni zona: 'YYYY-MM-DD' */
const day = (name: string) => date(name, { mode: 'string' })

// ─── Usuarios y empresas ─────────────────────────────────────────────────────

export const users = mysqlTable('users', {
  id: int('id').autoincrement().primaryKey(),
  email: varchar('email', { length: 191 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }),
  avatarUrl: varchar('avatar_url', { length: 500 }),
  /** Empresa con la que trabaja ahora (un usuario puede llevar varias: gestor, varios negocios) */
  currentCompanyId: int('current_company_id'),
  emailVerifiedAt: datetime('email_verified_at'),
  lastLoginAt: datetime('last_login_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [uniqueIndex('users_email_uq').on(t.email)])

/** Enlaces de un solo uso: restablecer contraseña y verificar el email (se guarda solo su hash) */
export const userTokens = mysqlTable('user_tokens', {
  id: int('id').autoincrement().primaryKey(),
  userId: int('user_id').notNull(),
  kind: mysqlEnum('kind', ['reset', 'verify']).notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  expiresAt: datetime('expires_at').notNull(),
  usedAt: datetime('used_at'),
  createdAt: createdAt(),
}, t => [uniqueIndex('user_tokens_hash_uq').on(t.tokenHash), index('user_tokens_user_idx').on(t.userId, t.kind)])

/** Llaves de acceso (passkeys): entrar con huella, cara o el PIN del dispositivo */
export const userPasskeys = mysqlTable('user_passkeys', {
  /** Id de la credencial WebAuthn (base64url) */
  id: varchar('id', { length: 255 }).primaryKey(),
  userId: int('user_id').notNull(),
  publicKey: text('public_key').notNull(),
  counter: int('counter').notNull().default(0),
  backedUp: boolean('backed_up').notNull().default(false),
  transports: jsonText<string[]>('transports'),
  /** «iPhone», «Mac», «Android»… para reconocerla en Ajustes */
  name: varchar('name', { length: 80 }),
  createdAt: createdAt(),
  lastUsedAt: datetime('last_used_at'),
}, t => [index('passkeys_user_idx').on(t.userId)])

/** Avisos al móvil o al ordenador (Web Push) de cada usuario y dispositivo */
export const pushSubscriptions = mysqlTable('push_subscriptions', {
  id: int('id').autoincrement().primaryKey(),
  userId: int('user_id').notNull(),
  endpoint: varchar('endpoint', { length: 600 }).notNull(),
  p256dh: varchar('p256dh', { length: 200 }).notNull(),
  auth: varchar('auth', { length: 100 }).notNull(),
  device: varchar('device', { length: 80 }),
  createdAt: createdAt(),
  lastSentAt: datetime('last_sent_at'),
}, t => [uniqueIndex('push_endpoint_uq').on(t.endpoint), index('push_user_idx').on(t.userId)])

export type CompanyKind = 'autonomo' | 'sociedad'
export type TaxRegime = 'directa_simplificada' | 'directa_normal' | 'modulos' | 'sociedades'
export type VatRegime = 'general' | 'recargo_equivalencia' | 'criterio_caja' | 'exento'

export const companies = mysqlTable('companies', {
  id: int('id').autoincrement().primaryKey(),
  kind: mysqlEnum('kind', ['autonomo', 'sociedad']).notNull().default('autonomo'),
  /** Razón social o nombre y apellidos del autónomo */
  legalName: varchar('legal_name', { length: 200 }).notNull(),
  tradeName: varchar('trade_name', { length: 200 }),
  nif: varchar('nif', { length: 20 }).notNull(),
  email: varchar('email', { length: 191 }),
  phone: varchar('phone', { length: 40 }),
  website: varchar('website', { length: 200 }),
  address: varchar('address', { length: 255 }),
  postalCode: varchar('postal_code', { length: 10 }),
  city: varchar('city', { length: 120 }),
  province: varchar('province', { length: 120 }),
  country: varchar('country', { length: 2 }).notNull().default('ES'),
  iban: varchar('iban', { length: 34 }),
  logoPath: varchar('logo_path', { length: 500 }),
  /** Epígrafe IAE / CNAE de la actividad principal */
  activityCode: varchar('activity_code', { length: 20 }),
  activityDescription: varchar('activity_description', { length: 255 }),
  taxRegime: mysqlEnum('tax_regime', ['directa_simplificada', 'directa_normal', 'modulos', 'sociedades']).notNull().default('directa_simplificada'),
  vatRegime: mysqlEnum('vat_regime', ['general', 'recargo_equivalencia', 'criterio_caja', 'exento']).notNull().default('general'),
  /** Retención de IRPF por defecto en sus facturas (15 %, o 7 % los tres primeros años) */
  defaultIrpfRate: pct('default_irpf_rate'),
  defaultVatRate: pct('default_vat_rate'),
  /** Días de vencimiento por defecto de sus facturas */
  paymentTermsDays: smallint('payment_terms_days').notNull().default(30),
  /** Alta en la actividad (para el 7 % de IRPF de nuevos autónomos y la tarifa plana) */
  activityStartDate: day('activity_start_date'),
  verifactuEnabled: boolean('verifactu_enabled').notNull().default(true),
  /** Color de marca para facturas y PDF */
  brandColor: varchar('brand_color', { length: 9 }),
  invoiceFooter: text('invoice_footer'),
  settings: jsonText<Record<string, unknown>>('settings'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [index('companies_nif_idx').on(t.nif)])

export type MemberRole = 'owner' | 'admin' | 'member' | 'advisor'

export const companyMembers = mysqlTable('company_members', {
  companyId: int('company_id').notNull(),
  userId: int('user_id').notNull(),
  /** advisor = gestor/asesor con acceso a impuestos e informes */
  role: mysqlEnum('role', ['owner', 'admin', 'member', 'advisor']).notNull().default('member'),
  createdAt: createdAt(),
}, t => [primaryKey({ columns: [t.companyId, t.userId] }), index('members_user_idx').on(t.userId)])

/** Invitaciones a una empresa (socio, empleado o gestor) */
export const companyInvites = mysqlTable('company_invites', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  email: varchar('email', { length: 191 }).notNull(),
  role: mysqlEnum('role', ['admin', 'member', 'advisor']).notNull().default('member'),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  invitedBy: int('invited_by'),
  expiresAt: datetime('expires_at').notNull(),
  acceptedAt: datetime('accepted_at'),
  acceptedBy: int('accepted_by'),
  lastSentAt: datetime('last_sent_at'),
  createdAt: createdAt(),
}, t => [uniqueIndex('invites_hash_uq').on(t.tokenHash), index('invites_company_idx').on(t.companyId)])

// ─── Contactos (clientes y proveedores) y catálogo ───────────────────────────

export type ContactAddress = { address?: string | null, postalCode?: string | null, city?: string | null, province?: string | null, country?: string | null }

export const contacts = mysqlTable('contacts', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  isClient: boolean('is_client').notNull().default(false),
  isSupplier: boolean('is_supplier').notNull().default(false),
  kind: mysqlEnum('kind', ['company', 'person']).notNull().default('company'),
  name: varchar('name', { length: 200 }).notNull(),
  tradeName: varchar('trade_name', { length: 200 }),
  /** Persona con la que se trata dentro de la empresa */
  contactPerson: varchar('contact_person', { length: 120 }),
  nif: varchar('nif', { length: 20 }),
  /** NIF español, NIF-IVA intracomunitario (VIES), pasaporte u otro documento extranjero */
  nifType: mysqlEnum('nif_type', ['nif', 'vat_eu', 'passport', 'other']).notNull().default('nif'),
  email: varchar('email', { length: 191 }),
  phone: varchar('phone', { length: 40 }),
  website: varchar('website', { length: 200 }),
  address: varchar('address', { length: 255 }),
  postalCode: varchar('postal_code', { length: 10 }),
  city: varchar('city', { length: 120 }),
  province: varchar('province', { length: 120 }),
  country: varchar('country', { length: 2 }).notNull().default('ES'),
  iban: varchar('iban', { length: 34 }),
  paymentTermsDays: smallint('payment_terms_days'),
  /** Retención de IRPF que se le aplica (cliente empresa/profesional) */
  irpfRate: decimal('irpf_rate', { precision: 5, scale: 2, mode: 'number' }),
  /** Cliente en recargo de equivalencia (comercio minorista) */
  equivalenceSurcharge: boolean('equivalence_surcharge').notNull().default(false),
  /** Categoría de gasto por defecto (proveedores) */
  defaultCategoryId: int('default_category_id'),
  notes: text('notes'),
  tags: jsonText<string[]>('tags'),
  /** Logotipo del cliente o proveedor (PNG/JPG reducido en el navegador) */
  logoPath: varchar('logo_path', { length: 500 }),
  /** Ubicación de la dirección para el mapa de la ficha (se calcula una vez por dirección: geo_key) */
  geoLat: decimal('geo_lat', { precision: 9, scale: 6, mode: 'number' }),
  geoLng: decimal('geo_lng', { precision: 9, scale: 6, mode: 'number' }),
  /** exact = portal, street = calle, area = código postal o población, none = no se encontró */
  geoPrecision: mysqlEnum('geo_precision', ['exact', 'street', 'area', 'none']),
  geoKey: varchar('geo_key', { length: 40 }),
  archivedAt: datetime('archived_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [
  index('contacts_company_idx').on(t.companyId, t.isClient, t.isSupplier),
  index('contacts_nif_idx').on(t.companyId, t.nif),
])

export const items = mysqlTable('items', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  kind: mysqlEnum('kind', ['service', 'product']).notNull().default('service'),
  name: varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  sku: varchar('sku', { length: 60 }),
  unit: varchar('unit', { length: 20 }),
  unitPrice: decimal('unit_price', { precision: 14, scale: 4, mode: 'number' }).notNull().default(0),
  vatRate: pct('vat_rate'),
  /** Foto o imagen del producto (PNG/JPG reducido a 800 px en el navegador) */
  imagePath: varchar('image_path', { length: 500 }),
  /** Categoría del catálogo (item_categories), para filtrar y ordenar */
  categoryId: int('category_id'),
  archivedAt: datetime('archived_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [index('items_company_idx').on(t.companyId), index('items_category_idx').on(t.categoryId)])

/** Categorías propias del catálogo de productos y servicios (no contables: solo para clasificar) */
export const itemCategories = mysqlTable('item_categories', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  name: varchar('name', { length: 80 }).notNull(),
  color: varchar('color', { length: 9 }),
  createdAt: createdAt(),
}, t => [index('item_categories_company_idx').on(t.companyId)])

export const categories = mysqlTable('categories', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  kind: mysqlEnum('kind', ['expense', 'income']).notNull().default('expense'),
  name: varchar('name', { length: 120 }).notNull(),
  /** Cuenta del Plan General Contable (621 arrendamientos, 628 suministros…) */
  accountCode: varchar('account_code', { length: 10 }),
  icon: varchar('icon', { length: 60 }),
  color: varchar('color', { length: 9 }),
  /** % deducible por defecto (p. ej. 50 % vehículo mixto) */
  deductiblePct: decimal('deductible_pct', { precision: 5, scale: 2, mode: 'number' }).notNull().default(100),
  createdAt: createdAt(),
}, t => [index('categories_company_idx').on(t.companyId, t.kind)])

// ─── Ventas: presupuestos, facturas y rectificativas ─────────────────────────

export type SalesKind = 'quote' | 'proforma' | 'invoice' | 'rectifying'
export type SalesStatus = 'draft' | 'issued' | 'sent' | 'paid' | 'partial' | 'cancelled' | 'accepted' | 'rejected' | 'expired' | 'invoiced'

/** Series de numeración: F2026-0001, R2026-0001, P2026-0001… */
export const series = mysqlTable('series', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  kind: mysqlEnum('kind', ['quote', 'proforma', 'invoice', 'rectifying']).notNull(),
  name: varchar('name', { length: 80 }).notNull(),
  prefix: varchar('prefix', { length: 20 }).notNull(),
  /** Dígitos del contador (4 → 0001) */
  padding: smallint('padding').notNull().default(4),
  /** El contador vuelve a 1 cada año natural */
  yearlyReset: boolean('yearly_reset').notNull().default(true),
  isDefault: boolean('is_default').notNull().default(false),
  archivedAt: datetime('archived_at'),
  createdAt: createdAt(),
}, t => [index('series_company_idx').on(t.companyId, t.kind)])

export const seriesCounters = mysqlTable('series_counters', {
  seriesId: int('series_id').notNull(),
  year: smallint('year').notNull(),
  lastNumber: int('last_number').notNull().default(0),
}, t => [primaryKey({ columns: [t.seriesId, t.year] })])

export type PartySnapshot = ContactAddress & { name: string, nif?: string | null, email?: string | null }

export const salesDocuments = mysqlTable('sales_documents', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  kind: mysqlEnum('kind', ['quote', 'proforma', 'invoice', 'rectifying']).notNull().default('invoice'),
  status: mysqlEnum('status', ['draft', 'issued', 'sent', 'paid', 'partial', 'cancelled', 'accepted', 'rejected', 'expired', 'invoiced']).notNull().default('draft'),
  seriesId: int('series_id'),
  /** Número completo (F2026-0001); null mientras es borrador */
  number: varchar('number', { length: 40 }),
  sequence: int('sequence'),
  year: smallint('year'),
  issueDate: day('issue_date').notNull(),
  dueDate: day('due_date'),
  /** Fecha de la operación si es distinta de la de expedición */
  operationDate: day('operation_date'),
  contactId: int('contact_id'),
  /** Nº de pedido u orden de compra del cliente ("Su referencia"), impreso en el documento */
  customerReference: varchar('customer_reference', { length: 80 }),
  /** Datos del cliente congelados al emitir: la factura no cambia aunque cambie la ficha */
  customer: jsonText<PartySnapshot>('customer'),
  issuer: jsonText<PartySnapshot>('issuer'),
  subtotal: money('subtotal'),
  discountTotal: money('discount_total'),
  taxBase: money('tax_base'),
  vatTotal: money('vat_total'),
  surchargeTotal: money('surcharge_total'),
  irpfRate: pct('irpf_rate'),
  irpfTotal: money('irpf_total'),
  total: money('total'),
  paidTotal: money('paid_total'),
  currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
  paymentMethod: mysqlEnum('payment_method', ['transfer', 'card', 'cash', 'direct_debit', 'bizum', 'other']).default('transfer'),
  /** Descripción con formato antes de los conceptos (bloques, no HTML) */
  description: jsonText<RichDoc>('description'),
  notes: text('notes'),
  terms: text('terms'),
  /** Rectificativa: factura que corrige y motivo (R1..R5) */
  rectifiesId: int('rectifies_id'),
  rectificationCode: varchar('rectification_code', { length: 2 }),
  rectificationReason: varchar('rectification_reason', { length: 255 }),
  /** Factura generada desde este presupuesto, o presupuesto de origen */
  sourceId: int('source_id'),
  recurringId: int('recurring_id'),
  /** Plantilla de diseño (null = la predeterminada de la empresa) */
  templateId: int('template_id'),
  /** Importada de otro programa (facturas de años anteriores): no genera registro VeriFactu */
  imported: boolean('imported').notNull().default(false),
  fileId: int('file_id'),
  /** Enlace público para ver/descargar la factura sin cuenta */
  publicToken: varchar('public_token', { length: 64 }),
  /** Primera vez que el cliente abrió el enlace y nº de visitas */
  viewedAt: datetime('viewed_at'),
  viewCount: int('view_count').notNull().default(0),
  /** Respuesta del cliente a un presupuesto desde el enlace público */
  respondedAt: datetime('responded_at'),
  responseName: varchar('response_name', { length: 120 }),
  responseNote: varchar('response_note', { length: 1000 }),
  sentAt: datetime('sent_at'),
  paidAt: datetime('paid_at'),
  cancelledAt: datetime('cancelled_at'),
  createdBy: int('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [
  index('sales_company_idx').on(t.companyId, t.kind, t.status),
  index('sales_date_idx').on(t.companyId, t.issueDate),
  index('sales_contact_idx').on(t.contactId),
  uniqueIndex('sales_number_uq').on(t.companyId, t.seriesId, t.year, t.sequence),
  uniqueIndex('sales_token_uq').on(t.publicToken),
])

export const salesDocumentLines = mysqlTable('sales_document_lines', {
  id: int('id').autoincrement().primaryKey(),
  documentId: int('document_id').notNull(),
  position: smallint('position').notNull().default(0),
  itemId: int('item_id'),
  description: text('description').notNull(),
  quantity: decimal('quantity', { precision: 12, scale: 3, mode: 'number' }).notNull().default(1),
  unitPrice: decimal('unit_price', { precision: 14, scale: 4, mode: 'number' }).notNull().default(0),
  discountPct: pct('discount_pct'),
  vatRate: pct('vat_rate'),
  surchargeRate: pct('surcharge_rate'),
  /** Suplidos y similares no llevan retención */
  irpfApplies: boolean('irpf_applies').notNull().default(true),
  /** Base de la línea (cantidad × precio − descuento), redondeada */
  base: money('base'),
}, t => [index('lines_document_idx').on(t.documentId)])

// ─── Compras: facturas recibidas, tickets y otros gastos ─────────────────────

export const expenses = mysqlTable('expenses', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  kind: mysqlEnum('kind', ['invoice', 'ticket', 'payroll', 'social_security', 'tax', 'other']).notNull().default('invoice'),
  status: mysqlEnum('status', ['pending', 'paid', 'partial']).notNull().default('pending'),
  supplierId: int('supplier_id'),
  supplier: jsonText<PartySnapshot>('supplier'),
  /** Número de la factura del proveedor */
  number: varchar('number', { length: 60 }),
  issueDate: day('issue_date').notNull(),
  dueDate: day('due_date'),
  categoryId: int('category_id'),
  description: varchar('description', { length: 255 }),
  taxBase: money('tax_base'),
  vatTotal: money('vat_total'),
  surchargeTotal: money('surcharge_total'),
  /** Retención que nos practica el proveedor (alquiler 19 %, profesional 15 %): modelos 111/115 */
  irpfRate: pct('irpf_rate'),
  irpfTotal: money('irpf_total'),
  total: money('total'),
  paidTotal: money('paid_total'),
  /** % del gasto deducible en IRPF/IS y % del IVA deducible */
  deductiblePct: decimal('deductible_pct', { precision: 5, scale: 2, mode: 'number' }).notNull().default(100),
  vatDeductiblePct: decimal('vat_deductible_pct', { precision: 5, scale: 2, mode: 'number' }).notNull().default(100),
  /** Adquisición intracomunitaria / inversión del sujeto pasivo */
  reverseCharge: boolean('reverse_charge').notNull().default(false),
  isInvestment: boolean('is_investment').notNull().default(false),
  paymentMethod: mysqlEnum('payment_method', ['transfer', 'card', 'cash', 'direct_debit', 'bizum', 'other']),
  fileId: int('file_id'),
  /** Extraído por IA de un escaneo: confianza 0-100 para pedir revisión */
  aiConfidence: smallint('ai_confidence'),
  reviewed: boolean('reviewed').notNull().default(true),
  /** Por qué está por revisar (shared/utils/review): solo lo que pide una acción; null si está revisado */
  reviewNotes: jsonText<string[]>('review_notes'),
  recurringId: int('recurring_id'),
  notes: text('notes'),
  paidAt: datetime('paid_at'),
  /**
   * Aprobación del equipo: lo que registra un miembro queda «pendiente» hasta que un dueño o
   * administrador lo aprueba (si la empresa lo tiene activado). Lo demás nace aprobado.
   */
  approval: mysqlEnum('approval', ['approved', 'pending', 'rejected']).notNull().default('approved'),
  approvedBy: int('approved_by'),
  approvedAt: datetime('approved_at'),
  rejectReason: varchar('reject_reason', { length: 300 }),
  createdBy: int('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [
  index('expenses_company_idx').on(t.companyId, t.issueDate),
  index('expenses_approval_idx').on(t.companyId, t.approval),
  index('expenses_supplier_idx').on(t.supplierId),
  index('expenses_category_idx').on(t.categoryId),
])

/** Desglose de IVA de un gasto (una factura puede llevar varios tipos) */
export const expenseTaxLines = mysqlTable('expense_tax_lines', {
  id: int('id').autoincrement().primaryKey(),
  expenseId: int('expense_id').notNull(),
  base: money('base'),
  vatRate: pct('vat_rate'),
  vatAmount: money('vat_amount'),
  surchargeRate: pct('surcharge_rate'),
  surchargeAmount: money('surcharge_amount'),
}, t => [index('expense_tax_expense_idx').on(t.expenseId)])

// ─── Cobros y pagos ──────────────────────────────────────────────────────────

export const payments = mysqlTable('payments', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  direction: mysqlEnum('direction', ['in', 'out']).notNull(),
  salesDocumentId: int('sales_document_id'),
  expenseId: int('expense_id'),
  amount: money('amount'),
  date: day('date').notNull(),
  method: mysqlEnum('method', ['transfer', 'card', 'cash', 'direct_debit', 'bizum', 'other']).notNull().default('transfer'),
  bankAccountId: int('bank_account_id'),
  notes: varchar('notes', { length: 255 }),
  createdAt: createdAt(),
}, t => [
  index('payments_company_idx').on(t.companyId, t.date),
  index('payments_sales_idx').on(t.salesDocumentId),
  index('payments_expense_idx').on(t.expenseId),
])

export const bankAccounts = mysqlTable('bank_accounts', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  bankName: varchar('bank_name', { length: 120 }),
  iban: varchar('iban', { length: 34 }),
  balance: money('balance'),
  balanceAt: datetime('balance_at'),
  isDefault: boolean('is_default').notNull().default(false),
  lastImportAt: datetime('last_import_at'),
  createdAt: createdAt(),
}, t => [index('bank_company_idx').on(t.companyId)])

/** Propuesta de conciliación de un movimiento: un documento, un cobro/pago ya anotado, un gasto nuevo o ignorarlo */
export type BankSuggestion = {
  kind: 'invoice' | 'expense' | 'payment' | 'new_expense' | 'ignore'
  /** Factura, gasto o cobro/pago propuesto */
  id?: number | null
  /** Un abono que paga varias facturas del mismo cliente: todas ellas (la primera es `id`) */
  ids?: number[] | null
  label: string
  detail?: string | null
  /** 0-100 */
  confidence: number
  source: 'match' | 'rule' | 'ai'
  /** Gasto nuevo: tipo, categoría, proveedor e IVA propuestos */
  expenseKind?: 'invoice' | 'ticket' | 'payroll' | 'social_security' | 'tax' | 'other'
  categoryId?: number | null
  supplier?: string | null
  vatRate?: number | null
  /** Deducibilidad propuesta (la última vez con ese proveedor o la de la categoría) */
  deductiblePct?: number | null
  vatDeductiblePct?: number | null
  /** Cliente o proveedor reconocido en el movimiento (su IBAN, NIF, historial o nombre) */
  contactId?: number | null
}

/** Movimientos de los extractos bancarios importados (Norma 43, CSV o Excel) */
export const bankTransactions = mysqlTable('bank_transactions', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  accountId: int('account_id').notNull(),
  date: day('date').notNull(),
  valueDate: day('value_date'),
  /** Positivo = abono (entra dinero), negativo = cargo */
  amount: money('amount'),
  description: varchar('description', { length: 500 }).notNull(),
  counterparty: varchar('counterparty', { length: 200 }),
  reference: varchar('reference', { length: 120 }),
  /** Concepto común AEB (Norma 43): 03 recibos, 04 transferencias, 12 tarjetas, 17 comisiones… */
  bankCode: varchar('bank_code', { length: 4 }),
  balance: decimal('balance', { precision: 14, scale: 2, mode: 'number' }),
  /** Huella para no duplicar al importar extractos que se solapan */
  hash: varchar('hash', { length: 64 }).notNull(),
  status: mysqlEnum('status', ['pending', 'matched', 'ignored']).notNull().default('pending'),
  suggestion: jsonText<BankSuggestion>('suggestion'),
  salesDocumentId: int('sales_document_id'),
  expenseId: int('expense_id'),
  paymentId: int('payment_id'),
  /** El cobro/pago lo creó la conciliación (se borra al deshacerla) */
  ownsPayment: boolean('owns_payment').notNull().default(false),
  /** Un abono que paga varias facturas a la vez: los cobros de las demás (el de la primera va en paymentId) */
  groupPaymentIds: jsonText<number[]>('group_payment_ids'),
  ignoreReason: varchar('ignore_reason', { length: 120 }),
  matchedAt: datetime('matched_at'),
  matchedBy: int('matched_by'),
  createdAt: createdAt(),
}, t => [
  index('bank_tx_company_idx').on(t.companyId, t.status, t.date),
  index('bank_tx_account_idx').on(t.accountId, t.date),
  uniqueIndex('bank_tx_hash_uq').on(t.companyId, t.hash),
])

// ─── Recurrentes (cuotas, suscripciones, alquileres, nóminas…) ───────────────

export type RecurringTemplate = {
  /** Cliente (factura) o proveedor (gasto) */
  contactId?: number | null
  categoryId?: number | null
  description?: string | null
  // Factura
  seriesId?: number | null
  lines?: Array<{ itemId?: number | null, description: string, quantity: number, unitPrice: number, vatRate: number, discountPct?: number, surchargeRate?: number, irpfApplies?: boolean }>
  paymentMethod?: 'transfer' | 'card' | 'cash' | 'direct_debit' | 'bizum' | 'other' | null
  /** Días hasta el vencimiento (null: los del cliente o de la empresa) */
  dueDays?: number | null
  notes?: string | null
  terms?: string | null
  customerReference?: string | null
  // Gasto
  expenseKind?: 'invoice' | 'ticket' | 'payroll' | 'social_security' | 'tax' | 'other'
  taxLines?: Array<{ base: number, vatRate: number, vatAmount?: number | null, surchargeRate?: number }>
  deductiblePct?: number
  vatDeductiblePct?: number
  /** Gasto que se da por pagado al generarse (domiciliaciones, tarjeta) */
  paid?: boolean
  // Ambos
  irpfRate?: number
  /** Importe de cada documento, calculado al guardar (para listados y previsión) */
  base?: number
  total?: number
}

export const recurrings = mysqlTable('recurrings', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  kind: mysqlEnum('kind', ['invoice', 'expense']).notNull(),
  name: varchar('name', { length: 160 }).notNull(),
  frequency: mysqlEnum('frequency', ['weekly', 'monthly', 'quarterly', 'yearly']).notNull().default('monthly'),
  interval: smallint('interval').notNull().default(1),
  /** Primera fecha: fija el día del mes (31 → 28/29 en febrero y vuelve a 31 en marzo) */
  startDate: day('start_date'),
  nextDate: day('next_date').notNull(),
  endDate: day('end_date'),
  /** Emitir y enviar sola, o dejar borrador para revisar */
  autoIssue: boolean('auto_issue').notNull().default(false),
  autoSend: boolean('auto_send').notNull().default(false),
  template: jsonText<RecurringTemplate>('template'),
  active: boolean('active').notNull().default(true),
  lastRunAt: datetime('last_run_at'),
  runCount: int('run_count').notNull().default(0),
  /** Último fallo al generar (cliente sin NIF, correo no enviado…); null si fue bien */
  lastError: varchar('last_error', { length: 500 }),
  createdBy: int('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [index('recurring_company_idx').on(t.companyId, t.active, t.nextDate)])

// ─── Impuestos: modelos de la AEAT ───────────────────────────────────────────

export const taxFilings = mysqlTable('tax_filings', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  /** 303, 130, 111, 115, 349, 390, 347, 190, 180, 100, 200, 202… */
  model: varchar('model', { length: 4 }).notNull(),
  year: smallint('year').notNull(),
  /** 1T..4T, 01..12 o 0A (anual) */
  period: varchar('period', { length: 2 }).notNull(),
  status: mysqlEnum('status', ['draft', 'ready', 'filed', 'paid']).notNull().default('draft'),
  /** Casillas del modelo calculadas: { "01": 1234.5, ... } */
  boxes: jsonText<Record<string, number>>('boxes'),
  /** Resultado: positivo a ingresar, negativo a devolver/compensar */
  result: money('result'),
  dueDate: day('due_date'),
  filedAt: datetime('filed_at'),
  /** Código Seguro de Verificación del justificante de la AEAT */
  csv: varchar('csv', { length: 40 }),
  receiptFileId: int('receipt_file_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [uniqueIndex('filings_period_uq').on(t.companyId, t.model, t.year, t.period)])

// ─── Calendario: eventos propios, suscripción para el móvil y calendarios externos ─

export const calendarEvents = mysqlTable('calendar_events', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  /** Evento (reunión, cita…) o tarea que se marca como hecha */
  kind: mysqlEnum('kind', ['event', 'task']).notNull().default('event'),
  title: varchar('title', { length: 200 }).notNull(),
  notes: text('notes'),
  location: varchar('location', { length: 200 }),
  startDate: day('start_date').notNull(),
  /** Último día (incluido) si dura varios; null = un solo día */
  endDate: day('end_date'),
  /** HH:MM; null = todo el día */
  startTime: varchar('start_time', { length: 5 }),
  endTime: varchar('end_time', { length: 5 }),
  /** Clave de color del calendario (shared/utils/calendar.ts) */
  color: varchar('color', { length: 16 }).notNull().default('brand'),
  repeat: mysqlEnum('repeat', ['none', 'weekly', 'monthly', 'quarterly', 'yearly']).notNull().default('none'),
  repeatInterval: smallint('repeat_interval').notNull().default(1),
  repeatUntil: day('repeat_until'),
  /** Aviso al móvil: minutos antes (los de todo el día cuentan desde las 9:00); null = sin aviso */
  remindMinutes: int('remind_minutes'),
  /** Última repetición avisada (YYYY-MM-DD): cada aviso sale una sola vez */
  remindedFor: day('reminded_for'),
  /** Tareas: fechas (de cada repetición) ya hechas */
  doneDates: jsonText<string[]>('done_dates'),
  contactId: int('contact_id'),
  createdBy: int('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [index('cal_events_company_idx').on(t.companyId, t.startDate)])

/** Dirección privada del calendario (webcal) para suscribirse desde Google, Apple u Outlook */
export const calendarLinks = mysqlTable('calendar_links', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  userId: int('user_id').notNull(),
  token: varchar('token', { length: 64 }).notNull(),
  /** Capas que se publican (income, expense, tax…) */
  layers: jsonText<string[]>('layers'),
  lastUsedAt: datetime('last_used_at'),
  createdAt: createdAt(),
}, t => [uniqueIndex('cal_links_token_uq').on(t.token), uniqueIndex('cal_links_user_uq').on(t.companyId, t.userId)])

export interface FeedEvent {
  uid: string
  title: string
  date: string
  endDate?: string | null
  time?: string | null
  endTime?: string | null
  location?: string | null
  notes?: string | null
}

/** Calendario externo (dirección iCal secreta de Google, iCloud público, Outlook…) visto dentro de NUMIQ */
export const calendarFeeds = mysqlTable('calendar_feeds', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  /** Solo lo ve quien lo añadió: es su calendario personal */
  userId: int('user_id').notNull(),
  name: varchar('name', { length: 80 }).notNull(),
  url: varchar('url', { length: 1000 }).notNull(),
  color: varchar('color', { length: 16 }).notNull().default('c1'),
  active: boolean('active').notNull().default(true),
  /** Eventos leídos en la última sincronización (ya expandidas las repeticiones) */
  cache: jsonText<FeedEvent[]>('cache'),
  lastSyncAt: datetime('last_sync_at'),
  lastError: varchar('last_error', { length: 300 }),
  createdAt: createdAt(),
}, t => [index('cal_feeds_user_idx').on(t.companyId, t.userId)])

// ─── VeriFactu: registros de facturación encadenados ─────────────────────────

export const verifactuRecords = mysqlTable('verifactu_records', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  salesDocumentId: int('sales_document_id').notNull(),
  type: mysqlEnum('type', ['alta', 'anulacion']).notNull().default('alta'),
  issuerNif: varchar('issuer_nif', { length: 20 }).notNull(),
  invoiceNumber: varchar('invoice_number', { length: 60 }).notNull(),
  invoiceDate: day('invoice_date').notNull(),
  /** F1 completa, F2 simplificada, R1..R5 rectificativas */
  invoiceType: varchar('invoice_type', { length: 2 }).notNull(),
  vatTotal: money('vat_total'),
  total: money('total'),
  /** SHA-256 en hexadecimal mayúsculas, encadenado con el registro anterior */
  hash: varchar('hash', { length: 64 }).notNull(),
  previousHash: varchar('previous_hash', { length: 64 }),
  previousId: int('previous_id'),
  /** FechaHoraHusoGenRegistro (ISO 8601 con zona) */
  generatedAt: varchar('generated_at', { length: 32 }).notNull(),
  xml: text('xml'),
  status: mysqlEnum('status', ['pending', 'sent', 'accepted', 'accepted_with_errors', 'rejected']).notNull().default('pending'),
  aeatCsv: varchar('aeat_csv', { length: 40 }),
  aeatResponse: jsonText<Record<string, unknown>>('aeat_response'),
  error: text('error'),
  sentAt: datetime('sent_at'),
  createdAt: createdAt(),
}, t => [
  index('verifactu_company_idx').on(t.companyId, t.id),
  index('verifactu_document_idx').on(t.salesDocumentId),
])

// ─── Archivos y bandeja de documentos (escaneo con IA) ───────────────────────

/** Resultado de la lectura con IA de un archivo (lo que devolvió el modelo, para auditar y releer) */
export type FileAiResult = {
  model: string
  ms: number
  tokens: { input: number, output: number }
  documents?: ExtractedDocument[]
  sheet?: Record<string, unknown>
}

export const files = mysqlTable('files', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  kind: mysqlEnum('kind', ['scan', 'import', 'attachment', 'vault', 'logo', 'pdf', 'receipt']).notNull().default('scan'),
  originalName: varchar('original_name', { length: 255 }).notNull(),
  /** Ruta dentro del ZIP o carpeta de origen (importación por lotes) */
  sourcePath: varchar('source_path', { length: 500 }),
  /** Fecha original del archivo y su procedencia, conservadas antes de leer con IA. */
  sourceDate: jsonText<SourceFileDate>('source_date'),
  mime: varchar('mime', { length: 100 }).notNull(),
  size: int('size').notNull().default(0),
  path: varchar('path', { length: 500 }).notNull(),
  sha256: varchar('sha256', { length: 64 }),
  /** Archivo documental: trimestre y carpeta (banco, legal, nóminas…) */
  year: smallint('year'),
  quarter: smallint('quarter'),
  folder: varchar('folder', { length: 60 }),
  notes: varchar('notes', { length: 255 }),
  batchId: int('batch_id'),
  aiStatus: mysqlEnum('ai_status', ['none', 'pending', 'processing', 'done', 'failed']).notNull().default('none'),
  aiResult: jsonText<FileAiResult>('ai_result'),
  aiError: varchar('ai_error', { length: 500 }),
  linkedType: mysqlEnum('linked_type', ['expense', 'sales_document', 'contact', 'tax_filing']),
  linkedId: int('linked_id'),
  uploadedBy: int('uploaded_by'),
  createdAt: createdAt(),
}, t => [
  index('files_company_idx').on(t.companyId, t.aiStatus),
  index('files_sha_idx').on(t.companyId, t.sha256),
  index('files_period_idx').on(t.companyId, t.year, t.quarter),
  index('files_batch_idx').on(t.batchId),
])

/** Importación por lotes de facturas antiguas (PDF, DOCX, XLS, CSV, ZIP con carpetas), escaneos y correo */
export type ImportOptions = { createItems: boolean, markPaid: boolean }

export const importBatches = mysqlTable('import_batches', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  /** Subida de archivos, escaneo rápido de un documento o facturas llegadas por correo */
  source: mysqlEnum('source', ['upload', 'scan', 'email']).notNull().default('upload'),
  name: varchar('name', { length: 200 }),
  /** Qué se importa: emitidas, recibidas o que lo decida la IA por el NIF del emisor */
  direction: mysqlEnum('direction', ['issued', 'received', 'auto']).notNull().default('auto'),
  status: mysqlEnum('status', ['uploading', 'processing', 'review', 'done', 'failed']).notNull().default('uploading'),
  options: jsonText<ImportOptions>('options'),
  totalFiles: int('total_files').notNull().default(0),
  processedFiles: int('processed_files').notNull().default(0),
  summary: jsonText<{ invoices?: number, expenses?: number, contactsCreated?: number, itemsCreated?: number, vault?: number, attachments?: number, quotes?: number, duplicates?: number, errors?: number }>('summary'),
  /** Contactos y productos que creó al confirmar (para poder eliminar la importación con todo lo suyo) */
  created: jsonText<{ contacts?: number[], items?: number[] }>('created'),
  createdBy: int('created_by'),
  createdAt: createdAt(),
  finishedAt: datetime('finished_at'),
}, t => [index('import_company_idx').on(t.companyId)])

/** Cada factura, contacto o producto encontrado en los archivos de un lote, pendiente de revisar */
export const importItems = mysqlTable('import_items', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  batchId: int('batch_id').notNull(),
  fileId: int('file_id'),
  /** Orden dentro del archivo (PDF con varias facturas, filas de un Excel) */
  position: int('position').notNull().default(0),
  type: mysqlEnum('type', ['sales', 'expense', 'contact', 'item', 'vault']).notNull(),
  status: mysqlEnum('status', ['ready', 'warning', 'duplicate', 'error', 'imported', 'excluded']).notNull().default('ready'),
  data: jsonText<ImportInvoiceData | ImportContactData | ImportCatalogData | ImportVaultData>('data'),
  /** Contacto existente al que se asigna (null = se crea uno nuevo al importar) */
  contactId: int('contact_id'),
  duplicate: jsonText<ImportDuplicate>('duplicate'),
  confidence: smallint('confidence'),
  warnings: jsonText<string[]>('warnings'),
  /** Factura, gasto, contacto o producto creado al confirmar */
  resultId: int('result_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [index('import_items_batch_idx').on(t.batchId, t.position)])

// ─── Bandeja de correo: facturas recibidas por email (IMAP) ──────────────────

export type MailAttachment = { part: string, filename: string, size: number, mime: string }

export const mailMessages = mysqlTable('mail_messages', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  mailbox: varchar('mailbox', { length: 120 }).notNull().default('INBOX'),
  uidValidity: varchar('uid_validity', { length: 20 }),
  uid: int('uid').notNull(),
  messageId: varchar('message_id', { length: 255 }).notNull(),
  fromName: varchar('from_name', { length: 200 }),
  fromAddress: varchar('from_address', { length: 191 }),
  subject: varchar('subject', { length: 255 }),
  date: datetime('date'),
  attachments: jsonText<MailAttachment[]>('attachments'),
  /** Enviado a la dirección de la empresa (alias +empresa) */
  addressed: boolean('addressed').notNull().default(false),
  status: mysqlEnum('status', ['new', 'imported', 'ignored']).notNull().default('new'),
  batchId: int('batch_id'),
  createdAt: createdAt(),
}, t => [
  uniqueIndex('mail_message_uq').on(t.companyId, t.messageId),
  index('mail_company_idx').on(t.companyId, t.status, t.date),
])

// ─── Diseño de facturas ──────────────────────────────────────────────────────

export type InvoiceTemplateOptions = {
  showLogo?: boolean
  showItemCodes?: boolean
  showDiscountColumn?: boolean
  showPaymentInfo?: boolean
  showSignature?: boolean
  headerText?: string
  paymentText?: string
  notesLabel?: string
  termsLabel?: string
  defaultNotes?: string
  defaultTerms?: string
  footerText?: string
}

export const invoiceTemplates = mysqlTable('invoice_templates', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  name: varchar('name', { length: 80 }).notNull(),
  /** Estructura base: classic, modern, minimal, bold */
  layout: varchar('layout', { length: 20 }).notNull().default('modern'),
  accentColor: varchar('accent_color', { length: 9 }).notNull().default('#4f46e5'),
  font: varchar('font', { length: 40 }).notNull().default('Inter'),
  logoFileId: int('logo_file_id'),
  options: jsonText<InvoiceTemplateOptions>('options'),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [index('templates_company_idx').on(t.companyId)])

// ─── Correos enviados (facturas, presupuestos, recordatorios) ────────────────

export const sentEmails = mysqlTable('sent_emails', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  salesDocumentId: int('sales_document_id'),
  kind: mysqlEnum('kind', ['document', 'reminder']).notNull().default('document'),
  to: varchar('to', { length: 500 }).notNull(),
  cc: varchar('cc', { length: 500 }),
  subject: varchar('subject', { length: 255 }).notNull(),
  withPdf: boolean('with_pdf').notNull().default(true),
  status: mysqlEnum('status', ['sent', 'failed']).notNull(),
  messageId: varchar('message_id', { length: 255 }),
  error: varchar('error', { length: 500 }),
  sentBy: int('sent_by'),
  createdAt: createdAt(),
}, t => [index('emails_document_idx').on(t.salesDocumentId, t.createdAt)])

// ─── Envíos al gestor: facturas, gastos y documentación de un periodo en un ZIP ─

export type AdvisorPackContents = {
  issued: number
  received: number
  receivedFiles: number
  vault: number
  summary: boolean
  files: number
  totals: { income: number, expenses: number }
}

export const advisorPacks = mysqlTable('advisor_packs', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  /** 3T 2026, octubre 2026, 2026… */
  label: varchar('label', { length: 120 }).notNull(),
  periodFrom: day('period_from').notNull(),
  periodTo: day('period_to').notNull(),
  contents: jsonText<AdvisorPackContents>('contents'),
  path: varchar('path', { length: 500 }).notNull(),
  size: int('size').notNull().default(0),
  /** Enlace de descarga para el gestor (caduca) */
  token: varchar('token', { length: 64 }).notNull(),
  expiresAt: datetime('expires_at').notNull(),
  downloads: int('downloads').notNull().default(0),
  sentTo: varchar('sent_to', { length: 500 }),
  sentAt: datetime('sent_at'),
  emailStatus: mysqlEnum('email_status', ['sent', 'failed']),
  emailError: varchar('email_error', { length: 500 }),
  createdBy: int('created_by'),
  createdAt: createdAt(),
}, t => [
  index('packs_company_idx').on(t.companyId, t.createdAt),
  uniqueIndex('packs_token_uq').on(t.token),
])

// ─── Certificado digital (custodia cifrada) ──────────────────────────────────

export const certificates = mysqlTable('certificates', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  /** Titular (persona o entidad) y NIF del certificado */
  holderName: varchar('holder_name', { length: 200 }).notNull(),
  holderNif: varchar('holder_nif', { length: 20 }),
  /** Representante de la entidad (certificados de representante) */
  representativeName: varchar('representative_name', { length: 200 }),
  representativeNif: varchar('representative_nif', { length: 20 }),
  kind: mysqlEnum('kind', ['persona', 'representante', 'sello', 'otro']).notNull().default('persona'),
  issuer: varchar('issuer', { length: 200 }),
  serial: varchar('serial', { length: 80 }),
  fingerprint: varchar('fingerprint', { length: 100 }).notNull(),
  validFrom: datetime('valid_from').notNull(),
  validTo: datetime('valid_to').notNull(),
  /** PKCS#12 y su contraseña, cifrados con AES-256-GCM (clave del servidor) */
  path: varchar('path', { length: 500 }).notNull(),
  uploadedBy: int('uploaded_by'),
  createdAt: createdAt(),
}, t => [index('certificates_company_idx').on(t.companyId)])

// ─── Asistente IA: conversaciones con los datos de la empresa ───────────────

export const aiConversations = mysqlTable('ai_conversations', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  userId: int('user_id').notNull(),
  title: varchar('title', { length: 160 }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [index('ai_conv_user_idx').on(t.companyId, t.userId, t.updatedAt)])

export const aiMessages = mysqlTable('ai_messages', {
  id: int('id').autoincrement().primaryKey(),
  conversationId: int('conversation_id').notNull(),
  role: mysqlEnum('role', ['user', 'assistant']).notNull(),
  content: text('content').notNull(),
  /** Herramientas consultadas para responder (para mostrar "consultó tus facturas…") */
  tools: jsonText<string[]>('tools'),
  model: varchar('model', { length: 60 }),
  createdAt: createdAt(),
}, t => [index('ai_msg_conv_idx').on(t.conversationId, t.id)])

/**
 * Operaciones del asistente sobre los datos. El modelo solo las propone: quedan pendientes con los
 * registros exactos que tocan y se ejecutan cuando el usuario las confirma. Guardan cómo estaba todo
 * para poder deshacerlas.
 */
export const aiActions = mysqlTable('ai_actions', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  userId: int('user_id').notNull(),
  conversationId: int('conversation_id'),
  /** Respuesta del asistente en la que se propuso */
  messageId: int('message_id'),
  /** ventas.modificar, gastos.eliminar, banco.ignorar… */
  kind: varchar('kind', { length: 40 }).notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  /** high: borra datos o no tiene vuelta atrás fácil */
  risk: mysqlEnum('risk', ['normal', 'high']).notNull().default('normal'),
  status: mysqlEnum('status', ['pending', 'running', 'done', 'failed', 'cancelled', 'undoing', 'undone']).notNull().default('pending'),
  /** Registros afectados y cambios ya resueltos (ids de cliente, categoría…) */
  params: jsonText<Record<string, unknown>>('params'),
  preview: jsonText<AiActionPreview>('preview'),
  result: jsonText<AiActionResult>('result'),
  /** Cómo estaban los registros antes de ejecutar */
  undo: jsonText<Record<string, unknown>>('undo'),
  error: varchar('error', { length: 500 }),
  expiresAt: datetime('expires_at').notNull(),
  executedAt: datetime('executed_at'),
  undoneAt: datetime('undone_at'),
  createdAt: createdAt(),
}, t => [
  index('ai_actions_conv_idx').on(t.conversationId, t.id),
  index('ai_actions_company_idx').on(t.companyId, t.createdAt),
])

// ─── IA: recomendaciones y avisos ────────────────────────────────────────────

export const insights = mysqlTable('insights', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id').notNull(),
  /** Clave estable para no repetir el mismo aviso (p. ej. overdue:2026-10) */
  key: varchar('key', { length: 120 }).notNull(),
  severity: mysqlEnum('severity', ['info', 'success', 'warning', 'critical']).notNull().default('info'),
  title: varchar('title', { length: 200 }).notNull(),
  body: text('body'),
  actionLabel: varchar('action_label', { length: 60 }),
  actionUrl: varchar('action_url', { length: 255 }),
  data: jsonText<Record<string, unknown>>('data'),
  dismissedAt: datetime('dismissed_at'),
  createdAt: createdAt(),
}, t => [uniqueIndex('insights_key_uq').on(t.companyId, t.key)])

// ─── IA: consumo y coste de cada llamada a OpenAI ────────────────────────────

/**
 * Una fila por petición facturada (también las que fallan después de consumir tokens). El coste se
 * calcula con la tarifa oficial del modelo y el tipo de servicio; `estimated` marca las lecturas
 * anteriores a este registro, reconstruidas a partir de lo que se guardaba entonces.
 */
export const aiUsage = mysqlTable('ai_usage', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id'),
  userId: int('user_id'),
  /** Día en hora de Madrid (agrupar por días, semanas y meses sin depender de la zona de la base de datos) */
  day: day('day').notNull(),
  /** escaneo, importacion, correo, asistente, banco, contactos, impuestos, otros */
  category: varchar('category', { length: 30 }).notNull(),
  /** Tarea concreta: documentos, hojas, bank_categories, asistente… */
  task: varchar('task', { length: 60 }).notNull(),
  model: varchar('model', { length: 80 }).notNull(),
  serviceTier: varchar('service_tier', { length: 20 }),
  inputTokens: int('input_tokens').notNull().default(0),
  cachedTokens: int('cached_tokens').notNull().default(0),
  cacheWriteTokens: int('cache_write_tokens').notNull().default(0),
  outputTokens: int('output_tokens').notNull().default(0),
  reasoningTokens: int('reasoning_tokens').notNull().default(0),
  costUsd: decimal('cost_usd', { precision: 14, scale: 8, mode: 'number' }).notNull().default(0),
  /** Dólares por euro del BCE de ese día (null: sin cambio disponible al registrar) */
  usdPerEur: decimal('usd_per_eur', { precision: 10, scale: 6, mode: 'number' }),
  ms: int('ms').notNull().default(0),
  ok: boolean('ok').notNull().default(true),
  estimated: boolean('estimated').notNull().default(false),
  createdAt: createdAt(),
}, t => [
  index('ai_usage_company_day_idx').on(t.companyId, t.day),
  index('ai_usage_company_created_idx').on(t.companyId, t.createdAt),
])

// ─── Auditoría (registro de eventos: trazabilidad exigida a los SIF) ─────────

export const auditLog = mysqlTable('audit_log', {
  id: int('id').autoincrement().primaryKey(),
  companyId: int('company_id'),
  userId: int('user_id'),
  action: varchar('action', { length: 60 }).notNull(),
  entity: varchar('entity', { length: 40 }),
  entityId: int('entity_id'),
  data: jsonText<Record<string, unknown>>('data'),
  ip: varchar('ip', { length: 45 }),
  createdAt: createdAt(),
}, t => [index('audit_company_idx').on(t.companyId, t.createdAt)])
