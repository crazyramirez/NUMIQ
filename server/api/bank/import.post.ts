/** Importa un extracto bancario (Norma 43, Excel o CSV) y propone la conciliación de cada movimiento */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompanyOrAdvisor(event, 'bank')
  const parts = (await readMultipartFormData(event)) ?? []
  const file = parts.find(p => p.name === 'file' && p.filename && p.data?.length)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'Elige el archivo del extracto' })
  if (file.data.length > 15 * 1024 * 1024) throw createError({ statusCode: 413, statusMessage: 'El extracto supera 15 MB' })
  const field = (name: string) => parts.find(p => p.name === name)?.data.toString('utf8').trim() || null
  const accountId = Number(field('accountId')) || null
  const r = await importStatement(company, { name: file.filename!, data: file.data }, { accountId, accountName: field('accountName')?.slice(0, 120) ?? null })
  const archived = await archiveStatement(company.id, user.id, { filename: file.filename!, data: file.data }, r)
  await audit(event, { companyId: company.id, userId: user.id, action: 'bank.import', entity: 'bank_account', entityId: r.accountId, data: { file: file.filename, imported: r.imported, duplicates: r.duplicates, archived: archived?.id ?? null } })
  return { ...r, archived }
})

/**
 * El extracto también queda en Documentos → Archivo → Banco, en el trimestre en que acaba (el que pide la
 * gestoría), con la cuenta y el periodo en la nota. Si ese mismo archivo ya está guardado, no se duplica.
 */
async function archiveStatement(companyId: number, userId: number, file: { filename: string, data: Buffer }, r: { accountName: string, from: string, to: string }) {
  const year = Number(r.to.slice(0, 4))
  const quarter = Math.floor((Number(r.to.slice(5, 7)) - 1) / 3) + 1
  const esDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '')
  const period = r.from === r.to ? esDate(r.from) : `del ${esDate(r.from)} al ${esDate(r.to)}`
  try {
    const id = await saveVaultFile(companyId, userId, file, { folder: 'banco', year, quarter, notes: `${r.accountName} · ${period}`.slice(0, 255) })
    return { id, year, quarter, already: false }
  }
  catch (err) {
    // Ya archivado (mismo archivo): nada que hacer. Cualquier otro fallo no deshace la importación
    if ((err as { statusCode?: number }).statusCode === 409) return { id: null, year, quarter, already: true }
    console.warn('[bank] No se pudo archivar el extracto:', err)
    return null
  }
}
