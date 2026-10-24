import { eq } from 'drizzle-orm'

/** Sube el certificado (.p12/.pfx) con su contraseña: se valida, se cifra y sustituye al anterior */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  // Desactivado por ahora: solo lo usaría VeriFactu, también desactivado
  const CERTIFICATE_ACTIVE = false
  if (!CERTIFICATE_ACTIVE) throw createError({ statusCode: 403, statusMessage: 'El certificado digital está desactivado por ahora' })
  const parts = (await readMultipartFormData(event)) ?? []
  const file = parts.find(p => p.name === 'file' && p.data?.length)
  const password = parts.find(p => p.name === 'password')?.data.toString('utf8') ?? ''
  if (!file) throw createError({ statusCode: 400, statusMessage: 'Elige el archivo .p12 o .pfx del certificado' })
  if (file.data.length > 64 * 1024) throw createError({ statusCode: 413, statusMessage: 'El archivo es demasiado grande para ser un certificado' })
  const { info, keyPem, certPem } = readPkcs12(file.data, password)
  if (info.validTo < new Date()) throw createError({ statusCode: 400, statusMessage: `Este certificado caducó el ${info.validTo.toLocaleDateString('es-ES')}` })

  const db = useDb()
  const old = await db.select({ id: tables.certificates.id, path: tables.certificates.path }).from(tables.certificates).where(eq(tables.certificates.companyId, company.id))
  const path = await saveCompanyFile(company.id, 'certs', sealSecret(Buffer.from(JSON.stringify({ keyPem, certPem }), 'utf8')), 'bin')
  await db.insert(tables.certificates).values({ companyId: company.id, ...info, path, uploadedBy: user.id })
  for (const o of old) {
    await db.delete(tables.certificates).where(eq(tables.certificates.id, o.id))
    await deleteStoredFile(o.path)
  }
  await audit(event, { companyId: company.id, userId: user.id, action: 'certificate.upload', data: { holder: info.holderName, nif: info.holderNif, validTo: info.validTo.toISOString().slice(0, 10), fingerprint: info.fingerprint } })
  return { ok: true, holderName: info.holderName, holderNif: info.holderNif, validTo: info.validTo }
})
