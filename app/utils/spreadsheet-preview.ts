import * as XLSX from 'xlsx'

export const PREVIEW_PAGE_ROWS = 100
const MAX_COLUMNS = 100

export function readPreviewWorkbook(data: ArrayBuffer, name: string) {
  const text = /\.(csv|tsv)$/i.test(name)
  let input: ArrayBuffer | string = data
  if (text) {
    try { input = new TextDecoder('utf-8', { fatal: true }).decode(data) }
    catch { input = new TextDecoder('windows-1252').decode(data) }
  }
  return XLSX.read(input, { type: text ? 'string' : 'array', raw: text, dense: true, cellNF: true, cellHTML: false, FS: /\.tsv$/i.test(name) ? '\t' : undefined })
}

/** Solo se materializan las celdas de la página visible, incluso con rangos muy grandes. */
export function spreadsheetPage(workbook: XLSX.WorkBook, sheet: string, page: number) {
  const ws = workbook.Sheets[sheet]
  const range = XLSX.utils.decode_range(ws?.['!ref'] ?? 'A1')
  const total = ws?.['!ref'] ? range.e.r - range.s.r + 1 : 0
  const pages = Math.max(1, Math.ceil(total / PREVIEW_PAGE_ROWS))
  const current = Math.min(Math.max(0, page), pages - 1)
  const first = range.s.r + current * PREVIEW_PAGE_ROWS
  const last = Math.min(range.e.r, first + PREVIEW_PAGE_ROWS - 1)
  const lastColumn = Math.min(range.e.c, range.s.c + MAX_COLUMNS - 1)
  const columns = Array.from({ length: lastColumn - range.s.c + 1 }, (_, i) => XLSX.utils.encode_col(range.s.c + i))
  const dense = ws?.['!data'] as XLSX.CellObject[][] | undefined
  const rows = total ? Array.from({ length: last - first + 1 }, (_, i) => {
    const r = first + i
    return { number: r + 1, cells: columns.map((_, j) => {
      const c = range.s.c + j
      const cell = dense ? dense[r]?.[c] : ws?.[XLSX.utils.encode_cell({ r, c })]
      return cell ? XLSX.utils.format_cell(cell) : ''
    }) }
  }) : []
  return { columns, rows, pages, current, total, limitedColumns: range.e.c > lastColumn }
}
