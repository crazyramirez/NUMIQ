import { z } from 'zod'

const optional = (max: number) => z.string().trim().max(max).nullish().transform(v => v || null)

export const companyInputSchema = z.object({
  kind: z.enum(['autonomo', 'sociedad']),
  legalName: z.string().trim().min(2, 'Escribe la razón social o tu nombre completo').max(200),
  tradeName: optional(200),
  nif: z.string().trim().max(20).transform(normalizeNif).refine(v => validateNif(v).valid, 'NIF no válido: revisa la letra de control'),
  email: optionalEmailField(),
  phone: optional(40),
  website: optional(200),
  address: optional(255),
  postalCode: optional(10),
  city: optional(120),
  province: optional(120),
  iban: optional(34).transform(v => v?.replace(/\s/g, '').toUpperCase() || null),
  activityCode: optional(20),
  activityDescription: optional(255),
  taxRegime: z.enum(['directa_simplificada', 'directa_normal', 'modulos', 'sociedades']),
  vatRegime: z.enum(['general', 'recargo_equivalencia', 'criterio_caja', 'exento']),
  defaultIrpfRate: z.number().min(0).max(100),
  defaultVatRate: z.number().min(0).max(100),
  paymentTermsDays: z.number().int().min(0).max(365).default(30),
  activityStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  verifactuEnabled: z.boolean().default(true),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
  invoiceFooter: z.string().max(2000).nullish(),
})

/** Cambios parciales: sin defaults, que con .partial() de Zod 4 rellenarían los campos no enviados (VeriFactu volvería a activarse) */
export const companyPatchSchema = companyInputSchema.extend({
  paymentTermsDays: companyInputSchema.shape.paymentTermsDays.unwrap(),
  verifactuEnabled: companyInputSchema.shape.verifactuEnabled.unwrap(),
}).partial()

export type CompanyInput = z.infer<typeof companyInputSchema>
