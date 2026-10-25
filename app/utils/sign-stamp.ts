/**
 * Estampado de firmas en el navegador. Las posiciones llegan como fracciones de la página tal como se ve
 * (ya girada): x, y = esquina superior izquierda; w = ancho; el alto sale de la proporción de la firma.
 */
export interface StampPlacement {
  page: number
  x: number
  y: number
  w: number
  /** Alto / ancho de la imagen de la firma */
  ratio: number
  key: string
}

/** PDF firmado: cada firma se dibuja como imagen sobre su página, respetando el giro (/Rotate) y la caja visible */
export async function stampPdf(data: ArrayBuffer, placements: StampPlacement[], png: (key: string) => Promise<Uint8Array>) {
  const { PDFDocument, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } = await import('pdf-lib')
  let doc: Awaited<ReturnType<typeof PDFDocument.load>>
  try {
    doc = await PDFDocument.load(data.slice(0), { updateMetadata: false })
  }
  catch (err) {
    if (/encrypt/i.test((err as Error)?.message ?? '')) throw new Error('Este PDF está protegido con contraseña y no se puede modificar.')
    throw new Error('No se pudo leer el PDF para firmarlo.')
  }
  const images = new Map<string, Awaited<ReturnType<typeof doc.embedPng>>>()
  const wrapped = new Set<number>()
  for (const p of placements) {
    let img = images.get(p.key)
    if (!img) {
      img = await doc.embedPng(await png(p.key))
      images.set(p.key, img)
    }
    const page = doc.getPage(p.page)
    // El contenido original va entre q/Q: si deja la matriz cambiada, la firma no se desplaza
    if (!wrapped.has(p.page)) {
      wrapped.add(p.page)
      page.node.normalize()
      const start = doc.context.register(doc.context.contentStream([pushGraphicsState()]))
      const end = doc.context.register(doc.context.contentStream([popGraphicsState()]))
      page.node.wrapContentStreams(start, end)
    }
    const rot = (((page.getRotation().angle % 360) + 360) % 360)
    const box = page.getCropBox()
    const W = box.width
    const H = box.height
    const turned = rot === 90 || rot === 270
    const dw = turned ? H : W
    const dh = turned ? W : H
    // De la página vista (origen arriba a la izquierda) al espacio del PDF (origen abajo a la izquierda, sin girar)
    const toPdf = (dx: number, dy: number): [number, number] => {
      if (rot === 90) return [box.x + dy, box.y + dx]
      if (rot === 180) return [box.x + W - dx, box.y + dy]
      if (rot === 270) return [box.x + W - dy, box.y + H - dx]
      return [box.x + dx, box.y + H - dy]
    }
    const u0 = p.x * dw
    const v0 = p.y * dh
    const wd = p.w * dw
    const hd = wd * p.ratio
    const o = toPdf(u0, v0 + hd)
    const ex = toPdf(u0 + wd, v0 + hd)
    const ey = toPdf(u0, v0)
    const name = page.node.newXObject('Firma', img.ref)
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1]),
      drawObject(name),
      popGraphicsState(),
    )
  }
  return await doc.save()
}

/** Imagen firmada: la misma imagen a su tamaño real con las firmas encima, en su formato (WebP → PNG si el navegador no lo genera) */
export async function stampImage(src: string, mime: string, placements: StampPlacement[], image: (key: string) => Promise<HTMLImageElement>) {
  const base = await loadImage(src)
  const canvas = document.createElement('canvas')
  canvas.width = base.naturalWidth
  canvas.height = base.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(base, 0, 0)
  ctx.imageSmoothingQuality = 'high'
  for (const p of placements) {
    const sig = await image(p.key)
    const w = p.w * canvas.width
    ctx.drawImage(sig, p.x * canvas.width, p.y * canvas.height, w, w * p.ratio)
  }
  const type = mime === 'image/jpeg' || mime === 'image/webp' ? mime : 'image/png'
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, 0.95))
  if (blob && blob.type === type) return blob
  return await canvasPng(canvas)
}
