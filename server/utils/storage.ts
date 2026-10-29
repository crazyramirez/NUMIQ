import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, resolve, sep } from 'node:path'

/** Carpeta de archivos subidos (logos, escaneos, documentos del archivo trimestral) */
export function uploadsRoot() {
  return resolve(process.cwd(), useRuntimeConfig().uploadsDir || './storage/uploads')
}

/** Ruta absoluta de un archivo guardado, sin salir de la carpeta de subidas */
function absolute(rel: string) {
  const root = uploadsRoot()
  const p = normalize(join(root, rel))
  if (p !== root && !p.startsWith(root + sep)) throw createError({ statusCode: 400, statusMessage: 'Ruta de archivo no válida' })
  return p
}

export async function saveCompanyFile(companyId: number, folder: string, data: Buffer, ext: string) {
  const rel = `${companyId}/${folder}/${Date.now().toString(36)}-${randomBytes(6).toString('hex')}.${ext}`
  const p = absolute(rel)
  await mkdir(dirname(p), { recursive: true })
  await writeFile(p, data)
  return rel
}

export const readStoredFile = (rel: string) => readFile(absolute(rel))

export async function deleteStoredFile(rel: string | null | undefined) {
  if (rel) await rm(absolute(rel), { force: true }).catch(() => {})
}

/** Todos los archivos de una empresa (logos, escaneos, adjuntos, firmas…): al eliminarla con la cuenta */
export async function deleteCompanyFolder(companyId: number) {
  if (!Number.isInteger(companyId) || companyId <= 0) return
  await rm(absolute(String(companyId)), { recursive: true, force: true }).catch(() => {})
}

/** Quita una carpeta de subidas si se ha quedado vacía (si no, la deja como está) */
export async function removeEmptyFolder(rel: string) {
  await rmdir(absolute(rel)).catch(() => {})
}

export type ImageKind = { ext: 'png' | 'jpg' | 'svg', mime: string }

/**
 * Tipo real de una imagen por su contenido (no por la extensión). Los SVG con scripts, manejadores
 * de eventos o enlaces javascript: se rechazan: se sirven desde nuestro dominio.
 */
export function detectImage(data: Buffer): ImageKind | null {
  if (data.length > 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return { ext: 'png', mime: 'image/png' }
  if (data.length > 3 && data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) return { ext: 'jpg', mime: 'image/jpeg' }
  const head = data.subarray(0, 4096).toString('utf8').trimStart().toLowerCase()
  if ((head.startsWith('<svg') || head.startsWith('<?xml')) && head.includes('<svg')) {
    const text = data.toString('utf8').toLowerCase()
    if (/<script|<foreignobject|\son[a-z]+\s*=|javascript:|<iframe|<embed|<object/.test(text)) return null
    return { ext: 'svg', mime: 'image/svg+xml' }
  }
  return null
}

/** Ancho y alto en píxeles de un PNG o JPG (null si no se puede leer) */
export function imageSize(data: Buffer): { width: number, height: number } | null {
  const kind = detectImage(data)
  if (kind?.ext === 'png' && data.length >= 24) return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
  if (kind?.ext !== 'jpg') return null
  // Marcadores JPEG hasta el SOF (C0–CF salvo C4, C8 y CC), que lleva alto y ancho
  let i = 2
  while (i + 9 < data.length) {
    if (data[i] !== 0xFF) return null
    const marker = data[i + 1]!
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      return { width: data.readUInt16BE(i + 7), height: data.readUInt16BE(i + 5) }
    }
    i += 2 + data.readUInt16BE(i + 2)
  }
  return null
}

/** Logo de la empresa como data URL (para el PDF) o null */
export async function companyLogo(logoPath: string | null | undefined) {
  if (!logoPath) return null
  try {
    const data = await readStoredFile(logoPath)
    const kind = detectImage(data)
    if (!kind) return null
    return kind.ext === 'svg'
      ? { kind, svg: data.toString('utf8'), dataUrl: `data:${kind.mime};base64,${data.toString('base64')}` }
      : { kind, svg: null, dataUrl: `data:${kind.mime};base64,${data.toString('base64')}` }
  }
  catch {
    return null
  }
}
