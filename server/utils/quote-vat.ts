import type { ExtractedDocument, ExtractedTaxLine } from '../../shared/types/import'
import { pctOf, round2 } from '../../shared/utils/tax'

/** Resuelve la notación comercial de presupuestos sin inventar un tipo fiscal distinto al configurado. */
export function resolveQuoteVat(original: ExtractedDocument, companyVatRate?: number | null): { document: ExtractedDocument, calculation: string | null } {
  const unchanged = { document: original, calculation: null }
  if (original.documentType !== 'quote' && original.documentType !== 'proforma') return unchanged
  const presentation = original.vatPresentation
  const text = [presentation?.evidence, original.summary, ...original.warnings, ...original.lines.map(l => l.description)].filter(Boolean).join(' ').toLowerCase()
  const mode = presentation?.mode && presentation.mode !== 'unknown' ? presentation.mode
    : /exent[oa]\s+(?:de\s+)?iva|iva\s+exent/.test(text) ? 'exempt'
      : /(?:\+|más|mas)\s*(?:\d+(?:[.,]\d+)?\s*%\s*(?:de\s*)?)?iva|sin\s+iva|iva\s+(?:(?:indicado\s+)?como\s+)?no\s+incluid/.test(text) ? 'excluded'
        : /iva\s+incluid/.test(text) ? 'included' : 'unknown'
  if (mode === 'unknown') return unchanged
  const validRate = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100
  const textualRate = /(?:iva\s*(?:al\s*)?(\d+(?:[.,]\d+)?)\s*%|(\d+(?:[.,]\d+)?)\s*%\s*(?:de\s+)?iva)/i.exec(presentation?.evidence ?? text)
  const parsedRate = textualRate ? Number((textualRate[1] ?? textualRate[2])!.replace(',', '.')) : null
  const lineRates = [...new Set(original.lines.map(l => l.vatRate).filter(validRate))]
  const explicitRate = validRate(presentation?.rate) ? presentation.rate : validRate(parsedRate) ? parsedRate : lineRates.length === 1 ? lineRates[0] : undefined
  const rate = mode === 'exempt' ? 0 : explicitRate ?? (validRate(companyVatRate) ? companyVatRate : 21)
  const lineSum = round2(original.lines.reduce((sum, l) => sum + l.amount, 0))
  const amount = presentation?.amount ?? (mode === 'excluded' && original.lines.length ? lineSum : original.total)
  if (amount != null && !Number.isFinite(amount)) return unchanged
  const close = (a: number, b: number) => Math.abs(a - b) <= 0.02
  const meaningfulTaxes = original.taxLines.some(t => t.vatRate !== 0 || t.vatAmount !== 0 || t.surchargeAmount !== 0)
  // Un desglose explícito siempre prevalece. Solo corregir «total» si se leyó como tal el precio + IVA.
  if (meaningfulTaxes || (original.taxLines.length && !(mode === 'excluded' && rate > 0))) {
    const base = round2(original.taxLines.reduce((sum, t) => sum + t.base, 0))
    if (mode !== 'excluded' || original.total == null || presentation?.amount == null || !close(original.total, presentation.amount) || !close(base, presentation.amount)) return unchanged
    return { document: { ...original, total: null }, calculation: 'El precio indicado sin IVA se ha convertido al total con los impuestos desglosados en el documento' }
  }
  let taxLines: ExtractedTaxLine[]
  const mixed = lineRates.length > 1
  if (mixed && amount != null && !close(lineSum, amount)) {
    const computedGross = round2(original.lines.reduce((sum, l) => sum + l.amount + pctOf(l.amount, l.vatRate ?? rate), 0))
    if (mode !== 'included' || !close(computedGross, amount)) return unchanged
  }
  if (original.lines.length && (amount == null || close(lineSum, amount) || mixed)) {
    const groups = new Map<number, number>()
    for (const line of original.lines) {
      const lineRate = mode === 'exempt' ? 0 : line.vatRate ?? rate
      // Si el precio incluido ya se extrajo como base, no se divide una segunda vez.
      const base = mode === 'included' && (amount == null || close(lineSum, amount)) ? round2(line.amount / (1 + lineRate / 100)) : line.amount
      groups.set(lineRate, round2((groups.get(lineRate) ?? 0) + base))
    }
    taxLines = [...groups].map(([vatRate, base]) => ({ base, vatRate, vatAmount: pctOf(base, vatRate), surchargeRate: 0, surchargeAmount: 0 }))
  }
  else if (amount != null) {
    const base = mode === 'included' ? round2(amount / (1 + rate / 100)) : round2(amount)
    taxLines = [{ base, vatRate: rate, vatAmount: pctOf(base, rate), surchargeRate: 0, surchargeAmount: 0 }]
  }
  else return unchanged
  // Al reconstruir bases desde precios con IVA incluido, las líneas comerciales también deben ser netas.
  const single = taxLines.length === 1 ? taxLines[0]!.vatRate : null
  const lines = original.lines.map(l => {
    const vatRate = mode === 'exempt' ? 0 : l.vatRate ?? single ?? rate
    const divide = mode === 'included' && (amount == null || close(lineSum, amount))
    return { ...l, vatRate, ...(divide ? { amount: round2(l.amount / (1 + vatRate / 100)), unitPrice: l.unitPrice / (1 + vatRate / 100) } : {}) }
  })
  const resolvedWarning = (w: string) => /iva|fiscal/i.test(w) && /no incluid|sin desglose|no (?:aparece|hay|se encontr[oó]|se indica|est[aá]).*(?:desglose|tipo|iva)|falta.*(?:desglose|tipo|iva)|sin (?:tipo|cuota)/i.test(w)
  const total = mode === 'excluded' && (original.total == null || amount == null || close(original.total, amount)) ? null : original.total
  const source = mode === 'exempt' ? 'exención indicada en el documento' : mixed || explicitRate != null ? 'tipo indicado en el documento' : 'tipo configurado en tu empresa'
  return {
    document: { ...original, lines, taxLines, total, warnings: original.warnings.filter(w => !resolvedWarning(w)) },
    calculation: `IVA calculado automáticamente${mixed ? '' : ` al ${rate} %`}: ${source}${mode === 'included' ? ', a partir del precio con IVA incluido' : ''}`,
  }
}
