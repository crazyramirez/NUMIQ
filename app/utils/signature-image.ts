/**
 * Imágenes de firma en el navegador: todo acaba en un PNG con fondo transparente y recortado a la tinta,
 * listo para estamparse sobre un documento.
 */

export const INK_COLORS = [
  { id: 'black', label: 'Negro', value: '#16181d' },
  { id: 'blue', label: 'Azul', value: '#1e40c4' },
  { id: 'navy', label: 'Azul marino', value: '#0f2557' },
] as const

/** Letras manuscritas para escribir la firma (las carga @fontsource al usarse) */
export const SIGNATURE_FONTS = [
  { id: 'great-vibes', label: 'Elegante', family: 'Great Vibes', size: 1 },
  { id: 'mr-dafoe', label: 'Firma', family: 'Mr Dafoe', size: 1.05 },
  { id: 'homemade-apple', label: 'Manuscrita', family: 'Homemade Apple', size: 0.72 },
  { id: 'caveat', label: 'Sencilla', family: 'Caveat', size: 1 },
] as const

/**
 * Recorta un lienzo a lo que tiene tinta, con un margen. Null si está vacío. Con `minFrac`, una fila o
 * columna solo cuenta si tiene esa fracción de píxeles con tinta: así las motas del papel de una foto
 * no estiran el recorte y la firma queda centrada y grande.
 */
export function trimInk(src: HTMLCanvasElement, pad = 6, opts: { alphaMin?: number, minFrac?: number } = {}): HTMLCanvasElement | null {
  const ctx = src.getContext('2d', { willReadFrequently: true })!
  const { width: w, height: h } = src
  const data = ctx.getImageData(0, 0, w, h).data
  const alphaMin = opts.alphaMin ?? 8
  const rows = new Uint32Array(h)
  const cols = new Uint32Array(w)
  for (let y = 0; y < h; y++) {
    const row = y * w * 4
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3]! > alphaMin) {
        rows[y]!++
        cols[x]!++
      }
    }
  }
  const rowMin = Math.max(1, Math.round(w * (opts.minFrac ?? 0)))
  const colMin = Math.max(1, Math.round(h * (opts.minFrac ?? 0)))
  let top = 0
  while (top < h && rows[top]! < rowMin) top++
  let bottom = h - 1
  while (bottom > top && rows[bottom]! < rowMin) bottom--
  let left = 0
  while (left < w && cols[left]! < colMin) left++
  let right = w - 1
  while (right > left && cols[right]! < colMin) right--
  if (top >= h || left >= w) return null
  const x0 = Math.max(0, left - pad)
  const y0 = Math.max(0, top - pad)
  const x1 = Math.min(w, right + pad + 1)
  const y1 = Math.min(h, bottom + pad + 1)
  const out = document.createElement('canvas')
  out.width = x1 - x0
  out.height = y1 - y0
  out.getContext('2d')!.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
  return out
}

/** Reduce el lienzo para que quepa en maxW × maxH (nunca lo amplía), con suavizado de calidad */
export function fitCanvas(src: HTMLCanvasElement, maxW: number, maxH: number) {
  const k = Math.min(1, maxW / src.width, maxH / src.height)
  if (k >= 1) return src
  // A mitades sucesivas: reducir mucho de una vez deja el trazo dentado
  const target = src.width * k
  let cur = src
  while (target < cur.width / 2) {
    const half = document.createElement('canvas')
    half.width = Math.max(1, Math.round(cur.width / 2))
    half.height = Math.max(1, Math.round(cur.height / 2))
    const c = half.getContext('2d')!
    c.imageSmoothingQuality = 'high'
    c.drawImage(cur, 0, 0, half.width, half.height)
    cur = half
  }
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(src.width * k))
  out.height = Math.max(1, Math.round(src.height * k))
  const c = out.getContext('2d')!
  c.imageSmoothingQuality = 'high'
  c.drawImage(cur, 0, 0, out.width, out.height)
  return out
}

export function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('png'))), 'image/png'))
}

/** ¿La imagen ya trae transparencia? (PNG de una firma ya recortada) */
function hasTransparency(data: Uint8ClampedArray) {
  let clear = 0
  for (let i = 3; i < data.length; i += 4 * 7) if (data[i]! < 250) clear++
  return clear > data.length / (4 * 7) / 50
}

/**
 * Firma a partir de una foto o un escaneo: el papel se vuelve transparente y queda solo el trazo.
 * El fondo y la tinta se estiman de la propia imagen (percentiles de luminosidad), así funciona con
 * fotos algo oscuras o papel amarillento. `ink` recolorea el trazo; null conserva su color.
 */
export function signatureFromImage(img: CanvasImageSource & { width: number, height: number }, opts: { removeBackground: boolean, ink: string | null, maxSide?: number }) {
  const max = opts.maxSide ?? 2400
  const k = Math.min(1, max / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.width * k))
  canvas.height = Math.max(1, Math.round(img.height * k))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = image.data
  const transparent = hasTransparency(d)
  const rgb = opts.ink ? hexRgb(opts.ink) : null

  if (opts.removeBackground && !transparent) {
    const hist = new Uint32Array(256)
    const lum = new Uint8Array(d.length / 4)
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const l = Math.round(0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!)
      lum[p] = l
      hist[l]!++
    }
    const pct = (q: number) => {
      const target = lum.length * q
      let acc = 0
      for (let v = 0; v < 256; v++) {
        acc += hist[v]!
        if (acc >= target) return v
      }
      return 255
    }
    const paper = pct(0.6)
    // Percentil muy bajo: en una foto la firma puede ocupar menos del 1 % de los píxeles
    const ink = Math.min(pct(0.002), paper - 40)
    // Rampa suave entre la tinta y el papel: bordes limpios sin dientes
    const hi = paper - (paper - ink) * 0.18
    const lo = ink + (paper - ink) * 0.25
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const l = lum[p]!
      const a = l >= hi ? 0 : l <= lo ? 1 : (hi - l) / (hi - lo)
      // Lo casi transparente es textura o sombra del papel: fuera
      const alpha = Math.round(a * a * (3 - 2 * a) * 255)
      d[i + 3] = alpha < 28 ? 0 : alpha
      if (rgb) {
        d[i] = rgb[0]
        d[i + 1] = rgb[1]
        d[i + 2] = rgb[2]
      }
      else {
        // Se oscurece un poco el trazo: en la foto la tinta sale lavada por el papel
        const f = 0.82
        d[i] = Math.round(d[i]! * f)
        d[i + 1] = Math.round(d[i + 1]! * f)
        d[i + 2] = Math.round(d[i + 2]! * f)
      }
    }
  }
  else if (rgb) {
    for (let i = 0; i < d.length; i += 4) {
      d[i] = rgb[0]
      d[i + 1] = rgb[1]
      d[i + 2] = rgb[2]
    }
  }
  if (opts.removeBackground && !transparent) removeSpecks(d, canvas.width, canvas.height)
  ctx.putImageData(image, 0, 0)
  // Recorte a la firma (ignorando motas sueltas) con un margen proporcional, y tamaño final acotado
  const cleaned = (opts.removeBackground || transparent)
    ? trimInk(canvas, Math.round(Math.max(canvas.width, canvas.height) * 0.012), { alphaMin: 60, minFrac: 0.002 }) ?? canvas
    : canvas
  return fitCanvas(cleaned, SIGNATURE_MAX.w, SIGNATURE_MAX.h)
}

/**
 * Quita las motas sueltas (polvo, grano del papel, puntos de la foto): manchas de tinta aisladas y
 * diminutas frente al trazo principal. Los puntos de las íes y los acentos se quedan.
 */
function removeSpecks(d: Uint8ClampedArray, w: number, h: number) {
  const n = w * h
  const label = new Int32Array(n)
  const queue = new Int32Array(n)
  const areas: number[] = [0]
  for (let start = 0; start < n; start++) {
    if (label[start] || d[start * 4 + 3]! <= 60) continue
    const id = areas.length
    let head = 0
    let tail = 0
    queue[tail++] = start
    label[start] = id
    while (head < tail) {
      const p = queue[head++]!
      const x = p % w
      const y = (p - x) / w
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          const q = yy * w + xx
          if (!label[q] && d[q * 4 + 3]! > 60) {
            label[q] = id
            queue[tail++] = q
          }
        }
      }
    }
    areas.push(tail)
  }
  let largest = 0
  for (const a of areas) if (a > largest) largest = a
  const min = Math.max(16, largest * 0.004)
  for (let p = 0; p < n; p++) {
    const id = label[p]!
    if (id && areas[id]! < min) d[p * 4 + 3] = 0
  }
}

/** Firma escrita con una letra manuscrita, a buena resolución */
export async function typedSignature(text: string, family: string, color: string, sizeFactor = 1) {
  const px = Math.round(150 * sizeFactor)
  const font = `${px}px "${family}"`
  await document.fonts.load(font, text).catch(() => {})
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = font
  const m = measure.measureText(text)
  const canvas = document.createElement('canvas')
  // Margen amplio: las letras manuscritas sobresalen de su caja (rabos, mayúsculas con florituras)
  canvas.width = Math.ceil(m.width + px * 1.4)
  canvas.height = Math.ceil(px * 2.4)
  const ctx = canvas.getContext('2d')!
  ctx.font = font
  ctx.fillStyle = color
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(text, px * 0.7, px * 1.55)
  const trimmed = trimInk(canvas, 8)
  return trimmed && fitCanvas(trimmed, SIGNATURE_MAX.w, SIGNATURE_MAX.h)
}

/** Sello de texto (la fecha de hoy) en tinta, para colocarlo junto a la firma */
export async function textStamp(text: string, color: string) {
  const px = 64
  const font = `500 ${px}px "Inter Variable", Inter, system-ui, sans-serif`
  await document.fonts.load(font, text).catch(() => {})
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = font
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(measure.measureText(text).width + px)
  canvas.height = Math.ceil(px * 1.6)
  const ctx = canvas.getContext('2d')!
  ctx.font = font
  ctx.fillStyle = color
  ctx.fillText(text, px / 2, px * 1.15)
  return trimInk(canvas, 6)
}

function hexRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('No se pudo leer la imagen'))
    img.src = src
  })
}

/** Tamaño final de una firma: nítida al imprimir y ligera (≈ 4,5 × 1,5 cm a 300 ppp) */
export const SIGNATURE_MAX = { w: 1400, h: 520 }
