/** Deducibilidad de un gasto: del todo, en parte (vehículo, suministros de casa…) o nada (personal) */
export type DeductibleLevel = 'full' | 'partial' | 'none'

/** Sin IVA en la factura, el % de IVA deducible no cuenta */
export function deductibleLevel(pct: number | null | undefined, vatPct: number | null | undefined, hasVat = true): DeductibleLevel {
  const p = Number(pct ?? 100)
  const v = hasVat ? Number(vatPct ?? 100) : p
  if (p >= 100 && v >= 100) return 'full'
  if (p <= 0 && v <= 0) return 'none'
  return 'partial'
}

/** «Deducible», «No deducible», «50 %» o «50 % · IVA 0 %» */
export function deductibleLabel(pct: number | null | undefined, vatPct: number | null | undefined, hasVat = true) {
  const level = deductibleLevel(pct, vatPct, hasVat)
  if (level === 'full') return 'Deducible'
  if (level === 'none') return 'No deducible'
  const p = Number(pct ?? 100)
  const v = Number(vatPct ?? 100)
  const fmt = (n: number) => `${n.toLocaleString('es-ES', { maximumFractionDigits: 2 })} %`
  return !hasVat || p === v ? fmt(p) : `${fmt(p)} · IVA ${fmt(v)}`
}
