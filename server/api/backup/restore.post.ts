import { restoreFullClone } from '../../utils/clone'

export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')

  const files = await readMultipartFormData(event)
  const cloneFile = files?.find(f => f.name === 'file' || f.filename?.endsWith('.zip'))

  if (!cloneFile || !cloneFile.data) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Debes seleccionar un archivo .zip de clonación generado por NUMIQ.',
    })
  }

  try {
    const result = await restoreFullClone(cloneFile.data)

    await audit(event, {
      companyId: company.id,
      userId: user.id,
      action: 'backup.restore',
      data: result,
    })

    return result
  }
  catch (err: any) {
    console.error('[restore] Error restaurando clon:', err)
    throw createError({
      statusCode: 400,
      statusMessage: err.message || 'No se pudo restaurar el archivo de clonación.',
    })
  }
})
