import type { ExtractedDocument, ExtractedParty, ImportCatalogData, ImportContactData, ImportDirection, ImportInvoiceData } from '../../shared/types/import'

/**
 * Hojas de cálculo (Excel, CSV) exportadas de otros programas: la IA mira las primeras filas y dice
 * qué contiene cada columna; las filas se convierten aquí, sin IA, aunque sean miles.
 */

// ─── Lectura de valores escritos a la española ───────────────────────────────

/** "1.234,56 €", "1,234.56", "(12,50)", 1234.5 → número; null si no es un importe */
export function parseAmount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  let s = v.replace(/[€$£\s ]|eur(os)?/gi, '')
  if (!s) return null
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  if (s.endsWith('-')) {
    negative = true
    s = s.slice(0, -1)
  }
  if (!/^[+-]?[\d.,]+$/.test(s)) return null
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  if (lastDot >= 0 && lastComma >= 0) s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  else if (lastComma >= 0) s = /^[+-]?\d{1,3}(,\d{3}){2,}$/.test(s) ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.')
  else if (/^[+-]?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return negative ? -Math.abs(n) : n
}

/** "21 %", "21", 0.21 (formato porcentaje de Excel) → 21 */
export function parsePercent(v: unknown): number | null {
  if (typeof v === 'number') return v > 0 && v < 1 ? round2(v * 100) : v
  if (typeof v !== 'string') return null
  const n = parseAmount(v.replace('%', ''))
  return n == null ? null : n > 0 && n < 1 && !v.includes('%') ? round2(n * 100) : n
}

/** "23/10/2026", "23-10-26", "2026-10-23", número de serie de Excel → 'AAAA-MM-DD' */
export function parseSheetDate(v: unknown, order: 'dmy' | 'mdy' | 'ymd' = 'dmy'): string | null {
  if (typeof v === 'number') return v > 20000 && v < 80000 ? excelSerialDate(v) : null
  if (typeof v !== 'string') return null
  const s = v.trim()
  let y: number, m: number, d: number
  let match = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  else {
    match = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/)
    if (!match) return null
    const a = Number(match[1])
    const b = Number(match[2])
    y = Number(match[3])
    if (y < 100) y += y > 70 ? 1900 : 2000
    ;[d, m] = order === 'mdy' && b <= 12 ? [b, a] : [a, b]
    if (m > 12 && d <= 12) [d, m] = [m, d]
  }
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const date = new Date(`${iso}T12:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null
}

/** "Sí", "pagada", "x", true, 1 → true; "no", "pendiente" → false */
export function parseYes(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (/^(si|s|x|yes|y|true|pagad[ao]|cobrad[ao]|liquidad[ao]|ok)$/.test(s)) return true
  if (/^(no|n|false|pendiente|impagad[ao]|-)$/.test(s)) return false
  return null
}

// ─── Análisis con IA ─────────────────────────────────────────────────────────

const COLUMN_KEYS = Object.freeze(['number', 'issueDate', 'dueDate', 'partyName', 'partyNif', 'partyAddress', 'partyPostalCode', 'partyCity', 'partyProvince', 'partyCountry', 'partyEmail', 'partyPhone', 'description', 'base', 'vatRate', 'vatAmount', 'surchargeAmount', 'irpfRate', 'irpfAmount', 'total', 'paid', 'paymentMethod', 'itemName', 'itemSku', 'itemPrice', 'itemVatRate', 'itemKind'] as const)

type ColumnKey = typeof COLUMN_KEYS[number]

export interface SheetMapping {
  name: string
  kind: 'invoice_document' | 'invoice_list' | 'contact_list' | 'item_list' | 'other'
  direction: 'issued' | 'received' | 'unknown'
  contactRole: 'client' | 'supplier' | 'both' | 'unknown'
  headerRow: number | null
  firstDataRow: number
  dateOrder: 'dmy' | 'mdy' | 'ymd'
  columns: Record<ColumnKey, number | null>
  taxGroups: Array<{ baseColumn: number, vatRate: number | null, vatAmountColumn: number | null }>
  defaultVatRate: number | null
}

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
          required: ['name', 'kind', 'direction', 'contactRole', 'headerRow', 'firstDataRow', 'dateOrder', 'columns', 'taxGroups', 'defaultVatRate'],
          properties: {
            name: { type: 'string' },
            kind: { type: 'string', enum: ['invoice_document', 'invoice_list', 'contact_list', 'item_list', 'other'] },
            direction: { type: 'string', enum: ['issued', 'received', 'unknown'] },
            contactRole: { type: 'string', enum: ['client', 'supplier', 'both', 'unknown'] },
            headerRow: col,
            firstDataRow: { type: 'integer' },
            dateOrder: { type: 'string', enum: ['dmy', 'mdy', 'ymd'] },
            columns: {
              type: 'object',
              additionalProperties: false,
              required: [...COLUMN_KEYS],
              properties: Object.fromEntries(COLUMN_KEYS.map(k => [k, col])),
            },
            taxGroups: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['baseColumn', 'vatRate', 'vatAmountColumn'],
                properties: { baseColumn: { type: 'integer' }, vatRate: { type: ['number', 'null'] }, vatAmountColumn: col },
              },
            },
            defaultVatRate: { type: ['number', 'null'] },
          },
        },
      },
    },
  }
}

const SHEET_SYSTEM = `Analizas hojas de cálculo españolas exportadas de programas de facturación o hechas a mano.
Para cada hoja indica qué contiene y en qué columna está cada dato. Las columnas se numeran desde 0 (el número que precede a cada celda) y las filas con R1, R2…

kind:
- invoice_list: listado o libro de facturas (una fila por factura, o por tipo de IVA de una factura).
- invoice_document: una única factura maquetada en la hoja.
- contact_list: listado de clientes o proveedores.
- item_list: catálogo de productos o servicios con precio.
- other: cualquier otra cosa.

headerRow: fila de la cabecera (null si no hay). firstDataRow: primera fila con datos.
columns: índice de la columna de cada dato, null si no existe. party* es el cliente (facturas emitidas) o el proveedor (recibidas). base es la base imponible; total, el importe total con IVA.
taxGroups: solo si hay columnas de base separadas por tipo de IVA (Base 21 %, Base 10 %…): una entrada por tipo con su columna de cuota. Si no, lista vacía.
defaultVatRate: tipo de IVA si toda la hoja usa uno fijo y no hay columna de tipo.
direction: issued si son facturas emitidas, ventas o clientes; received si son recibidas, compras, gastos o proveedores; unknown si no se sabe.
contactRole (listados de contactos): client, supplier, both o unknown.
dateOrder: orden de las fechas escritas como texto (en España, dmy).`

/** Vista previa de las hojas para la IA: primeras filas con el índice de cada columna */
function sheetsPreview(sheets: SheetData[]) {
  return sheets.slice(0, 6).map(s => [
    `Hoja "${s.name}" (${s.rows.length} filas):`,
    ...s.rows.slice(0, 30).map((r, i) => `R${i + 1}: ${r.map((c, j) => (c == null ? null : `${j}=${cellText(c).slice(0, 48)}`)).filter(Boolean).join(' | ')}`),
  ].join('\n')).join('\n\n')
}

export async function analyzeSheets(sheets: SheetData[], ctx: ExtractContext) {
  const c = ctx.company
  const res = await aiJson<{ sheets: SheetMapping[] }>({
    name: 'hojas',
    schema: mappingSchema(),
    system: SHEET_SYSTEM,
    parts: [{ type: 'input_text', text: `Empresa usuaria: ${c.legalName}, NIF ${c.nif}.\nArchivo: ${ctx.path}\n\n${sheetsPreview(sheets)}` }],
    effort: 'low',
  })
  return { ...res, mappings: res.data.sheets }
}

/** Una hoja que es una factura maquetada: se le pasa a la IA como texto */
export function sheetAsText(sheet: SheetData) {
  return sheet.rows.slice(0, 400).map(r => r.map(cellText).join(' | ')).join('\n')
}

// ─── Filas → registros ───────────────────────────────────────────────────────

export interface SheetRecord {
  type: 'sales' | 'expense' | 'contact' | 'item'
  data: ImportInvoiceData | ImportContactData | ImportCatalogData
  warnings: string[]
  blocking: boolean
}

function rowReader(row: SheetCell[], columns: SheetMapping['columns']) {
  return (key: ColumnKey) => {
    const i = columns[key]
    return i == null || i < 0 ? null : row[i] ?? null
  }
}

const textOf = (v: SheetCell | null) => (v == null ? null : cellText(v).trim() || null)

function partyFrom(get: (k: ColumnKey) => SheetCell | null): ExtractedParty | null {
  const name = textOf(get('partyName'))
  const nif = textOf(get('partyNif'))
  if (!name && !nif) return null
  return {
    name: name ?? nif!,
    nif,
    address: textOf(get('partyAddress')),
    postalCode: textOf(get('partyPostalCode')),
    city: textOf(get('partyCity')),
    province: textOf(get('partyProvince')),
    country: textOf(get('partyCountry')),
    email: textOf(get('partyEmail')),
    phone: textOf(get('partyPhone')),
    isPerson: !!nif && /^(\d{8}|[XYZ]\d{7})[A-Z]$/i.test(normalizeNif(nif)),
  }
}

/** El tipo de IVA más probable para una cuota y su base */
function inferVatRate(base: number, vat: number) {
  if (!base) return null
  const rate = vat / base * 100
  const near = [...VAT_RATES, 5, 2, 7].find(r => Math.abs(r - rate) < 0.3)
  return near ?? round2(rate)
}

type InvoiceRow = { doc: ExtractedDocument, key: string | null }

function invoiceRow(row: SheetCell[], m: SheetMapping, direction: ImportDirection, hasFileDate = false): InvoiceRow | null {
  const get = rowReader(row, m.columns)
  const number = textOf(get('number'))
  const issueDate = parseSheetDate(get('issueDate'), m.dateOrder)
  const total = parseAmount(get('total'))
  const irpfAmount = parseAmount(get('irpfAmount'))
  const irpfRate = parsePercent(get('irpfRate'))

  const taxLines: ExtractedDocument['taxLines'] = []
  if (m.taxGroups.length) {
    for (const g of m.taxGroups) {
      const base = parseAmount(row[g.baseColumn])
      if (!base) continue
      const vatAmount = g.vatAmountColumn != null ? parseAmount(row[g.vatAmountColumn]) : null
      const vatRate = g.vatRate ?? (vatAmount != null ? inferVatRate(base, vatAmount) : null) ?? 0
      taxLines.push({ base, vatRate, vatAmount: vatAmount ?? pctOf(base, vatRate), surchargeRate: 0, surchargeAmount: 0 })
    }
  }
  else {
    let base = parseAmount(get('base'))
    let vatAmount = parseAmount(get('vatAmount'))
    let vatRate = parsePercent(get('vatRate'))
    if (base == null && total != null && vatAmount != null) base = round2(total - vatAmount + Math.abs(irpfAmount ?? 0))
    vatRate ??= base != null && vatAmount != null ? inferVatRate(base, vatAmount) : null
    vatRate ??= m.defaultVatRate
    if (base == null && total != null && vatRate != null && !irpfAmount && !irpfRate) base = round2(total / (1 + vatRate / 100))
    if (base != null) {
      vatRate ??= total != null ? inferVatRate(base, total - base + Math.abs(irpfAmount ?? 0)) : null
      vatAmount ??= pctOf(base, vatRate ?? 0)
      const surchargeAmount = parseAmount(get('surchargeAmount')) ?? 0
      taxLines.push({ base, vatRate: vatRate ?? 0, vatAmount, surchargeRate: surchargeAmount ? (SURCHARGE_BY_VAT[vatRate ?? 0] ?? 0) : 0, surchargeAmount })
    }
  }
  const party = partyFrom(get)
  const description = textOf(get('description'))
  // Con fecha alternativa se admiten facturas sin número/fecha, pero no filas vacías o de totales.
  if (!number && !issueDate && !(hasFileDate && party)) return null
  if (!taxLines.length && total == null) return null

  const paid = parseYes(get('paid'))
  const doc: ExtractedDocument = {
    documentType: (total ?? 0) < 0 ? 'credit_note' : 'invoice',
    issuer: direction === 'received' ? party : null,
    recipient: direction === 'issued' ? party : null,
    number,
    issueDate,
    dueDate: parseSheetDate(get('dueDate'), m.dateOrder),
    currency: 'EUR',
    lines: [],
    taxLines,
    irpfRate,
    irpfAmount: irpfAmount == null ? null : Math.abs(irpfAmount),
    total,
    paymentMethod: null,
    iban: null,
    paid,
    rectifiedNumber: null,
    customerReference: null,
    category: null,
    summary: description,
    confidence: 92,
    warnings: [],
  }
  return { doc, key: number ? `${normalizeDocNumber(number)}|${comparableNif(party?.nif) || comparableName(party?.name)}|${issueDate ?? ''}` : null }
}

/** Una factura repartida en varias filas (una por tipo de IVA) se junta en un solo documento */
export function mergeInvoiceSheetRows(rows: InvoiceRow[]) {
  const out: ExtractedDocument[] = []
  const byKey = new Map<string, ExtractedDocument[]>()
  for (const r of rows) {
    if (!r.key) {
      out.push(r.doc)
      continue
    }
    const list = byKey.get(r.key)
    // Una fila idéntica repetida en el Excel no debe sumar otra vez la misma base e IVA.
    if (list) {
      const signature = (d: ExtractedDocument) => JSON.stringify([d.taxLines, d.total, d.irpfAmount, d.irpfRate, d.summary])
      if (!list.some(d => signature(d) === signature(r.doc))) list.push(r.doc)
    }
    else {
      byKey.set(r.key, [r.doc])
      out.push(r.doc)
    }
  }
  for (const list of byKey.values()) {
    if (list.length < 2) continue
    const first = list[0]!
    const taxLines = list.flatMap(d => d.taxLines)
    const totals = list.map(d => d.total).filter((t): t is number => t != null)
    const sum = round2(taxLines.reduce((s, t) => s + t.base + t.vatAmount + t.surchargeAmount, 0))
    const sameTotal = totals.length === list.length && totals.every(t => t === totals[0])
    first.taxLines = taxLines
    first.total = sameTotal && Math.abs(sum - Math.abs(first.irpfAmount ?? 0) - totals[0]!) <= 0.05 ? totals[0]! : round2(totals.reduce((s, t) => s + t, 0)) || null
    first.irpfAmount = list.reduce((s, d) => s + (d.irpfAmount ?? 0), 0) || null
  }
  return out
}

export function sheetRecords(sheet: SheetData, m: SheetMapping, ctx: ExtractContext, hint: ImportDirection | null): SheetRecord[] {
  // Filas numeradas desde 1 en la vista previa; los datos empiezan después de la cabecera
  const start = Math.max(m.firstDataRow - 1, m.headerRow ?? 0, 0)
  const header = m.headerRow ? sheet.rows[m.headerRow - 1]?.map(cellText).join('|') : null
  const rows = sheet.rows.slice(start).filter(r => r.map(cellText).join('|') !== header)
  const chosen = ctx.direction !== 'auto' ? ctx.direction : null
  const direction: ImportDirection = chosen ?? (m.direction !== 'unknown' ? m.direction : hint) ?? 'received'

  if (m.kind === 'invoice_list') {
    const docs = mergeInvoiceSheetRows(rows.map(r => invoiceRow(r, m, direction, !!ctx.fileDate)).filter((r): r is InvoiceRow => !!r))
    return docs.map((doc) => {
      const conv = toInvoiceData(doc, direction, ctx)
      return { type: direction === 'issued' ? 'sales' : 'expense', data: conv.data, warnings: conv.warnings, blocking: conv.blocking }
    })
  }

  if (m.kind === 'contact_list') {
    const role = m.contactRole !== 'unknown' ? m.contactRole : direction === 'received' ? 'supplier' : 'client'
    return rows.flatMap((r) => {
      const party = partyFrom(rowReader(r, m.columns))
      if (!party) return []
      const p = toImportParty(party)
      const warnings = p.nif && p.country === 'ES' && !validateNif(p.nif).valid ? [`El NIF ${p.nif} no es válido`] : []
      return [{ type: 'contact' as const, data: { party: p, isClient: role !== 'supplier', isSupplier: role !== 'client' }, warnings, blocking: false }]
    })
  }

  if (m.kind === 'item_list') {
    return rows.flatMap((r) => {
      const get = rowReader(r, m.columns)
      const name = textOf(get('itemName')) ?? textOf(get('description'))
      if (!name) return []
      const price = parseAmount(get('itemPrice'))
      const kindText = (textOf(get('itemKind')) ?? '').toLowerCase()
      const data: ImportCatalogData = {
        name: name.slice(0, 200),
        sku: textOf(get('itemSku'))?.slice(0, 60) ?? null,
        kind: /produc|art[ií]culo|material|mercanc/.test(kindText) ? 'product' : 'service',
        unitPrice: price != null && price >= 0 ? price : 0,
        vatRate: parsePercent(get('itemVatRate')) ?? m.defaultVatRate ?? 21,
        description: m.columns.itemName != null ? textOf(get('description')) : null,
      }
      return [{ type: 'item' as const, data, warnings: price == null ? ['Sin precio: revísalo'] : [], blocking: false }]
    })
  }
  return []
}
