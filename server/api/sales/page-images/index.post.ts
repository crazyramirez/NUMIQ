const MAX_BYTES = 6 * 1024 * 1024

/**
 * Imagen para una página adicional de factura o presupuesto: PNG o JPG de hasta 6 MB (el navegador
 * ya la envía reducida). Devuelve su nombre y su tamaño en píxeles para colocarla en la hoja.
 */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const parts = await readMultipartFormData(event)
  const data = parts?.find(p => p.name === 'file' && p.data?.length)?.data
  if (!data) throw createError({ statusCode: 400, statusMessage: 'Elige una imagen' })
  if (data.length > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: 'La imagen supera 6 MB' })
  const kind = detectImage(data)
  if (!kind || kind.ext === 'svg') throw createError({ statusCode: 415, statusMessage: 'Formato no admitido: usa una imagen JPG o PNG' })
  const size = imageSize(data)
  if (!size?.width || !size.height) throw createError({ statusCode: 415, statusMessage: 'No se pudo leer la imagen: prueba con otra JPG o PNG' })

  const img = await savePageImage(company.id, data, kind.ext)
  await audit(event, { companyId: company.id, userId: user.id, action: 'sales.page_image', data: { img } })
  return { img, w: size.width, h: size.height }
})
