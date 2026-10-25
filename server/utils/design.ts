import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

export const designInputSchema = z.object({
  layout: z.enum(['modern', 'classic', 'minimal', 'bold']),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color no válido'),
  font: z.enum(['Inter', 'Lora', 'Manrope']),
  density: z.enum(['normal', 'compact']).optional().default('normal'),
  showLogo: z.boolean(),
  discountColumn: z.enum(['auto', 'always']),
  lineColumns: z.enum(['auto', 'full', 'amount', 'concept']).optional().default('auto'),
  showItemCodes: z.boolean(),
  showPaymentInfo: z.boolean(),
  paymentText: z.string().max(500, 'Máximo 500 caracteres'),
  customerReferenceLabel: z.string().trim().max(40, 'Máximo 40 caracteres').optional().default('Orden de Pedido'),
  notesLabel: z.string().trim().max(40, 'Máximo 40 caracteres'),
  termsLabel: z.string().trim().max(40, 'Máximo 40 caracteres'),
  defaultNotes: z.string().max(1000, 'Máximo 1000 caracteres'),
  defaultTerms: z.string().max(1000, 'Máximo 1000 caracteres'),
  defaultEmailSubject: z.string().trim().max(200, 'Máximo 200 caracteres').optional().default('Factura {numero} · {empresa}'),
  defaultEmailMessage: z.string().max(3000, 'Máximo 3000 caracteres').optional().default(''),
  defaultEmailSubjectQuote: z.string().trim().max(200, 'Máximo 200 caracteres').optional().default('Presupuesto {numero} · {empresa}'),
  defaultEmailMessageQuote: z.string().max(3000, 'Máximo 3000 caracteres').optional().default(''),
  footerText: z.string().max(600, 'Máximo 600 caracteres'),
})

/** Diseño de factura de la empresa: su plantilla predeterminada o los valores por defecto */
export async function getCompanyDesign(company: { id: number, brandColor: string | null }): Promise<InvoiceDesign> {
  const [t] = await useDb().select().from(tables.invoiceTemplates)
    .where(and(eq(tables.invoiceTemplates.companyId, company.id), eq(tables.invoiceTemplates.isDefault, true)))
    .limit(1)
  if (!t) return defaultDesign(company.brandColor)
  return normalizeDesign({ ...(t.options as Partial<InvoiceDesign> | null), layout: t.layout as DesignLayout, accentColor: t.accentColor, font: t.font as DesignFont }, company.brandColor)
}

export async function saveCompanyDesign(companyId: number, design: InvoiceDesign) {
  const db = useDb()
  const { layout, accentColor, font, ...options } = design
  const [t] = await db.select({ id: tables.invoiceTemplates.id }).from(tables.invoiceTemplates)
    .where(and(eq(tables.invoiceTemplates.companyId, companyId), eq(tables.invoiceTemplates.isDefault, true)))
    .limit(1)
  if (t) {
    await db.update(tables.invoiceTemplates).set({ layout, accentColor, font, options }).where(eq(tables.invoiceTemplates.id, t.id))
  }
  else {
    await db.insert(tables.invoiceTemplates).values({ companyId, name: 'Mi diseño', layout, accentColor, font, options, isDefault: true })
  }
  // El color de marca de la empresa sigue al del diseño (avatares, correos)
  await db.update(tables.companies).set({ brandColor: accentColor }).where(eq(tables.companies.id, companyId))
}
