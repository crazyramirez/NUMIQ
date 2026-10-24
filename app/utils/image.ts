/**
 * Reduce una imagen en el navegador antes de subirla: como mucho `max` píxeles por lado.
 * JPEG para fotos (ligero); PNG solo si tiene transparencia de verdad. Los SVG se convierten a imagen.
 * Con `trim` se recorta el margen vacío (transparente o blanco) que suelen traer los logotipos.
 */
export async function resizeImage(file: Blob, max = 800, opts: { trim?: boolean } = {}): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('No se pudo leer la imagen: prueba con una foto JPG o PNG'))
      i.src = url
    })
    let w0 = img.naturalWidth || max
    let h0 = img.naturalHeight || max
    // Un SVG es vectorial: se dibuja al tamaño máximo (logos de 100 px no salen borrosos)
    const vector = /svg/i.test(file.type)
    let src: CanvasImageSource = img
    let sx = 0
    let sy = 0
    if (opts.trim) {
      const box = contentBox(img, w0, h0, vector ? max * 2 : Math.min(1600, Math.max(w0, h0)))
      if (box) {
        src = box.canvas
        ;({ x: sx, y: sy, w: w0, h: h0 } = box)
      }
    }
    const scale = vector && src === img ? max / Math.max(w0, h0) : Math.min(1, max / Math.max(w0, h0))
    const w = Math.max(1, Math.round(w0 * scale))
    const h = Math.max(1, Math.round(h0 * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Tu navegador no puede procesar imágenes')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(src, sx, sy, w0, h0, 0, 0, w, h)
    let transparent = false
    if (!/jpe?g/i.test(file.type)) {
      const d = ctx.getImageData(0, 0, w, h).data
      for (let i = 3; i < d.length; i += 16) {
        if (d[i]! < 250) {
          transparent = true
          break
        }
      }
    }
    if (!transparent) {
      // Fondo blanco bajo la imagen: el JPEG no tiene transparencia
      ctx.globalCompositeOperation = 'destination-over'
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
    }
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error('No se pudo procesar la imagen'))),
      transparent ? 'image/png' : 'image/jpeg',
      0.86,
    ))
  }
  finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Caja del contenido sin el margen vacío, sobre un lienzo de trabajo de `side` px como mucho.
 * Devuelve null si no hay nada que recortar.
 */
function contentBox(img: HTMLImageElement, w0: number, h0: number, side: number) {
  const k = side / Math.max(w0, h0)
  const W = Math.max(1, Math.round(w0 * k))
  const H = Math.max(1, Math.round(h0 * k))
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, W, H)
  const d = ctx.getImageData(0, 0, W, H).data
  // Con transparencia solo sobra lo transparente (un texto blanco es parte del logo);
  // sin ella, solo un fondo blanco (un fondo de color es parte del diseño)
  const corners = [0, W - 1, (H - 1) * W, H * W - 1].map(p => p * 4)
  const alpha = corners.some(i => d[i + 3]! < 250)
  const white = (i: number) => d[i]! > 244 && d[i + 1]! > 244 && d[i + 2]! > 244
  if (!alpha && !corners.every(white)) return null
  let x0 = W
  let y0 = H
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      if (alpha ? d[i + 3]! < 16 : white(i)) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (x1 < 0) return null
  // Un respiro alrededor para que el logo no toque el borde
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04)
  x0 = Math.max(0, x0 - pad)
  y0 = Math.max(0, y0 - pad)
  x1 = Math.min(W - 1, x1 + pad)
  y1 = Math.min(H - 1, y1 + pad)
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  if (w >= W * 0.97 && h >= H * 0.97) return null
  return { canvas, x: x0, y: y0, w, h }
}
