import { eq } from 'drizzle-orm'

const MAX_BYTES = 2 * 1024 * 1024

/** Logo de la empresa: PNG, JPG o SVG de hasta 2 MB (el tipo se comprueba por el contenido) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  const parts = await readMultipartFormData(event)
  const file = parts?.find(p => p.name === 'file' && p.data?.length)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'Elige una imagen' })
  if (file.data.length > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: 'La imagen supera 2 MB' })
  const kind = detectImage(file.data)
  if (!kind) throw createError({ statusCode: 415, statusMessage: 'Formato no admitido: usa PNG, JPG o SVG' })

  const rel = await saveCompanyFile(company.id, 'logo', file.data, kind.ext)
  await useDb().update(tables.companies).set({ logoPath: rel }).where(eq(tables.companies.id, company.id))
  await deleteStoredFile(company.logoPath)
  await audit(event, { companyId: company.id, userId: user.id, action: 'company.logo' })
  return { logoUrl: `/api/company/logo?v=${encodeURIComponent(rel.split('/').pop() ?? '')}` }
})
