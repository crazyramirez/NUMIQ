import { z } from 'zod'

const optional = (max: number) => z.string().trim().max(max).nullish().transform(v => v || null)

export const contactInputSchema = z.object({
  isClient: z.boolean().default(false),
  isSupplier: z.boolean().default(false),
  kind: z.enum(['company', 'person']).default('company'),
  name: z.string().trim().min(1, 'Escribe el nombre o la razón social').max(200),
  tradeName: optional(200),
  nif: optional(20).transform(v => (v ? normalizeNif(v) : null)),
  nifType: z.enum(['nif', 'vat_eu', 'passport', 'other']).default('nif'),
  email: optionalEmailField(),
  phone: optional(40),
  website: optional(200),
  address: optional(255),
  postalCode: optional(10),
  city: optional(120),
  province: optional(120),
  country: z.string().length(2).toUpperCase().default('ES'),
  iban: optional(34).transform(v => v?.replace(/\s/g, '').toUpperCase() || null),
  paymentTermsDays: z.number().int().min(0).max(365).nullish(),
  irpfRate: z.number().min(0).max(100).nullish(),
  equivalenceSurcharge: z.boolean().default(false),
  defaultCategoryId: z.number().int().positive().nullish(),
  notes: z.string().max(5000).nullish(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).nullish(),
}).superRefine((c, ctx) => {
  if (!c.isClient && !c.isSupplier) ctx.addIssue({ code: 'custom', path: ['isClient'], message: 'Marca si es cliente, proveedor o ambos' })
  if (c.nif && c.nifType === 'nif' && !validateNif(c.nif).valid) ctx.addIssue({ code: 'custom', path: ['nif'], message: 'NIF no válido: revisa la letra de control' })
  if (c.nif && c.nifType === 'vat_eu' && !looksLikeEuVat(c.nif)) ctx.addIssue({ code: 'custom', path: ['nif'], message: 'NIF-IVA no válido: empieza por el código del país (FR, DE, PT…)' })
})

export type ContactInput = z.infer<typeof contactInputSchema>

/** URL del logotipo de un contacto (con versión para la caché), o null */
export function contactLogoUrl(id: number | null | undefined, logoPath: string | null | undefined) {
  return id && logoPath ? `/api/contacts/${id}/logo?v=${encodeURIComponent(logoPath.split('/').pop() ?? '')}` : null
}

/** Contacto para la app: la ruta interna del logotipo se cambia por su URL */
export function contactView<T extends { id: number, logoPath: string | null }>(contact: T) {
  const { logoPath, ...rest } = contact
  return { ...rest, logoUrl: contactLogoUrl(contact.id, logoPath) }
}
