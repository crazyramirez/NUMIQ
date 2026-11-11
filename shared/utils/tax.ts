/**
 * Cálculo de importes de facturas españolas. Mismo código en el editor (en vivo) y en el servidor
 * (lo que se guarda): el cliente nunca decide los totales.
 *
 * Criterio: base por línea redondeada a céntimos; IVA y recargo calculados por tipo sobre la suma de
 * bases de ese tipo (así se declaran en el 303 y en VeriFactu); IRPF sobre las bases sujetas.
 */

/**
 * Redondeo a céntimos, mitades hacia fuera (1,005 → 1,01; −1,005 → −1,01). Vía notación
 * exponencial: 1.005 * 100 en coma flotante da 100,4999… y Math.round fallaría.
 */
export function round2(n: number) {
  const abs = Math.abs(n)
  const r = Number(`${Math.round(Number(`${abs}e2`))}e-2`)
  return n < 0 ? -r : r
}

/**
 * Porcentaje de un importe en aritmética entera de céntimos: 1.015,50 × 15 % = 152,33 exactos
 * (en coma flotante saldría 152,3249999… → 152,32).
 */
export function pctOf(amount: number, rate: number) {
  const cents = Math.round(Number(`${amount}e2`))
  const basisPoints = Math.round(Number(`${rate}e2`))
  const raw = cents * basisPoints / 10000
  return Math.sign(raw) * Math.round(Math.abs(raw)) / 100
}

// Listas con Object.freeze(): el escáner de auto-imports (mlly) se salta la exportación que sigue a un literal de array
export const VAT_RATES: readonly number[] = Object.freeze([21, 10, 4, 0])

export const IRPF_RATES: readonly number[] = Object.freeze([0, 1, 2, 7, 15, 19])

/** Recargo de equivalencia que corresponde a cada tipo de IVA */
export const SURCHARGE_BY_VAT: Record<number, number> = { 21: 5.2, 10: 1.4, 4: 0.5, 0: 0 }

export interface LineInput {
  quantity: number
  unitPrice: number
  discountPct?: number | null
  vatRate: number
  surchargeRate?: number | null
  irpfApplies?: boolean | null
}

export interface TaxGroup {
  vatRate: number
  surchargeRate: number
  base: number
  vat: number
  surcharge: number
}

export interface Totals {
  subtotal: number
  discountTotal: number
  taxBase: number
  vatTotal: number
  surchargeTotal: number
  irpfBase: number
  irpfTotal: number
  total: number
  groups: TaxGroup[]
}

export function lineAmounts(l: LineInput) {
  // Cantidad (3 decimales) × precio (4 decimales) en enteros: 3 × 19,95 = 59,85 exactos
  const q = Math.round(Number(`${Number(l.quantity) || 0}e3`))
  const p = Math.round(Number(`${Number(l.unitPrice) || 0}e4`))
  const rawCents = q * p / 100000
  const gross = Math.sign(rawCents) * Math.round(Math.abs(rawCents)) / 100
  const discount = pctOf(gross, Number(l.discountPct) || 0)
  return { gross, discount, base: round2(gross - discount) }
}

/**
 * Precio unitario sin IVA (4 decimales) para un precio escrito con IVA, de modo que la línea con su IVA
 * dé exactamente cantidad × precio con IVA (menos el descuento). Dividir sin más descuadra un céntimo:
 * 100 € con IVA → 82,6446 → base 82,64 + IVA 17,35 = 99,99 €.
 */
export function netUnitFromGross(grossUnit: number, quantity: number, discountPct: number, vatRate: number): number {
  const rate = Number(vatRate) || 0
  const naive = Math.round(Number(`${(Number(grossUnit) || 0) / (1 + rate / 100)}e4`)) / 1e4
  const q = Number(quantity) || 0
  const d = Number(discountPct) || 0
  if (!q || d >= 100) return naive
  // Total con IVA que debe dar la línea, con los mismos redondeos que el cálculo de la factura
  const target = lineAmounts({ quantity: q, unitPrice: grossUnit, discountPct: d, vatRate: rate }).base
  const withVat = (base: number) => round2(base + pctOf(base, rate))
  // Base en céntimos cuyo total con IVA se acerca más al objetivo (alguno puede no existir: se queda el más cercano)
  const c0 = Math.round(Number(`${target / (1 + rate / 100)}e2`))
  let base = c0 / 100
  for (let c = c0 - 3; c <= c0 + 3; c++) {
    if (Math.abs(withVat(c / 100) - target) < Math.abs(withVat(base) - target) - 1e-9) base = c / 100
  }
  // Precio que, por la cantidad y el descuento, da esa base
  const p0 = Math.round(Number(`${base / (q * (1 - d / 100))}e4`))
  for (let i = 0; i <= 50; i++) {
    for (const p of i ? [p0 - i, p0 + i] : [p0]) {
      if (lineAmounts({ quantity: q, unitPrice: p / 1e4, discountPct: d, vatRate: rate }).base === base) return p / 1e4
    }
  }
  return p0 / 1e4
}

export function computeTotals(lines: LineInput[], irpfRate = 0): Totals {
  let subtotal = 0
  let discountTotal = 0
  let irpfBase = 0
  const byRate = new Map<string, TaxGroup>()

  for (const l of lines) {
    const { gross, discount, base } = lineAmounts(l)
    subtotal += gross
    discountTotal += discount
    if (l.irpfApplies !== false) irpfBase += base
    const vatRate = Number(l.vatRate) || 0
    const surchargeRate = Number(l.surchargeRate) || 0
    const key = `${vatRate}|${surchargeRate}`
    const g = byRate.get(key) ?? { vatRate, surchargeRate, base: 0, vat: 0, surcharge: 0 }
    g.base = round2(g.base + base)
    byRate.set(key, g)
  }

  const groups = [...byRate.values()]
    .map(g => ({ ...g, vat: pctOf(g.base, g.vatRate), surcharge: pctOf(g.base, g.surchargeRate) }))
    .sort((a, b) => b.vatRate - a.vatRate)

  const taxBase = round2(groups.reduce((s, g) => s + g.base, 0))
  const vatTotal = round2(groups.reduce((s, g) => s + g.vat, 0))
  const surchargeTotal = round2(groups.reduce((s, g) => s + g.surcharge, 0))
  const irpfTotal = pctOf(round2(irpfBase), Number(irpfRate) || 0)

  return {
    subtotal: round2(subtotal),
    discountTotal: round2(discountTotal),
    taxBase,
    vatTotal,
    surchargeTotal,
    irpfBase: round2(irpfBase),
    irpfTotal,
    total: round2(taxBase + vatTotal + surchargeTotal - irpfTotal),
    groups,
  }
}
