import { PDFDocument } from 'pdf-lib'
import type { ContactDraft } from '../../shared/utils/contact-clean'
import type { ContactImportFile, ContactImportRole } from '../../shared/types/contact-import'

/**
 * Lectura de listados de clientes y proveedores para la importación masiva.
 * - Hojas (Excel, CSV, texto copiado de una tabla): la IA mira una muestra y dice qué hay en cada
 *   columna; las filas se convierten aquí, sin IA, aunque sean miles. Sin IA, por cabeceras y contenido.
 * - PDF, fotos, Word y texto libre: la IA lee los contactos por tandas de páginas o de texto.
 * - vCard (.vcf, la agenda del móvil o de Outlook): se lee aquí.
 */

export interface ReadContact {
  draft: Partial<ContactDraft>
  source: string
  role: ContactImportRole | null
  /** Viene de una hoja: la IA lo revisa después (los de documentos ya los lee la IA con esas reglas) */
  fromSheet: boolean
}

export interface ReadSource {
  file: ContactImportFile
  contacts: ReadContact[]
}

export interface ContactReadContext {
  company: { legalName: string, nif: string | null }
  ai: boolean
  progress: (phase: 'columns' | 'extract', done: number, total: number) => void
}

/** Lee un archivo subido o el texto pegado */
export async function readContactSource(name: string, data: Buffer, ctx: ContactReadContext): Promise<ReadSource> {
  const file: ContactImportFile = { name, kind: 'document', contacts: 0, note: null, error: null }
  const done = (contacts: ReadContact[], note: string | null = null): ReadSource => ({ file: { ...file, contacts: contacts.length, note }, contacts })
  const head = data.subarray(0, 2048).toString('utf8').replace(/^﻿/, '').trimStart()

  if (/\.vcf$/i.test(name) || /^BEGIN:VCARD/i.test(head)) {
    file.kind = 'vcard'
    return done(readVcards(decodeText(data), name))
  }
  const kind = importKind(data, name)
  if (!kind) throw new AiError('Formato no admitido: usa Excel, CSV, PDF, Word, una foto o una agenda .vcf', 415)
  if (kind.family === 'zip') throw new AiError('Descomprime el ZIP y sube los archivos sueltos', 415)

  if (kind.family === 'sheet' || (kind.family === 'text' && kind.ext !== 'xml')) {
    const text = kind.family === 'text' ? decodeText(data) : null
    const tabular = text == null ? kind.ext : tabularFormat(text)
    if (tabular) {
      file.kind = text == null ? 'sheet' : 'text'
      const sheets = readSheets(text == null ? data : Buffer.from(text, 'utf8'), tabular)
      if (!sheets.length) throw new AiError('El archivo está vacío', 422)
      const { contacts, notes } = await readContactSheets(sheets, name, ctx)
      return done(contacts, notes.join(' · ') || null)
    }
    file.kind = 'text'
    return done(await extractContacts(textChunks(text!).map((t, i, all) => ({ label: all.length > 1 ? `parte ${i + 1}` : null, parts: [{ type: 'input_text', text: t }] })), name, ctx))
  }

  if (!ctx.ai) throw new AiError('Para leer PDF, fotos o Word hace falta la IA (NUXT_OPENAI_API_KEY). Las hojas de Excel y CSV se leen sin ella.', 503)
  if (kind.family === 'pdf') return done(await extractContacts(await pdfChunks(data, name), name, ctx))
  if (kind.family === 'word') {
    const content = kind.ext === 'doc' ? readLegacyDoc(data) : readWordZip(data, kind.ext)
    if (content.text.replace(/\s/g, '').length >= 40) {
      return done(await extractContacts(textChunks(content.text).map((t, i, all) => ({ label: all.length > 1 ? `parte ${i + 1}` : null, parts: [{ type: 'input_text', text: t }] })), name, ctx))
    }
  }
  return done(await extractContacts([{ label: null, parts: aiPartsFor(kind, data, name) }], name, ctx))
}

// ─── Texto pegado o .txt: ¿es una tabla? ─────────────────────────────────────

/** 'tsv' o 'csv' si el texto son filas con columnas (copiado de Excel, exportación); null si es texto libre */
function tabularFormat(text: string): 'tsv' | 'csv' | null {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return null
  const share = (re: RegExp, min: number) => lines.filter(l => (l.match(re)?.length ?? 0) >= min).length / lines.length
  if (share(/\t/g, 1) >= 0.6) return 'tsv'
  if (share(/;/g, 2) >= 0.7) return 'csv'
  // Comas: solo si casi todas las filas tienen el mismo número (las direcciones también llevan comas)
  const freq = new Map<number, number>()
  for (const l of lines) {
    const n = l.match(/,/g)?.length ?? 0
    freq.set(n, (freq.get(n) ?? 0) + 1)
  }
  const [mode, times] = [...freq].sort((a, b) => b[1] - a[1])[0] ?? [0, 0]
  return mode >= 3 && times / lines.length >= 0.8 ? 'csv' : null
}

/** Texto en trozos de unos 12 000 caracteres, cortando por líneas */
function textChunks(text: string, size = 12_000) {
  const out: string[] = []
  let cur = ''
  for (const line of text.split(/\r?\n/)) {
    if (cur.length + line.length > size && cur) {
      out.push(cur)
      cur = ''
    }
    cur += `${line}\n`
  }
  if (cur.trim()) out.push(cur)
  return out.slice(0, 40)
}

/** PDF en tandas de 2 páginas: cada lectura cabe en una respuesta y se leen a la vez */
async function pdfChunks(data: Buffer, name: string) {
  const base = safeFilename(name).replace(/\.[^.]*$/, '')
  let pdf: PDFDocument
  try {
    pdf = await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false })
  }
  catch {
    return [{ label: null, parts: [{ type: 'input_file' as const, filename: `${base}.pdf`, file_data: `data:application/pdf;base64,${data.toString('base64')}` }] }]
  }
  const pages = Math.min(pdf.getPageCount(), 120)
  if (pages <= 2) return [{ label: null, parts: [{ type: 'input_file' as const, filename: `${base}.pdf`, file_data: `data:application/pdf;base64,${data.toString('base64')}` }] }]
  const chunks: Array<{ label: string, parts: AiPart[] }> = []
  for (let from = 0; from < pages; from += 2) {
    const to = Math.min(from + 2, pages)
    const part = await PDFDocument.create()
    const copied = await part.copyPages(pdf, Array.from({ length: to - from }, (_, i) => from + i))
    for (const p of copied) part.addPage(p)
    const bytes = Buffer.from(await part.save())
    chunks.push({ label: to - from > 1 ? `págs. ${from + 1}-${to}` : `pág. ${from + 1}`, parts: [{ type: 'input_file', filename: `${base}-${from + 1}.pdf`, file_data: `data:application/pdf;base64,${bytes.toString('base64')}` }] })
  }
  return chunks
}

// ─── Hojas: qué dato hay en cada columna ─────────────────────────────────────

type ContactColumn = typeof CONTACT_COLUMNS[number]

interface ContactSheetMapping {
  name: string
  contacts: boolean
  headerRow: number | null
  firstDataRow: number
  role: 'client' | 'supplier' | 'both' | 'unknown'
  columns: Record<ContactColumn, number | null>
  extra: Array<{ column: number, label: string }>
}

async function readContactSheets(sheets: SheetData[], fileName: string, ctx: ContactReadContext) {
  const usable = sheets.slice(0, 12)
  let mappings: ContactSheetMapping[] | null = null
  if (ctx.ai) {
    ctx.progress('columns', 0, 1)
    mappings = await mapColumnsWithAi(usable, fileName, ctx).catch((err) => {
      console.warn('[contact-import] columnas con IA:', (err as Error).message)
      return null
    })
    ctx.progress('columns', 1, 1)
  }
  const contacts: ReadContact[] = []
  const notes: string[] = []
  for (const sheet of usable) {
    const stats = columnStats(sheet)
    const fromAi = mappings?.find(m => m.name === sheet.name) ?? (mappings?.length === 1 && usable.length === 1 ? mappings[0] : undefined)
    const mapping = fromAi ? checkMapping(fromAi, stats) : guessMapping(sheet, stats)
    if (!mapping.contacts) continue
    if (mapping.columns.name == null && mapping.columns.firstName == null && mapping.columns.tradeName == null) continue
    const rows = sheetContacts(sheet, mapping, `${fileName}${usable.length > 1 ? ` · ${sheet.name}` : ''}`)
    if (!rows.length) continue
    contacts.push(...rows)
    notes.push(`${usable.length > 1 ? `Hoja «${sheet.name}»: ` : ''}${rows.length} ${rows.length === 1 ? 'contacto' : 'contactos'}${mapping.headerRow ? `, cabecera en la fila ${mapping.headerRow}` : ', sin cabecera'}`)
  }
  if (!contacts.length) throw new AiError('No se ha encontrado ningún listado de clientes o proveedores en la hoja', 422)
  return { contacts, notes }
}

const MAPPING_SYSTEM = `Analizas hojas de cálculo con listados de clientes o proveedores de empresas españolas: exportados de otros programas, hechos a mano o copiados de una tabla.
Para cada hoja di si es un listado de contactos y en qué columna está cada dato. Las columnas se numeran desde 0 (el número antes de "=" en cada celda) y las filas con R1, R2…
Puede no haber cabecera: entonces deduce cada columna por su contenido con el perfil de columnas (cuántas filas tienen dato y ejemplos de toda la hoja).

columns (índice o null):
- name: razón social o nombre y apellidos (el nombre fiscal del contacto). tradeName: nombre comercial si va en otra columna. contactPerson: persona de contacto dentro de la empresa (suele ir junto al nombre, con nombres de persona).
- firstName y lastName: solo si el nombre y los apellidos de una persona van en columnas separadas.
- nif: NIF, CIF, DNI, NIE o NIF-IVA. email y email2. phone, phone2 y mobile. fax.
- address: calle y número. address2: segunda línea de la dirección. postalCode, city (población), province, country.
- iban: cuenta bancaria. paymentTerms: plazo o días de pago. irpf: retención. notes: observaciones o notas. role: columna que dice si es cliente o proveedor. code: código o número de cliente/proveedor en el otro programa.
Una columna solo puede tener un dato. Si dudas, null.
extra: otras columnas con información útil del contacto que no encaje arriba (forma de pago, sector, comercial, horario…) con una etiqueta corta en español. Nunca columnas vacías, de importes ni de fechas de facturación.
headerRow: fila de la cabecera, o null si no hay. firstDataRow: primera fila con datos.
role: client si es un listado de clientes, supplier si es de proveedores o acreedores, both si mezcla los dos, unknown si no se sabe.
contacts: false si la hoja no es un listado de contactos (facturas, productos, totales…).`

function mappingSchema() {
  const col = { type: ['integer', 'null'] }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['sheets'],
    properties: {
      sheets: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'contacts', 'headerRow', 'firstDataRow', 'role', 'columns', 'extra'],
          properties: {
            name: { type: 'string' },
            contacts: { type: 'boolean' },
            headerRow: col,
            firstDataRow: { type: 'integer' },
            role: { type: 'string', enum: ['client', 'supplier', 'both', 'unknown'] },
            columns: { type: 'object', additionalProperties: false, required: [...CONTACT_COLUMNS], properties: Object.fromEntries(CONTACT_COLUMNS.map(k => [k, col])) },
            extra: {
              type: 'array',
              items: { type: 'object', additionalProperties: false, required: ['column', 'label'], properties: { column: { type: 'integer' }, label: { type: 'string' } } },
            },
          },
        },
      },
    },
  }
}

/** Muestra de cada hoja para la IA: primeras filas y un perfil de cada columna con ejemplos de toda la hoja */
function sheetPreview(sheet: SheetData) {
  const cell = (c: SheetCell) => cellText(c).trim().slice(0, 40)
  const width = Math.min(Math.max(...sheet.rows.slice(0, 400).map(r => r.length), 0), 60)
  const profile: string[] = []
  for (let j = 0; j < width; j++) {
    const values = sheet.rows.map(r => r[j]).filter((v): v is SheetCell => v != null && !!cellText(v).trim())
    if (!values.length) continue
    const step = Math.max(1, Math.floor(values.length / 5))
    const samples = [...new Set(values.filter((_, i) => i % step === 0).map(cell))].slice(0, 5)
    profile.push(`${j}: ${values.length}/${sheet.rows.length} filas · ${samples.join(' | ')}`)
  }
  return [
    `Hoja "${sheet.name}" (${sheet.rows.length} filas):`,
    ...sheet.rows.slice(0, 18).map((r, i) => `R${i + 1}: ${r.map((c, j) => (c == null || !cellText(c).trim() ? null : `${j}=${cell(c)}`)).filter(Boolean).join(' | ')}`),
    'Perfil de columnas (índice: filas con dato · ejemplos):',
    ...profile,
  ].join('\n')
}

async function mapColumnsWithAi(sheets: SheetData[], fileName: string, ctx: ContactReadContext) {
  const res = await aiJson<{ sheets: ContactSheetMapping[] }>({
    name: 'columnas_contactos',
    schema: mappingSchema(),
    system: MAPPING_SYSTEM,
    parts: [{ type: 'input_text', text: `Empresa usuaria: ${ctx.company.legalName}${ctx.company.nif ? `, NIF ${ctx.company.nif}` : ''}.\nArchivo: ${fileName}\n\n${sheets.slice(0, 6).map(sheetPreview).join('\n\n')}` }],
    effort: 'medium',
    timeoutMs: 120_000,
  })
  return res.data.sheets
}

interface ColumnStat {
  fill: number
  nif: number
  email: number
  postal: number
  phone: number
  iban: number
  web: number
  province: number
  text: number
}

const looksNif = (v: string) => {
  const n = normalizeNif(v).replace(/^(NIF|CIF|DNI|NIE)/, '')
  return /^(ES)?([0-9XYZ]\d{7}[A-Z]|[A-W]\d{7}[0-9A-J]|\d{7,8}[A-Z]?)$/.test(n) || looksLikeEuVat(n)
}
const looksEmail = (v: string) => /[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(v)
const looksPostal = (v: string) => /^\d{4,5}$/.test(v.replace(/[\s.]/g, ''))
const looksPhone = (v: string) => /^(\+|00)?[\d\s().-]{9,}$/.test(v.trim()) && /^(\+|00)?\D*(34)?\D*[6789]/.test(v.trim()) && v.replace(/\D/g, '').length >= 9 && v.replace(/\D/g, '').length <= 15
const looksIban = (v: string) => /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v.toUpperCase().replace(/[\s-]/g, '')) || /^\d{20}$/.test(v.replace(/[\s-]/g, ''))
const looksWeb = (v: string) => /^(https?:\/\/|www\.)\S+$/i.test(v.trim())

/** Qué tipo de dato tiene cada columna: comprueba lo que dice la IA y sirve cuando no hay IA */
function columnStats(sheet: SheetData): ColumnStat[] {
  const width = Math.min(Math.max(...sheet.rows.slice(0, 2000).map(r => r.length), 0), 80)
  const rows = sheet.rows.slice(0, 2000)
  return Array.from({ length: width }, (_, j) => {
    const values = rows.map(r => r[j]).filter(v => v != null).map(v => cellText(v).trim()).filter(Boolean)
    const n = values.length || 1
    const share = (fn: (v: string) => boolean) => values.filter(fn).length / n
    return {
      fill: values.length / (rows.length || 1),
      nif: share(looksNif),
      email: share(looksEmail),
      postal: share(looksPostal),
      phone: share(v => looksPhone(v) && !looksPostal(v)),
      iban: share(looksIban),
      web: share(looksWeb),
      province: share(v => !!spanishProvince(v)),
      text: share(v => /\p{L}{2,}/u.test(v) && !looksEmail(v) && !looksWeb(v)),
    }
  })
}

const TYPED: ReadonlyArray<readonly [ContactColumn, keyof ColumnStat]> = Object.freeze([
  ['nif', 'nif'], ['email', 'email'], ['postalCode', 'postal'], ['iban', 'iban'], ['website', 'web'], ['province', 'province'],
] as const)

/** La columna que dice la IA tiene que contener ese tipo de dato; si no, se usa la que lo tenga claramente */
function checkMapping(m: ContactSheetMapping, stats: ColumnStat[]): ContactSheetMapping {
  const columns = { ...m.columns }
  const used = () => new Set(Object.values(columns).filter((v): v is number => v != null))
  for (const [key, stat] of TYPED) {
    const cur = columns[key]
    const ok = cur != null && (stats[cur]?.[stat] ?? 0) >= 0.3
    if (ok) continue
    const taken = used()
    const best = stats.map((s, j) => ({ j, v: s[stat], fill: s.fill })).filter(x => !taken.has(x.j) && x.v >= 0.6 && x.fill > 0).sort((a, b) => b.v * b.fill - a.v * a.fill)[0]
    // Sin otra columna mejor se respeta lo que dijo la IA: si se equivoca, la revisión lo marcará
    if (best) columns[key] = best.j
  }
  for (const k of CONTACT_COLUMNS) {
    const j = columns[k]
    if (j != null && (j < 0 || j >= Math.max(stats.length, 1) + 5)) columns[k] = null
  }
  return { ...m, columns, extra: m.extra.filter(e => e.column >= 0 && !used().has(e.column)).slice(0, 8) }
}

/** Sin IA: por las cabeceras y, si no hay, por el contenido de cada columna */
function guessMapping(sheet: SheetData, stats: ColumnStat[]): ContactSheetMapping {
  const columns = Object.fromEntries(CONTACT_COLUMNS.map(k => [k, null])) as Record<ContactColumn, number | null>
  const key = (c: SheetCell) => cellText(c).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
  let headerRow: number | null = null
  for (let i = 0; i < Math.min(sheet.rows.length, 10) && headerRow == null; i++) {
    const hits = sheet.rows[i]!.map((c, j) => ({ j, k: HEADER_SYNONYMS.find(([, words]) => words.includes(key(c)))?.[0] })).filter(h => h.k)
    if (hits.length >= 2) {
      headerRow = i + 1
      for (const h of hits) if (columns[h.k!] == null) columns[h.k!] = h.j
    }
  }
  if (headerRow == null) {
    const taken = new Set<number>()
    for (const [k, stat] of TYPED) {
      const best = stats.map((s, j) => ({ j, v: s[stat] * s.fill })).filter(x => !taken.has(x.j) && x.v >= 0.3).sort((a, b) => b.v - a.v)[0]
      if (best) {
        columns[k] = best.j
        taken.add(best.j)
      }
    }
    const phone = stats.map((s, j) => ({ j, v: s.phone * s.fill })).filter(x => !taken.has(x.j) && x.v >= 0.1).sort((a, b) => b.v - a.v)[0]
    if (phone) {
      columns.phone = phone.j
      taken.add(phone.j)
    }
    // Nombre: la primera columna de texto casi siempre llena. Dirección y población, alrededor del código postal
    const textCols = stats.map((s, j) => ({ j, s })).filter(x => !taken.has(x.j) && x.s.text >= 0.7 && x.s.fill > 0)
    const name = textCols.find(x => x.s.fill >= 0.6)
    if (name) {
      columns.name = name.j
      taken.add(name.j)
    }
    const cp = columns.postalCode
    if (cp != null) {
      const before = textCols.filter(x => x.j < cp && !taken.has(x.j)).at(-1)
      const after = textCols.find(x => x.j > cp && !taken.has(x.j) && x.j !== columns.province)
      if (before) {
        columns.address = before.j
        taken.add(before.j)
      }
      if (after) columns.city = after.j
    }
  }
  return { name: sheet.name, contacts: true, headerRow, firstDataRow: (headerRow ?? 0) + 1, role: 'unknown', columns, extra: [] }
}

/** Filas de la hoja → contactos leídos (sin limpiar todavía) */
function sheetContacts(sheet: SheetData, m: ContactSheetMapping, label: string): ReadContact[] {
  const start = Math.max(m.firstDataRow - 1, m.headerRow ?? 0, 0)
  const header = m.headerRow ? sheet.rows[m.headerRow - 1]?.map(cellText).join('|') : null
  const sheetRole: ContactImportRole | null = m.role === 'unknown' ? null : m.role
  const out: ReadContact[] = []
  for (let i = start; i < sheet.rows.length; i++) {
    const row = sheet.rows[i]!
    if (header && row.map(cellText).join('|') === header) continue
    const get = (k: ContactColumn) => {
      const j = m.columns[k]
      const v = j == null ? null : row[j]
      return v == null ? null : cellText(v).trim() || null
    }
    const join = (sep: string, ...keys: ContactColumn[]) => keys.map(get).filter(Boolean).join(sep) || null
    const person = join(' ', 'firstName', 'lastName')
    const name = get('name') ?? (person && !get('tradeName') ? person : null)
    const draft: Partial<ContactDraft> = {
      name,
      tradeName: get('tradeName'),
      contactPerson: get('contactPerson') ?? (person && person !== name ? person : null),
      nif: get('nif'),
      email: join('; ', 'email', 'email2'),
      phone: join('; ', 'phone', 'mobile', 'phone2'),
      website: get('website'),
      address: join(', ', 'address', 'address2'),
      postalCode: get('postalCode'),
      city: get('city'),
      province: get('province'),
      country: get('country'),
      iban: get('iban'),
      paymentTermsDays: paymentDays(get('paymentTerms')),
      irpfRate: get('irpf') ? parsePercent(get('irpf')) : null,
      notes: [
        get('notes'),
        get('code') ? `Código en el programa anterior: ${get('code')}` : null,
        get('fax') ? `Fax: ${get('fax')}` : null,
        ...m.extra.map(e => (row[e.column] != null && cellText(row[e.column]!).trim() ? `${e.label}: ${cellText(row[e.column]!).trim()}` : null)),
      ].filter(Boolean).join('\n') || null,
    }
    if (!draft.name && !draft.tradeName && !draft.nif && !draft.email) continue
    out.push({ draft, source: `${label} · fila ${i + 1}`, role: roleFrom(get('role')) ?? sheetRole, fromSheet: true })
  }
  return out
}

/** «30 días», «a 60 d», «Contado» → días */
function paymentDays(v: string | null) {
  if (!v) return null
  if (/contado|al recibir|inmediat/i.test(v)) return 0
  const m = v.match(/(\d{1,3})\s*(d[ií]as?|d\b)?/i)
  const n = m ? Number(m[1]) : null
  return n != null && n <= 365 ? n : null
}

function roleFrom(v: string | null): ContactImportRole | null {
  if (!v) return null
  const s = v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const client = /client|deudor|customer/.test(s)
  const supplier = /proveed|acreedor|supplier|vendor/.test(s)
  return /ambos|both/.test(s) || (client && supplier) ? 'both' : client ? 'client' : supplier ? 'supplier' : null
}

// ─── PDF, fotos, Word y texto libre: lectura con IA ──────────────────────────

interface AiContact {
  name: string | null
  tradeName: string | null
  contactPerson: string | null
  kind: 'company' | 'person' | null
  nif: string | null
  email: string | null
  phone: string | null
  website: string | null
  address: string | null
  postalCode: string | null
  city: string | null
  province: string | null
  country: string | null
  iban: string | null
  paymentTermsDays: number | null
  notes: string | null
  role: 'client' | 'supplier' | 'both' | 'unknown'
}

function extractSchema() {
  const str = { type: ['string', 'null'] }
  const fields = ['name', 'tradeName', 'contactPerson', 'nif', 'email', 'phone', 'website', 'address', 'postalCode', 'city', 'province', 'country', 'iban', 'notes']
  return {
    type: 'object',
    additionalProperties: false,
    required: ['contacts'],
    properties: {
      contacts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [...fields, 'kind', 'paymentTermsDays', 'role'],
          properties: {
            ...Object.fromEntries(fields.map(f => [f, str])),
            kind: { type: ['string', 'null'], enum: ['company', 'person', null] },
            paymentTermsDays: { type: ['integer', 'null'] },
            role: { type: 'string', enum: ['client', 'supplier', 'both', 'unknown'] },
          },
        },
      },
    },
  }
}

const EXTRACT_SYSTEM = `Extraes todos los clientes o proveedores que aparecen en un documento español: un listado, una tabla, una agenda, fichas, una exportación de otro programa…
Devuelve uno por contacto, en el orden en que aparecen, sin saltarte ninguno. No inventes nada: lo que no aparezca, null.
- name: razón social completa con su forma jurídica (S.L., S.A.…) o nombre y apellidos. tradeName: nombre comercial si es distinto. contactPerson: persona de contacto dentro de la empresa.
- Autónomos: si el NIF es un DNI o NIE (persona física) y aparecen un nombre comercial y el nombre de esa persona, name es la persona y tradeName el comercial.
- kind: person si es una persona física, company si es una empresa, organismo o entidad.
- nif tal como aparece. email y phone: el principal; los demás van en notes.
- address: calle, número y piso. postalCode, city (población), province, country (código ISO de 2 letras; España = ES).
- Textos en MAYÚSCULAS: escríbelos con mayúsculas y minúsculas normales del español, conservando las siglas.
- paymentTermsDays: días de plazo de pago si se indican. iban sin espacios.
- role: client, supplier o both si el documento lo dice; si no, unknown.
- notes: otros datos útiles del contacto, breves (otros teléfonos o emails, horario, forma de pago, observaciones).
No incluyas a la empresa usuaria (la que importa) ni filas de cabecera o totales.`

async function extractContacts(chunks: Array<{ label: string | null, parts: AiPart[] }>, fileName: string, ctx: ContactReadContext): Promise<ReadContact[]> {
  if (!ctx.ai) throw new AiError('Para leer este archivo hace falta la IA (NUXT_OPENAI_API_KEY)', 503)
  let done = 0
  ctx.progress('extract', 0, chunks.length)
  const company = `Empresa usuaria (no la incluyas): ${ctx.company.legalName}${ctx.company.nif ? `, NIF ${ctx.company.nif}` : ''}.`
  const results = await runLimited(chunks.map(chunk => async () => {
    const read = async (parts: AiPart[]): Promise<AiContact[]> => {
      try {
        const res = await aiJson<{ contacts: AiContact[] }>({ name: 'contactos', schema: extractSchema(), system: EXTRACT_SYSTEM, parts: [{ type: 'input_text', text: company }, ...parts], effort: 'low', maxOutputTokens: 32_000 })
        return res.data.contacts
      }
      catch (err) {
        // Demasiados contactos para una respuesta: un texto se parte en dos
        const text = parts.length === 1 && parts[0]!.type === 'input_text' ? parts[0]!.text : null
        if (err instanceof AiError && /demasiado largo/.test(err.message) && text && text.length > 2000) {
          const half = textChunks(text, Math.ceil(text.length / 2) + 1)
          return (await Promise.all(half.map(t => read([{ type: 'input_text', text: t }])))).flat()
        }
        throw err
      }
    }
    const contacts = await read(chunk.parts)
    ctx.progress('extract', ++done, chunks.length)
    return contacts.map(({ role, ...draft }): ReadContact => ({
      draft,
      source: `${fileName}${chunk.label ? ` · ${chunk.label}` : ''}`,
      role: role === 'unknown' ? null : role,
      fromSheet: false,
    }))
  }), aiSettings().concurrency)
  const all = results.flat()
  if (!all.length) throw new AiError('No se ha encontrado ningún cliente o proveedor en el documento', 422)
  return all
}

// ─── Revisión con IA de lo leído de una hoja ─────────────────────────────────

export interface RefineInput {
  i: number
  name: string | null
  tradeName: string | null
  contactPerson: string | null
  /** dni, nie, cif, vat, otro o ninguno (para decidir persona o empresa) */
  nifKind: string
  kind: 'company' | 'person' | null
  address: string | null
  postalCode: string | null
  city: string | null
  province: string | null
  country: string | null
}

export interface RefineFix {
  i: number
  skip: boolean
  kind: 'company' | 'person' | null
  name: string | null
  tradeName: string | null
  contactPerson: string | null
  address: string | null
  city: string | null
  province: string | null
  reason: string
}

const REFINE_SYSTEM = `Revisas clientes o proveedores españoles ya leídos de una hoja de cálculo para que se guarden perfectos. Devuelve SOLO las filas en las que cambies algo (o en las que decidas kind), con su "i".
En cada fila devuelta, null = no cambiar ese dato; "" = vaciarlo.
Reglas:
- No inventes nada: solo reordenas, corriges o decides con lo que ya hay en la fila.
- kind: decide company o person solo si viene null (fila sin NIF válido): company si es empresa, comercio, organismo o entidad; person si es nombre y apellidos de una persona.
- Autónomos: si nifKind es dni o nie (persona física), name es un nombre comercial (no nombre y apellidos) y contactPerson parece el titular (nombre y apellidos), entonces name = contactPerson, tradeName = ese nombre comercial y contactPerson = "". Si el nombre comercial lleva las iniciales o apellidos de esa persona es casi seguro. Si no está claro, no lo cambies.
- Al revés: si nifKind es cif (sociedad) y name es el nombre de una persona mientras tradeName o contactPerson tiene la razón social (S.L., S.A.…), intercámbialos.
- MAYÚSCULAS: si contactPerson, address o city están enteros en mayúsculas, escríbelos con mayúsculas y minúsculas normales del español, conservando las siglas. name y tradeName se dejan como están escritos (es el nombre fiscal).
- Erratas evidentes en calles y poblaciones: una letra que falta o sobra en una palabra conocida («ECNOLOGIAS» → «Tecnologías»), tildes que faltan en poblaciones españolas («Malaga» → «Málaga»). Nunca cambies números, pisos ni el nombre de una empresa o persona (salvo las mayúsculas).
- province: solo si falta, no hay código postal y la población la deja clara.
- skip: true si la fila no es un contacto (cabecera repetida, total, título de sección, nota suelta).
- reason: frase muy breve en español de lo que has hecho («Separado el nombre comercial del titular», «Mayúsculas corregidas», «Errata en la calle»).`

function refineSchema() {
  const str = { type: ['string', 'null'] }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['rows'],
    properties: {
      rows: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['i', 'skip', 'kind', 'name', 'tradeName', 'contactPerson', 'address', 'city', 'province', 'reason'],
          properties: {
            i: { type: 'integer' },
            skip: { type: 'boolean' },
            kind: { type: ['string', 'null'], enum: ['company', 'person', null] },
            name: str, tradeName: str, contactPerson: str, address: str, city: str, province: str,
            reason: { type: 'string' },
          },
        },
      },
    },
  }
}

/** La IA revisa las filas por tandas de 40: devuelve solo las que cambia */
export async function refineContactsWithAi(rows: RefineInput[], progress: (done: number, total: number) => void): Promise<RefineFix[]> {
  const chunks: RefineInput[][] = []
  for (let i = 0; i < rows.length; i += 40) chunks.push(rows.slice(i, i + 40))
  let done = 0
  progress(0, chunks.length)
  const results = await runLimited(chunks.map(chunk => async () => {
    const compact = chunk.map(r => Object.fromEntries(Object.entries(r).filter(([, v]) => v != null && v !== '')))
    const res = await aiJson<{ rows: RefineFix[] }>({
      name: 'revision_contactos',
      schema: refineSchema(),
      system: REFINE_SYSTEM,
      parts: [{ type: 'input_text', text: JSON.stringify(compact) }],
      effort: 'low',
      timeoutMs: 120_000,
    }).catch((err) => {
      console.warn('[contact-import] revisión con IA:', (err as Error).message)
      return null
    })
    progress(++done, chunks.length)
    const ids = new Set(chunk.map(r => r.i))
    return (res?.data.rows ?? []).filter(f => ids.has(f.i))
  }), aiSettings().concurrency)
  return results.flat()
}

// ─── vCard ───────────────────────────────────────────────────────────────────

/** Agenda .vcf (móvil, Outlook, Google Contacts): una tarjeta por contacto */
function readVcards(text: string, fileName: string): ReadContact[] {
  const unfolded = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').replace(/=\n/g, '')
  const cards = unfolded.split(/BEGIN:VCARD/i).slice(1)
  const unescape = (v: string) => v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim()
  const out: ReadContact[] = []
  cards.forEach((card, idx) => {
    const props: Array<{ name: string, params: string, value: string }> = []
    for (const line of card.split('\n')) {
      const m = line.match(/^(?:item\d+\.)?([A-Za-z-]+)((?:;[^:]*)?):(.*)$/)
      if (m) props.push({ name: m[1]!.toUpperCase(), params: m[2]!.toUpperCase(), value: decodeQp(m[2]!, m[3]!) })
    }
    const first = (n: string) => props.find(p => p.name === n)
    const all = (n: string) => props.filter(p => p.name === n).map(p => unescape(p.value)).filter(Boolean)
    const fn = first('FN') ? unescape(first('FN')!.value) : null
    const n = first('N')?.value.split(';').map(unescape)
    const personName = fn || (n ? [n[1], n[2], n[0]].filter(Boolean).join(' ') : null)
    const org = first('ORG') ? unescape(first('ORG')!.value.split(';')[0]!) : null
    const adr = first('ADR')?.value.split(';').map(unescape)
    const draft: Partial<ContactDraft> = {
      name: org || personName,
      contactPerson: org && personName && personName !== org ? personName : null,
      kind: org ? null : 'person',
      email: all('EMAIL').join('; ') || null,
      phone: all('TEL').join('; ') || null,
      website: all('URL')[0] ?? null,
      address: adr ? [adr[2], adr[1]].filter(Boolean).join(', ') || null : null,
      city: adr?.[3] || null,
      province: adr?.[4] || null,
      postalCode: adr?.[5] || null,
      country: adr?.[6] || null,
      notes: [all('TITLE')[0] ? `Cargo: ${all('TITLE')[0]}` : null, ...all('NOTE')].filter(Boolean).join('\n') || null,
    }
    if (draft.name) out.push({ draft, source: `${fileName} · contacto ${idx + 1}`, role: null, fromSheet: false })
  })
  if (!out.length) throw new AiError('La agenda no tiene contactos', 422)
  return out
}

/** Valores en quoted-printable (vCard 2.1 de Outlook y móviles antiguos) */
function decodeQp(params: string, value: string) {
  if (!/ENCODING=QUOTED-PRINTABLE/i.test(params)) return value
  const bytes = value.replace(/=([0-9A-F]{2})/gi, (_m, h: string) => String.fromCharCode(Number.parseInt(h, 16)))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes, c => c.charCodeAt(0)))
  }
  catch {
    return bytes
  }
}

// ─── Constantes ──────────────────────────────────────────────────────────────

const CONTACT_COLUMNS = Object.freeze(['name', 'tradeName', 'contactPerson', 'firstName', 'lastName', 'nif', 'email', 'email2', 'phone', 'phone2', 'mobile', 'fax', 'website', 'address', 'address2', 'postalCode', 'city', 'province', 'country', 'iban', 'paymentTerms', 'irpf', 'notes', 'role', 'code'] as const)

const HEADER_SYNONYMS: ReadonlyArray<readonly [ContactColumn, readonly string[]]> = Object.freeze([
  ['name', ['nombre', 'razon social', 'nombre fiscal', 'nombre o razon social', 'denominacion', 'denominacion social', 'cliente', 'proveedor', 'empresa', 'titular', 'name', 'company']],
  ['tradeName', ['nombre comercial', 'comercial', 'marca', 'trade name']],
  ['contactPerson', ['contacto', 'persona de contacto', 'persona contacto', 'atencion', 'att', 'attn', 'contact']],
  ['nif', ['nif', 'cif', 'dni', 'nie', 'nif cif', 'cif nif', 'n i f', 'c i f', 'vat', 'nif iva', 'identificacion fiscal', 'documento', 'tax id']],
  ['email', ['email', 'e mail', 'correo', 'mail', 'correo electronico', 'email facturacion']],
  ['phone', ['telefono', 'tel', 'tlf', 'tfno', 'telf', 'phone', 'telefono 1', 'telefono fijo']],
  ['mobile', ['movil', 'telefono movil', 'celular', 'mobile', 'telefono 2']],
  ['fax', ['fax']],
  ['website', ['web', 'pagina web', 'url', 'sitio web', 'website']],
  ['address', ['direccion', 'domicilio', 'calle', 'direccion fiscal', 'domicilio fiscal', 'address']],
  ['postalCode', ['cp', 'c p', 'codigo postal', 'cod postal', 'c postal', 'zip', 'postal code']],
  ['city', ['poblacion', 'ciudad', 'localidad', 'municipio', 'city']],
  ['province', ['provincia', 'province', 'region']],
  ['country', ['pais', 'country', 'nacion']],
  ['iban', ['iban', 'cuenta', 'cuenta bancaria', 'ccc', 'numero de cuenta', 'n cuenta', 'banco']],
  ['paymentTerms', ['plazo', 'plazo de pago', 'dias de pago', 'dias pago', 'vencimiento']],
  ['irpf', ['irpf', 'retencion', '% irpf']],
  ['notes', ['notas', 'observaciones', 'comentarios', 'notes']],
  ['role', ['tipo', 'tipo de contacto', 'relacion']],
  ['code', ['codigo', 'cod', 'cod cliente', 'codigo cliente', 'codigo proveedor', 'n cliente', 'num cliente', 'id']],
] as const)
