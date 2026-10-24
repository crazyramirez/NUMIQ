/** Importa un extracto bancario (Norma 43, Excel o CSV) y propone la conciliación de cada movimiento */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const parts = (await readMultipartFormData(event)) ?? []
  const file = parts.find(p => p.name === 'file' && p.filename && p.data?.length)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'Elige el archivo del extracto' })
  if (file.data.length > 15 * 1024 * 1024) throw createError({ statusCode: 413, statusMessage: 'El extracto supera 15 MB' })
  const field = (name: string) => parts.find(p => p.name === name)?.data.toString('utf8').trim() || null
  const accountId = Number(field('accountId')) || null
  const r = await importStatement(company, { name: file.filename!, data: file.data }, { accountId, accountName: field('accountName')?.slice(0, 120) ?? null })
  await audit(event, { companyId: company.id, userId: user.id, action: 'bank.import', entity: 'bank_account', entityId: r.accountId, data: { file: file.filename, imported: r.imported, duplicates: r.duplicates } })
  return r
})
