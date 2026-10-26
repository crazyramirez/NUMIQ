/** Sube documentos al archivo de un trimestre y carpeta (el gestor, a las carpetas que tenga permitidas) */
export default defineEventHandler(async (event) => {
  const { company, user, role } = await requireCompany(event, 'advisor')
  const parts = (await readMultipartFormData(event)) ?? []
  const files = parts.filter(p => p.name === 'files' && p.filename && p.data?.length)
  if (!files.length) throw createError({ statusCode: 400, statusMessage: 'Elige al menos un archivo' })
  if (files.length > 30) throw createError({ statusCode: 400, statusMessage: 'Máximo 30 archivos a la vez' })
  const field = (name: string) => parts.find(p => p.name === name)?.data.toString('utf8')
  const r = vaultMetaSchema.safeParse({ folder: field('folder'), year: field('year'), quarter: field('quarter'), notes: field('notes') })
  if (!r.success) throw createError({ statusCode: 400, statusMessage: r.error.issues[0]!.message })
  // El gestor sube a las carpetas que la empresa le permite (nóminas, impuestos…)
  assertAdvisorCan(company, role, vaultFolderAccess(r.data.folder))
  const ids: number[] = []
  const skipped: Array<{ name: string, reason: string }> = []
  for (const f of files) {
    try {
      ids.push(await saveVaultFile(company.id, user.id, f, r.data))
    }
    catch (err) {
      skipped.push({ name: f.filename!, reason: (err as { statusMessage?: string }).statusMessage ?? 'No se pudo guardar' })
    }
  }
  await audit(event, { companyId: company.id, userId: user.id, action: 'vault.upload', entity: 'file', data: { ids, folder: r.data.folder, period: `${r.data.year}-${r.data.quarter}T` } })
  return { ids, skipped }
})
