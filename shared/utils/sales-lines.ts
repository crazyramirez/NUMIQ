/**
 * Factura «solo descripción»: el trabajo se explica en la descripción y las líneas solo llevan el importe
 * (una por tipo de IVA, sin concepto), como muchas facturas que no detallan conceptos con cantidad y precio.
 * El PDF y las vistas no muestran entonces la tabla de conceptos.
 */
export function isConceptless(lines: ReadonlyArray<{ description?: string | null }>) {
  return lines.length > 0 && lines.every(l => !l.description?.trim())
}
