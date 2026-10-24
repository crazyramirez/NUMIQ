import { and, eq, ne } from 'drizzle-orm'
import { z } from 'zod'
import type { ImportDuplicate } from '../../shared/types/import'
import { sameImportParty, taxIdKey } from '../../shared/utils/duplicate-matching'

const optional = (max: number) => z.string().trim().max(max).nullish().transform(v => v || null)

export const contactInputSchema = z.object({
  isClient: z.boolean().default(false),
  isSupplier: z.boolean().default(false),
  kind: z.enum(['company', 'person']).default('company'),
  name: z.string().trim().min(1, 'Escribe el nombre o la razón social').max(200),
  tradeName: optional(200),
  contactPerson: optional(120),
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

/**
 * Ficha que ya existe para el contacto que se va a crear o guardar: el mismo NIF es seguro; el mismo
 * nombre, email o teléfono con dirección (sin NIF que lo contradiga), muy probable.
 */
export async function findContactDuplicate(companyId: number, c: { name: string, tradeName?: string | null, nif?: string | null, email?: string | null, phone?: string | null, address?: string | null }, exceptId?: number): Promise<ImportDuplicate | null> {
  const t = tables.contacts
  const rows = await useDb().select({ id: t.id, name: t.name, tradeName: t.tradeName, nif: t.nif, email: t.email, phone: t.phone, address: t.address })
    .from(t).where(and(eq(t.companyId, companyId), ...(exceptId ? [ne(t.id, exceptId)] : [])))
  const nif = taxIdKey(c.nif)
  const sameNif = nif ? rows.find(r => taxIdKey(r.nif) === nif) : undefined
  if (sameNif) return { type: 'contact', id: sameNif.id, label: `${sameNif.name} ya tiene el NIF ${c.nif}`, certain: true }
  const same = rows.find(r => sameImportParty(r, c))
  if (!same) return null
  const by = same.email && c.email && same.email.toLowerCase() === c.email.toLowerCase() ? 'el mismo email' : 'el mismo nombre'
  return { type: 'contact', id: same.id, label: `Ya tienes a ${same.name}, con ${by}`, certain: false }
}

/**
 * Completa la ficha de un contacto existente con lo que trae un documento (NIF, email, teléfono, dirección)
 * sin cambiar nada de lo que ya tiene. El proveedor «Endesa» creado desde el banco recibe así el NIF de
 * su factura en vez de crearse otro. Devuelve lo que se ha añadido.
 */
export async function fillContactGaps(companyId: number, contactId: number, p: { nif?: string | null, email?: string | null, phone?: string | null, address?: string | null, postalCode?: string | null, city?: string | null, province?: string | null }) {
  const db = useDb()
  const [c] = await db.select().from(tables.contacts).where(and(eq(tables.contacts.id, contactId), eq(tables.contacts.companyId, companyId)))
  if (!c) return {}
  const patch: Partial<typeof tables.contacts.$inferInsert> = {}
  const nif = p.nif ? normalizeNif(p.nif).slice(0, 20) : null
  if (!c.nif && nif) {
    // Un NIF que ya tiene otro contacto no se copia: serían dos fichas con el mismo NIF
    const [other] = await db.select({ id: tables.contacts.id }).from(tables.contacts)
      .where(and(eq(tables.contacts.companyId, companyId), eq(tables.contacts.nif, nif), ne(tables.contacts.id, c.id))).limit(1)
    if (!other) Object.assign(patch, { nif, nifType: !validateNif(nif).valid && looksLikeEuVat(nif) ? 'vat_eu' : 'nif' })
  }
  if (!c.email && p.email) patch.email = p.email.slice(0, 191)
  if (!c.phone && p.phone) patch.phone = p.phone.slice(0, 40)
  // La dirección va entera o no va: no se mezclan la calle de un sitio y la ciudad de otro
  if (!c.address && !c.city && p.address) {
    Object.assign(patch, { address: p.address.slice(0, 255), postalCode: p.postalCode?.slice(0, 10) ?? c.postalCode, city: p.city?.slice(0, 120) ?? null, province: p.province?.slice(0, 120) ?? null })
  }
  if (Object.keys(patch).length) await db.update(tables.contacts).set(patch).where(eq(tables.contacts.id, c.id))
  return patch
}

/** URL del logotipo de un contacto (con versión para la caché), o null */
export function contactLogoUrl(id: number | null | undefined, logoPath: string | null | undefined) {
  return id && logoPath ? `/api/contacts/${id}/logo?v=${encodeURIComponent(logoPath.split('/').pop() ?? '')}` : null
}

/** Contacto para la app: la ruta interna del logotipo se cambia por su URL */
export function contactView<T extends { id: number, logoPath: string | null }>(contact: T) {
  const { logoPath, ...rest } = contact
  return { ...rest, logoUrl: contactLogoUrl(contact.id, logoPath) }
}
