/**
 * Lectura de extractos bancarios: Norma 43 (AEB, cuaderno 43, el formato que exportan todos los bancos
 * españoles) y CSV o Excel de cualquier banco, detectando las columnas por su cabecera.
 */

export interface BankRow {
  date: string
  valueDate: string | null
  amount: number
  description: string
  counterparty: string | null
  reference: string | null
  bankCode: string | null
  balance: number | null
}

export interface ParsedStatement {
  format: 'norma43' | 'sheet'
  iban: string | null
  bankName: string | null
  holder: string | null
  rows: BankRow[]
  /** Saldo al final del extracto, si viene */
  closingBalance: number | null
}

/** ¿Es un fichero Norma 43? Registros de 80 posiciones que empiezan por 11 (cabecera de cuenta) */
export function isNorma43(text: string) {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  return lines.length >= 2 && /^11\d{18}/.test(lines[0]!) && lines.some(l => l.startsWith('22')) && lines.every(l => /^(00|11|22|23|24|33|88)/.test(l))
}

const n43Date = (s: string) => {
  if (!/^\d{6}$/.test(s)) return null
  const iso = `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`
  return Number.isNaN(Date.parse(iso)) ? null : iso
}
const n43Amount = (s: string) => Number(s) / 100

/** Dígitos de control de una cuenta CCC (entidad, oficina, cuenta) */
function cccControl(entity: string, office: string, account: string) {
  const weights = [1, 2, 4, 8, 5, 10, 9, 7, 3, 6]
  const dc = (digits: string) => {
    const sum = digits.split('').reduce((acc, d, i) => acc + Number(d) * weights[i]!, 0)
    const r = 11 - (sum % 11)
    return r === 11 ? 0 : r === 10 ? 1 : r
  }
  return `${dc(`00${entity}${office}`)}${dc(account)}`
}

/** IBAN español a partir de la cuenta de 20 dígitos */
export function ibanFromCcc(ccc: string) {
  if (!/^\d{20}$/.test(ccc)) return null
  // ES = 14 28, más "00" para calcular el control
  const numeric = `${ccc}142800`
  let mod = 0
  for (const ch of numeric) mod = (mod * 10 + Number(ch)) % 97
  return `ES${String(98 - mod).padStart(2, '0')}${ccc}`
}

export function parseNorma43(text: string): ParsedStatement {
  const rows: BankRow[] = []
  let iban: string | null = null
  let entity: string | null = null
  let holder: string | null = null
  let closingBalance: number | null = null
  let current: BankRow | null = null
  const extras: string[] = []
  const flush = () => {
    if (!current) return
    const texts = [...new Set(extras.map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean))]
    if (texts.length) {
      current.counterparty ??= texts[0]!.slice(0, 200)
      current.description = [...texts, current.description].filter(Boolean).join(' · ').slice(0, 500)
    }
    if (!current.description) current.description = BANK_CODE_LABELS[current.bankCode ?? ''] ?? 'Movimiento'
    rows.push(current)
    current = null
    extras.length = 0
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.padEnd(80, ' ')
    const type = line.slice(0, 2)
    if (type === '11') {
      flush()
      entity = line.slice(2, 6)
      const office = line.slice(6, 10)
      const account = line.slice(10, 20)
      if (/^\d{18}$/.test(`${entity}${office}${account}`)) iban = ibanFromCcc(`${entity}${office}${cccControl(entity, office, account)}${account}`)
      holder = line.slice(51, 77).trim() || null
    }
    else if (type === '22') {
      flush()
      const sign = line[27] === '1' ? -1 : 1
      const date = n43Date(line.slice(10, 16))
      if (!date) continue
      const ref1 = line.slice(52, 64).trim().replace(/^0+$/, '')
      const ref2 = line.slice(64, 80).trim()
      current = {
        date,
        valueDate: n43Date(line.slice(16, 22)),
        amount: sign * n43Amount(line.slice(28, 42)),
        description: ref2,
        counterparty: null,
        reference: ref1 || null,
        bankCode: line.slice(22, 24),
        balance: null,
      }
    }
    else if (type === '23' && current) {
      extras.push(line.slice(4, 42), line.slice(42, 80))
    }
    else if (type === '33') {
      flush()
      closingBalance = (line[58] === '1' ? -1 : 1) * n43Amount(line.slice(59, 73))
    }
  }
  flush()
  return { format: 'norma43', iban, bankName: entity ? BANKS[entity] ?? null : null, holder, rows, closingBalance }
}

/** Cabeceras habituales de los extractos de los bancos españoles */
const HEAD = {
  date: /^(f(echa)?\.?\s*)?(operaci[oó]n|oper\.?|contable|movimiento|transacci[oó]n)$|^fecha$|^date$|^fecha (de )?(la )?operaci[oó]n$/i,
  valueDate: /valor/i,
  description: /concepto|descripci[oó]n|detalle|movimiento|observaciones|m[aá]s datos|beneficiario|ordenante|remitente|comercio|^texto/i,
  amount: /^(importe|cantidad|amount|euros?|importe \(?(eur|€)\)?)$|^importe/i,
  debit: /^(cargos?|debe|d[eé]bito|salidas?|gastos?|pagos?)$/i,
  credit: /^(abonos?|haber|cr[eé]dito|entradas?|ingresos?|cobros?)$/i,
  balance: /saldo|balance|disponible/i,
  reference: /referencia|n[º°]?\s*doc|documento/i,
}

export interface BankColumns {
  header: number
  date: number
  valueDate: number | null
  description: number[]
  amount: number | null
  debit: number | null
  credit: number | null
  balance: number | null
  reference: number | null
}

/** Busca la fila de cabecera y qué columna es cada dato */
function detectColumns(rows: SheetCell[][]): BankColumns | null {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const cells = rows[r]!.map(c => cellText(c).trim())
    const find = (re: RegExp, skip: number[] = []) => cells.findIndex((c, i) => c && re.test(c) && !skip.includes(i))
    let date = cells.findIndex(c => c && HEAD.date.test(c) && !HEAD.valueDate.test(c))
    const valueDate = find(HEAD.valueDate)
    if (date < 0 && valueDate >= 0) date = valueDate
    if (date < 0) continue
    const amount = find(HEAD.amount)
    const debit = find(HEAD.debit)
    const credit = find(HEAD.credit)
    if (amount < 0 && (debit < 0 || credit < 0)) continue
    const balance = find(HEAD.balance)
    const reference = find(HEAD.reference)
    const used = [date, valueDate, amount, debit, credit, balance, reference]
    const description = cells.map((c, i) => (c && HEAD.description.test(c) && !used.includes(i) ? i : -1)).filter(i => i >= 0)
    return {
      header: r,
      date,
      valueDate: valueDate >= 0 && valueDate !== date ? valueDate : null,
      description,
      amount: amount >= 0 ? amount : null,
      debit: amount < 0 ? debit : null,
      credit: amount < 0 ? credit : null,
      balance: balance >= 0 ? balance : null,
      reference: reference >= 0 ? reference : null,
    }
  }
  return null
}

/** Extracto en hoja de cálculo o CSV: la primera hoja con columnas reconocibles */
export function parseBankSheets(sheets: SheetData[]): ParsedStatement | null {
  for (const sheet of sheets) {
    const cols = detectColumns(sheet.rows)
    const parsed = cols && statementFromColumns(sheet, cols)
    if (parsed) return parsed
  }
  return null
}

/** Movimientos de una hoja con las columnas ya identificadas (por cabecera o por la IA) */
export function statementFromColumns(sheet: SheetData, cols: BankColumns, order: 'dmy' | 'mdy' | 'ymd' = 'dmy'): ParsedStatement | null {
  const rows: BankRow[] = []
  for (const r of sheet.rows.slice(cols.header + 1)) {
    const date = parseSheetDate(r[cols.date], order)
    if (!date) continue
    let amount: number | null
    if (cols.amount != null) amount = parseAmount(r[cols.amount])
    else {
      const d = parseAmount(r[cols.debit!])
      const c = parseAmount(r[cols.credit!])
      amount = d || c ? round2((c ?? 0) - Math.abs(d ?? 0)) : null
    }
    if (amount == null || amount === 0) continue
    const texts = cols.description.map(i => cellText(r[i] ?? null).trim()).filter(Boolean)
    // Sin columna de concepto reconocida: el texto más largo de la fila
    const fallback = texts.length ? '' : r.map(c => (typeof c === 'string' ? c.trim() : '')).sort((a, b) => b.length - a.length)[0] ?? ''
    rows.push({
      date,
      valueDate: cols.valueDate != null ? parseSheetDate(r[cols.valueDate], order) : null,
      amount: round2(amount),
      description: ([...new Set(texts)].join(' · ') || fallback || 'Movimiento').slice(0, 500),
      counterparty: null,
      reference: cols.reference != null ? cellText(r[cols.reference] ?? null).trim().slice(0, 120) || null : null,
      bankCode: null,
      balance: cols.balance != null ? parseAmount(r[cols.balance]) : null,
    })
  }
  if (!rows.length) return null
  // IBAN y titular suelen ir en las filas de encima de la cabecera
  const top = sheet.rows.slice(0, cols.header).map(r => r.map(cellText).join(' ')).join(' ')
  const ibanMatch = top.replace(/\s+/g, '').match(/ES\d{22}/i)
  const iban = ibanMatch ? ibanMatch[0].toUpperCase() : null
  // Saldo final: el del último movimiento (los bancos ordenan de más reciente a más antiguo o al revés)
  const first = rows[0]!
  const last = rows.at(-1)!
  const newest = first.date > last.date ? first : last
  return { format: 'sheet', iban, bankName: iban ? BANKS[iban.slice(4, 8)] ?? null : null, holder: null, rows, closingBalance: newest.balance }
}

/** Nombre del banco por el código de entidad del IBAN */
export function bankNameOf(iban: string | null | undefined) {
  const clean = iban?.replace(/\s/g, '').toUpperCase() ?? ''
  return clean.startsWith('ES') ? BANKS[clean.slice(4, 8)] ?? null : null
}

/** Conceptos comunes AEB de la Norma 43 */
export const BANK_CODE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  '01': 'Reintegro',
  '02': 'Ingreso',
  '03': 'Recibo domiciliado',
  '04': 'Transferencia',
  '05': 'Préstamo',
  '06': 'Remesa de efectos',
  '07': 'Valores',
  '11': 'Cajero',
  '12': 'Tarjeta',
  '13': 'Operación con el extranjero',
  '14': 'Devolución',
  '15': 'Nóminas y seguros sociales',
  '16': 'Timbres y corretajes',
  '17': 'Comisiones e intereses',
  '98': 'Anulación',
  '99': 'Varios',
})

/** Entidades más habituales (código del IBAN, posiciones 5-8) */
const BANKS: Readonly<Record<string, string>> = Object.freeze({
  '0049': 'Banco Santander',
  '0075': 'Banco Santander',
  '0030': 'Banco Santander',
  '0182': 'BBVA',
  '2100': 'CaixaBank',
  '2038': 'CaixaBank',
  '0081': 'Banco Sabadell',
  '0128': 'Bankinter',
  '1465': 'ING',
  '0073': 'Openbank',
  '2085': 'Ibercaja',
  '2080': 'Abanca',
  '2103': 'Unicaja',
  '2048': 'Unicaja',
  '2095': 'Kutxabank',
  '3058': 'Cajamar',
  '3035': 'Laboral Kutxa',
  '0239': 'EVO Banco',
  '1491': 'Triodos Bank',
  '0186': 'Banco Mediolanum',
  '0019': 'Deutsche Bank',
  '0061': 'Banca March',
  '0216': 'Targobank',
  '0234': 'Banco Caminos',
  '3190': 'Globalcaja',
  '3081': 'Eurocaja Rural',
  '3187': 'Caja Rural del Sur',
  '0487': 'Banco Mare Nostrum',
  '1583': 'Revolut',
  '0083': 'Renta 4',
  '3183': 'Arquia Banca',
  '0138': 'Bankoa',
  '0131': 'Novo Banco',
  '1563': 'MyInvestor',
})
