import { unzipSync } from 'fflate'
import * as XLSX from 'xlsx'
import { zipEntryDates } from './file-date'
import type { SourceFileDate } from '../../shared/utils/source-date'

/**
 * Lectura de los formatos que se importan: el PDF y las imágenes los lee la IA directamente;
 * Word, Excel, CSV, XML y ZIP se abren aquí.
 */

export type ImportFamily = 'pdf' | 'image' | 'word' | 'sheet' | 'text' | 'zip'

export interface ImportKind {
  ext: string
  mime: string
  family: ImportFamily
}

const SHEET_EXT = new Set(['xlsx', 'xls', 'ods', 'csv', 'tsv'])

/** Tipo de un archivo a importar por su contenido. Null = formato no admitido */
export function importKind(data: Buffer, name: string): ImportKind | null {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  if (ext === 'xml' || ext === 'xsig') {
    const head = data.subarray(0, 512).toString('utf8').trimStart()
    if (head.startsWith('<')) return { ext: 'xml', mime: 'application/xml', family: 'text' }
  }
  if (ext === 'tsv' && !data.subarray(0, 4096).includes(0)) return { ext, mime: 'text/tab-separated-values', family: 'sheet' }
  const doc = detectDocument(data, name)
  if (!doc) return null
  if (doc.ext === 'pdf') return { ...doc, family: 'pdf' }
  if (['png', 'jpg', 'webp'].includes(doc.ext)) return { ...doc, family: 'image' }
  if (['docx', 'odt', 'doc'].includes(doc.ext)) return { ...doc, family: 'word' }
  if (SHEET_EXT.has(doc.ext)) return { ...doc, family: 'sheet' }
  if (doc.ext === 'txt') return { ...doc, family: 'text' }
  if (doc.ext === 'zip') return { ...doc, family: 'zip' }
  return null
}

/** Texto en UTF-8 o, si no lo es, en Windows-1252 (CSV exportados por programas de Windows) */
export function decodeText(data: Uint8Array) {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data)
  }
  catch {
    text = new TextDecoder('windows-1252').decode(data)
  }
  return text.replace(/^﻿/, '')
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' }

function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1))
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/** XML de un documento de texto (Word u OpenDocument) a texto plano conservando párrafos y tablas */
function documentXmlToText(xml: string) {
  return decodeEntities(
    xml
      .replace(/<w:tab\/>|<text:tab\/>/g, '\t')
      .replace(/<w:br\/>|<text:line-break\/>/g, '\n')
      .replace(/<\/w:tc>|<\/table:table-cell>/g, ' | ')
      .replace(/<\/w:p>|<\/text:p>|<\/text:h>|<\/w:tr>|<\/table:table-row>/g, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export interface WordContent {
  text: string
  /** Imágenes incrustadas (facturas escaneadas pegadas en un Word) */
  images: Array<{ name: string, data: Buffer, mime: string }>
}

/** DOCX / ODT: texto del cuerpo, cabeceras y pies (donde suelen ir los datos fiscales) */
export function readWordZip(data: Buffer, ext: string): WordContent {
  const files = unzipSync(new Uint8Array(data), {
    filter: f => f.originalSize < 40 * 1024 * 1024 && (/\.xml$/.test(f.name) || /^(word\/media|Pictures)\//.test(f.name)),
  })
  const names = Object.keys(files)
  const pick = ext === 'odt'
    ? ['styles.xml', 'content.xml']
    : [...names.filter(n => /^word\/header\d*\.xml$/.test(n)), 'word/document.xml', ...names.filter(n => /^word\/footer\d*\.xml$/.test(n))]
  const text = pick.filter(n => files[n]).map(n => documentXmlToText(new TextDecoder().decode(files[n]))).filter(Boolean).join('\n\n')
  const images = names
    .filter(n => /\.(png|jpe?g)$/i.test(n))
    .map(n => ({ name: n, data: Buffer.from(files[n]!), mime: /\.png$/i.test(n) ? 'image/png' : 'image/jpeg' }))
    .sort((a, b) => b.data.length - a.data.length)
  return { text, images }
}

/**
 * Word 97-2003 (.doc): formato binario. Se recuperan los fragmentos de texto legibles
 * (UTF-16 y ANSI); suficiente para que la IA lea una factura.
 */
export function readLegacyDoc(data: Buffer): WordContent {
  const utf16: string[] = []
  let run = ''
  for (let i = 0; i + 1 < data.length; i += 2) {
    const code = data[i]! | (data[i + 1]! << 8)
    const printable = (code >= 0x20 && code < 0xD800 && code !== 0xFFFF) || code === 0x0D || code === 0x09
    if (printable) run += code === 0x0D ? '\n' : String.fromCharCode(code)
    else {
      if (run.replace(/\s/g, '').length >= 4) utf16.push(run)
      run = ''
    }
  }
  if (run.replace(/\s/g, '').length >= 4) utf16.push(run)
  const ansi = decodeText(data).match(/[\p{L}\p{N}\p{P}\p{Zs}€$%\t\r\n]{6,}/gu) ?? []
  // Texto con letras latinas: el que tenga más es el bueno
  const score = (parts: string[]) => parts.join('').replace(/[^a-záéíóúñü0-9]/gi, '').length
  const best = score(utf16) >= score(ansi) ? utf16 : ansi
  return { text: best.join('\n').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 200_000), images: [] }
}

/** Celda de una hoja: las fechas de Excel llegan ya como 'AAAA-MM-DD' */
export type SheetCell = string | number | boolean | null

export interface SheetData {
  name: string
  rows: SheetCell[][]
}

const MAX_SHEET_ROWS = 20_000

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Fecha de Excel (número de serie) a 'AAAA-MM-DD' sin pasar por zonas horarias */
export function excelSerialDate(serial: number) {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null
  const d = XLSX.SSF.parse_date_code(serial)
  return d ? `${d.y}-${pad2(d.m)}-${pad2(d.d)}` : null
}

function cellValue(cell: XLSX.CellObject | undefined): SheetCell {
  if (!cell || cell.v == null || cell.t === 'e' || cell.t === 'z') return null
  if (cell.t === 'n' && typeof cell.v === 'number' && cell.z && XLSX.SSF.is_date(cell.z)) return excelSerialDate(cell.v)
  if (cell.t === 'd' && cell.v instanceof Date) return `${cell.v.getFullYear()}-${pad2(cell.v.getMonth() + 1)}-${pad2(cell.v.getDate())}`
  if (typeof cell.v === 'string') return cell.v.trim() || null
  if (typeof cell.v === 'number' || typeof cell.v === 'boolean') return cell.v
  return null
}

/** Excel (xlsx, xls, ods) o CSV/TSV a filas. En CSV todo queda como texto (fechas y comas decimales españolas). */
export function readSheets(data: Buffer, ext: string): SheetData[] {
  const wb = ['csv', 'tsv', 'txt'].includes(ext)
    ? XLSX.read(decodeText(data), { type: 'string', raw: true, dense: true, FS: ext === 'tsv' ? '\t' : undefined })
    : XLSX.read(data, { type: 'buffer', cellNF: true, dense: true })
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name]!
    const dense = (ws['!data'] ?? []) as Array<Array<XLSX.CellObject | undefined> | undefined>
    const rows = dense.slice(0, MAX_SHEET_ROWS)
      .map(r => Array.from(r ?? [], cellValue))
      .filter(r => r.some(c => c != null))
    return { name, rows }
  }).filter(s => s.rows.length)
}

/** Celda a texto para enseñársela a la IA */
export function cellText(c: SheetCell) {
  return c == null ? '' : String(c).replace(/\s+/g, ' ')
}

export interface ZipEntry {
  path: string
  data: Buffer
  sourceDate?: SourceFileDate
}

const ZIP_LIMITS = { files: 2000, fileBytes: 40 * 1024 * 1024, totalBytes: 600 * 1024 * 1024 }

/**
 * Contenido de un ZIP con sus carpetas (las carpetas ayudan a clasificar: año, emitidas, recibidas…).
 * Se ignoran archivos de sistema y se corta ante ZIP bomba. Un ZIP dentro del ZIP se abre también.
 */
export function expandZip(data: Buffer, prefix = '', depth = 0): ZipEntry[] {
  const dates = zipEntryDates(data)
  let total = 0
  let count = 0
  let tooBig = false
  const files = unzipSync(new Uint8Array(data), {
    filter: (f) => {
      const base = f.name.split('/').pop() ?? ''
      if (f.name.endsWith('/') || f.name.startsWith('__MACOSX/') || base.startsWith('.') || /^(thumbs\.db|desktop\.ini)$/i.test(base)) return false
      if (f.originalSize > ZIP_LIMITS.fileBytes) return false
      total += f.originalSize
      count++
      if (total > ZIP_LIMITS.totalBytes || count > ZIP_LIMITS.files) {
        tooBig = true
        return false
      }
      return true
    },
  })
  if (tooBig) throw createError({ statusCode: 413, statusMessage: 'El ZIP es demasiado grande: máximo 2.000 archivos y 600 MB descomprimido' })
  const out: ZipEntry[] = []
  for (const [name, bytes] of Object.entries(files)) {
    // Nombres de ZIP creados en Windows antiguos: CP437 mal decodificado; se deja tal cual si ya es legible
    const path = prefix + name
    const buf = Buffer.from(bytes)
    if (depth < 1 && /\.zip$/i.test(name)) out.push(...expandZip(buf, `${path.replace(/\.zip$/i, '')}/`, depth + 1))
    else out.push({ path, data: buf, sourceDate: dates.get(name) })
  }
  return out
}

export interface PathHints {
  year: number | null
  quarter: number | null
  direction: 'issued' | 'received' | null
}

/** Qué contiene una carpeta según su nombre */
export type FolderKind = 'invoice' | 'credit_note' | 'ticket' | 'quote' | 'proforma' | 'purchase_order' | 'delivery_note' | 'payroll' | 'bank_statement' | 'contract' | 'tax' | 'insurance'

export interface FolderSignals {
  direction: 'issued' | 'received' | null
  kind: FolderKind | null
  /** Ruta de carpetas (sin el archivo), para explicar de dónde sale la pista */
  folders: string
}

/**
 * Lo que dicen las carpetas de un documento: "2026/1T/Emitidas/Presupuestos/P-12.pdf" → presupuestos
 * emitidos. Solo las carpetas (las nombra el usuario; el nombre del archivo, no) y, si dos niveles
 * dicen cosas distintas, manda el más profundo (el más concreto).
 */
export function folderSignals(path: string): FolderSignals {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  const folders = parts.slice(0, -1)
  const signals: FolderSignals = { direction: null, kind: null, folders: folders.join('/') }
  for (const raw of [...folders].reverse()) {
    const s = ` ${raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `
    if (!signals.kind) signals.kind = FOLDER_KINDS.find(([, re]) => re.test(s))?.[0] ?? null
    if (!signals.direction) {
      const issued = FOLDER_ISSUED.test(s)
      const received = FOLDER_RECEIVED.test(s)
      // "Ingresos y gastos" no dice nada: se mira la carpeta de arriba
      if (issued !== received) signals.direction = issued ? 'issued' : 'received'
    }
  }
  return signals
}

/** Pistas de la ruta de un archivo: "2023/2T/Facturas emitidas/F-0012.pdf" → 2023, 2.º trimestre, emitida */
export function pathHints(path: string): PathHints {
  const p = path.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const years = p.match(/(?<!\d)(19[89]\d|20[0-4]\d)(?!\d)/g)
  const q = p.match(/(?<![a-z0-9])(?:([1-4])\s*(?:t|q|tr|trim|er trimestre|o trimestre|º trimestre)|(?:t|q)\s*([1-4]))(?![a-z0-9])/)
  const named = p.match(/(primer|segundo|tercer|cuarto)\s+trimestre/)
  const quarter = q ? Number(q[1] ?? q[2]) : named ? ['primer', 'segundo', 'tercer', 'cuarto'].indexOf(named[1]!) + 1 : null
  const issued = /emitid|ventas?\b|ingresos?\b|clientes?\b|facturas? de venta|facturacion/.test(p)
  const received = /recibid|compras?\b|gastos?\b|proveedor|tickets?\b|suministro|facturas? de compra/.test(p)
  return {
    year: years ? Number(years.at(-1)) : null,
    quarter: quarter || null,
    direction: issued && !received ? 'issued' : received && !issued ? 'received' : null,
  }
}

// Nombres de carpeta habituales (sin tildes; cada nombre va entre espacios). Lo más concreto primero:
// "seguros sociales" son nóminas, no seguros; "facturas rectificativas" son rectificativas, no facturas
const FOLDER_KINDS: ReadonlyArray<readonly [FolderKind, RegExp]> = Object.freeze([
  ['payroll', / (nominas?|seguros? sociales|seguridad social|tc ?[12]|rnt|rlc|payrolls?) /],
  ['credit_note', / (rectificativas?|abonos?|notas? de (credito|abono)|credit notes?) /],
  ['proforma', / (proformas?|pro forma) /],
  ['quote', / (presupuestos?|ofertas?|cotizacion(es)?|quotes?|quotations?|estimates?) /],
  ['purchase_order', / (pedidos?|ordenes? de (compra|pedido)|op|po|purchase orders?) /],
  ['delivery_note', / (albaran(es)?|notas? de entrega|delivery notes?) /],
  ['bank_statement', / (bancos?|extractos?|movimientos( bancarios)?|cuentas? bancarias?|bank( statements?)?) /],
  ['tax', / (impuestos?|tributos|aeat|hacienda|modelos? (aeat|hacienda|\d{3})|(303|130|111|115|123|180|190|347|349|390)|taxes) /],
  ['insurance', / (seguros?|polizas?|insurance) /],
  ['contract', / (contratos?|legal|escrituras?|poderes|estatutos|contracts?) /],
  ['ticket', / (tickets?|recibos?|receipts?) /],
  ['invoice', / (facturas?|invoices?|bills?) /],
])

const FOLDER_ISSUED = / (emitid[ao]s?|ventas?|ingresos?|clientes?|facturacion|cobros?|issued|sales|income|customers?) /
const FOLDER_RECEIVED = / (recibid[ao]s?|compras?|gastos?|proveedor(es)?|acreedores|suministros?|tickets?|pagos?|received|purchases?|expenses?|suppliers?|vendors?) /
