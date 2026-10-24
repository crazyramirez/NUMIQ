import { and, eq, isNull } from 'drizzle-orm'

const MAX_BYTES = 2 * 1024 * 1024

/** Logotipo del cliente o proveedor: PNG o JPG de hasta 2 MB (el navegador ya lo envía reducido) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const db = useDb()
  const [contact] = await db.select({ logoPath: tables.contacts.logoPath }).from(tables.contacts)
    .where(and(eq(tables.contacts.id, id), eq(tables.contacts.companyId, company.id), isNull(tables.contacts.archivedAt)))
  if (!contact) throw createError({ statusCode: 404, statusMessage: 'Contacto no encontrado' })
  const parts = await readMultipartFormData(event)
  const file = parts?.find(p => p.name === 'file' && p.data?.length)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'Elige una imagen' })
  if (file.data.length > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: 'La imagen supera 2 MB' })
  const kind = detectImage(file.data)
  if (!kind || kind.ext === 'svg') throw createError({ statusCode: 415, statusMessage: 'Formato no admitido: usa un logo PNG o JPG' })

  const rel = await saveCompanyFile(company.id, 'contacts', file.data, kind.ext)
  await db.update(tables.contacts).set({ logoPath: rel }).where(eq(tables.contacts.id, id))
  await deleteStoredFile(contact.logoPath)
  await audit(event, { companyId: company.id, userId: user.id, action: 'contact.logo', entity: 'contact', entityId: id })
  return { logoUrl: contactLogoUrl(id, rel) }
})
