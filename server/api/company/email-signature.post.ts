import { eq } from 'drizzle-orm'

const MAX_BYTES = 1024 * 1024

/**
 * Imagen de la firma de los correos: PNG o JPG de hasta 1 MB. Gmail y Outlook no muestran SVG:
 * el navegador los convierte a PNG antes de subirlos (también el logo de la empresa).
 */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  const parts = await readMultipartFormData(event)
  const data = parts?.find(p => p.name === 'file' && p.data?.length)?.data
  if (!data) throw createError({ statusCode: 400, statusMessage: 'Elige una imagen' })
  if (data.length > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: 'La imagen supera 1 MB' })
  const kind = detectImage(data)
  if (!kind || kind.ext === 'svg') throw createError({ statusCode: 415, statusMessage: kind ? 'Los correos no muestran SVG: usa un PNG o JPG' : 'Formato no admitido: usa PNG o JPG' })

  const rel = await saveCompanyFile(company.id, 'logo', data, kind.ext)
  await useDb().update(tables.companies).set({ emailSignaturePath: rel }).where(eq(tables.companies.id, company.id))
  await deleteStoredFile(company.emailSignaturePath)
  await audit(event, { companyId: company.id, userId: user.id, action: 'company.email_signature' })
  return { imageUrl: signatureImageUrl(rel) }
})
