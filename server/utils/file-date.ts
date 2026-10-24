import { PDFDocument, PDFDict, PDFName, PDFString, PDFHexString, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { unzipSync } from 'fflate'
import * as XLSX from 'xlsx'
import exifr from 'exifr'
import { validDocumentDate } from '../../shared/utils/source-date'
import type { SourceFileDate } from '../../shared/utils/source-date'

/** Los timestamps del navegador están en milisegundos UTC; la app usa el calendario español. */
export function timestampFileDate(value: unknown): string | null {
  const ms = typeof value === 'number' ? value : typeof value === 'string' && /^\d{10,16}$/.test(value) ? Number(value) : NaN
  const date = new Date(ms)
  if (!Number.isFinite(ms) || !Number.isFinite(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const part = (type: string) => parts.find(p => p.type === type)?.value
  return validDocumentDate(`${part('year')}-${part('month')}-${part('day')}`)
}

/** Conserva el día escrito en los metadatos (PDF, EXIF o ISO), sin desplazarlo por zona horaria. */
function metadataDate(value: unknown): string | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? validDocumentDate(value.toISOString().slice(0, 10)) : null
  if (typeof value !== 'string') return null
  const match = /^(?:D:)?(\d{4})[-:]?(\d{2})[-:]?(\d{2})(?:[T\s\dZ+\-]|$)/.exec(value.trim())
  return match ? validDocumentDate(`${match[1]}-${match[2]}-${match[3]}`) : null
}

/** Lee las fechas originales; los metadatos dañados nunca impiden importar un archivo legible. */
export async function resolveFileDate(data: Buffer, ext: string, input: { lastModified?: unknown, archiveDate?: SourceFileDate | null, uploadedAt?: Date } = {}): Promise<SourceFileDate> {
  let created: string | null = null
  let modified: string | null = null
  try {
    if (ext === 'pdf') {
      // updateMetadata=false evita que pdf-lib invente fechas al abrir un PDF sin propiedades.
      const pdf = await PDFDocument.load(data, { updateMetadata: false, ignoreEncryption: true })
      const info = pdf.context.lookup(pdf.context.trailerInfo.Info)
      if (info instanceof PDFDict) {
        const read = (key: string) => {
          const value = info.lookup(PDFName.of(key))
          return value instanceof PDFString || value instanceof PDFHexString ? metadataDate(value.decodeText()) : null
        }
        created = read('CreationDate')
        modified = read('ModDate')
      }
      if (!created) {
        const metadata = pdf.catalog.lookup(PDFName.of('Metadata'))
        if (metadata instanceof PDFRawStream) {
          const bytes = decodePDFRawStream(metadata).getBytes(1024 * 1024 + 1)
          if (bytes.length <= 1024 * 1024) {
            const xml = Buffer.from(bytes).toString('utf8')
            const readXmp = (tag: string) => metadataDate(new RegExp(`<xmp:${tag}\\b[^>]*>([^<]+)<|xmp:${tag}\\s*=\\s*["']([^"']+)`, 'i').exec(xml)?.slice(1).find(Boolean))
            created = readXmp('CreateDate')
            modified ??= readXmp('ModifyDate')
          }
        }
      }
    }
    else if (['docx', 'xlsx', 'odt', 'ods'].includes(ext)) {
      const files = unzipSync(data, { filter: f => ['docProps/core.xml', 'meta.xml'].includes(f.name) && f.originalSize <= 1024 * 1024 })
      const xml = Buffer.from(files['docProps/core.xml'] ?? files['meta.xml'] ?? []).toString('utf8')
      created = metadataDate(/<(?:dcterms:created|meta:creation-date)\b[^>]*>([^<]+)</i.exec(xml)?.[1])
      modified = metadataDate(/<(?:dcterms:modified|dc:date)\b[^>]*>([^<]+)</i.exec(xml)?.[1])
    }
    else if (ext === 'xls') {
      const props = XLSX.read(data, { type: 'buffer', bookProps: true }).Props
      created = metadataDate(props?.CreatedDate)
      modified = metadataDate(props?.ModifiedDate)
    }
    else if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
      const metadata = await exifr.parse(data, { reviveValues: false, pick: ['DateTimeOriginal', 'CreateDate', 'DateCreated', 'ModifyDate'], xmp: true })
      created = metadataDate(metadata?.DateTimeOriginal) ?? metadataDate(metadata?.CreateDate) ?? metadataDate(metadata?.DateCreated)
      modified = metadataDate(metadata?.ModifyDate)
    }
  }
  catch {
    // Sin metadatos legibles: usar la fecha original enviada por el navegador o el ZIP.
  }
  if (created) return { date: created, source: 'created' }
  if (input.archiveDate?.source === 'created' && validDocumentDate(input.archiveDate.date)) return input.archiveDate
  if (modified) return { date: modified, source: 'modified' }
  if (input.archiveDate && validDocumentDate(input.archiveDate.date)) return input.archiveDate
  const browserDate = timestampFileDate(input.lastModified)
  if (browserDate) return { date: browserDate, source: 'modified' }
  return { date: timestampFileDate((input.uploadedAt ?? new Date()).getTime())!, source: 'uploaded' }
}

/** Directorio central ZIP: fecha individual de cada entrada, nunca la fecha del contenedor. */
export function zipEntryDates(data: Buffer): Map<string, SourceFileDate> {
  const dates = new Map<string, SourceFileDate>()
  let end = data.length - 22
  for (; end >= Math.max(0, data.length - 65557); end--) {
    if (data.readUInt32LE(end) === 0x06054b50 && end + 22 + data.readUInt16LE(end + 20) === data.length) break
  }
  if (end < 0 || data.length < end + 22 || data.readUInt32LE(end) !== 0x06054b50) return dates
  let offset = data.readUInt32LE(end + 16)
  const count = data.readUInt16LE(end + 10)
  for (let i = 0; i < count && offset + 46 <= data.length && data.readUInt32LE(offset) === 0x02014b50; i++) {
    const nameLength = data.readUInt16LE(offset + 28), extraLength = data.readUInt16LE(offset + 30), commentLength = data.readUInt16LE(offset + 32)
    const extraStart = offset + 46 + nameLength, extraEnd = extraStart + extraLength
    if (extraEnd + commentLength > data.length) break
    const name = data.subarray(offset + 46, extraStart).toString(data.readUInt16LE(offset + 8) & 0x800 ? 'utf8' : 'latin1')
    const dos = data.readUInt16LE(offset + 14)
    const date = validDocumentDate(`${1980 + (dos >> 9)}-${String((dos >> 5) & 15).padStart(2, '0')}-${String(dos & 31).padStart(2, '0')}`)
    let result: SourceFileDate | null = date ? { date, source: 'modified' } : null
    // Extra NTFS: conserva el instante de creación cuando el ZIP lo incluye.
    for (let p = extraStart; p + 4 <= extraEnd;) {
      const id = data.readUInt16LE(p), size = data.readUInt16LE(p + 2), next = p + 4 + size
      if (next > extraEnd) break
      if (id === 0x000a && size >= 32 && data.readUInt16LE(p + 8) === 1 && data.readUInt16LE(p + 10) >= 24) {
        const ticks = data.readBigUInt64LE(p + 20)
        const created = timestampFileDate(Number(ticks / 10000n - 11644473600000n))
        if (created) result = { date: created, source: 'created' }
      }
      p = next
    }
    if (result) dates.set(name, result)
    offset = extraEnd + commentLength
  }
  return dates
}
