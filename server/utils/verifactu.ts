import { createHash } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import type { Db } from './db'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * VeriFactu (RD 1007/2023 y Orden HAC/1177/2024): cada factura emitida genera un registro de
 * facturación con una huella SHA-256 encadenada a la del registro anterior del mismo emisor.
 * Aquí se generan y encadenan los registros; el envío a la AEAT (con certificado) va aparte.
 */

/** dd-mm-aaaa, como se escribe en el XML y en la huella */
export function aeatDate(isoDate: string) {
  const [y, m, d] = isoDate.split('-')
  return `${d}-${m}-${y}`
}

/** FechaHoraHusoGenRegistro: ISO 8601 con la zona horaria de España (Europe/Madrid) */
export function aeatTimestamp(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'longOffset',
  }).formatToParts(date).map(p => [p.type, p.value]))
  const offset = String(parts.timeZoneName).replace('GMT', '') || '+00:00'
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`
}

const amount = (n: number) => n.toFixed(2)

export interface AltaHashInput {
  issuerNif: string
  invoiceNumber: string
  invoiceDate: string
  invoiceType: string
  vatTotal: number
  total: number
  previousHash: string | null
  generatedAt: string
}

/** Huella de un registro de alta (especificación de la AEAT: campos concatenados, SHA-256, hex en mayúsculas) */
export function altaHash(r: AltaHashInput) {
  const chain = [
    `IDEmisorFactura=${r.issuerNif.trim()}`,
    `NumSerieFactura=${r.invoiceNumber.trim()}`,
    `FechaExpedicionFactura=${aeatDate(r.invoiceDate)}`,
    `TipoFactura=${r.invoiceType}`,
    `CuotaTotal=${amount(r.vatTotal)}`,
    `ImporteTotal=${amount(r.total)}`,
    `Huella=${r.previousHash ?? ''}`,
    `FechaHoraHusoGenRegistro=${r.generatedAt}`,
  ].join('&')
  return createHash('sha256').update(chain, 'utf8').digest('hex').toUpperCase()
}

/** ImporteTotal de VeriFactu: base imponible + IVA + recargo (sin restar retenciones) */
export function verifactuTotal(d: { taxBase: number, vatTotal: number, surchargeTotal: number }) {
  return round2(d.taxBase + d.vatTotal + d.surchargeTotal)
}

/** URL del QR que debe llevar impresa la factura para que el receptor la coteje en la sede de la AEAT */
export function verifactuQrUrl(r: { issuerNif: string, invoiceNumber: string, invoiceDate: string, total: number }, production = false) {
  const base = production
    ? 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR'
    : 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR'
  const q = new URLSearchParams({ nif: r.issuerNif, numserie: r.invoiceNumber, fecha: aeatDate(r.invoiceDate), importe: amount(r.total) })
  return `${base}?${q}`
}

/** Crea el registro de alta de una factura recién emitida, encadenado al último de la empresa */
export async function createAltaRecord(tx: Tx, doc: {
  id: number
  companyId: number
  kind: string
  number: string
  issueDate: string
  taxBase: number
  vatTotal: number
  surchargeTotal: number
  rectificationCode?: string | null
}, issuerNif: string) {
  const [prev] = await tx.select({ id: tables.verifactuRecords.id, hash: tables.verifactuRecords.hash })
    .from(tables.verifactuRecords)
    .where(eq(tables.verifactuRecords.companyId, doc.companyId))
    .orderBy(desc(tables.verifactuRecords.id))
    .limit(1)
    .for('update')
  const invoiceType = doc.kind === 'rectifying' ? (doc.rectificationCode || 'R1') : 'F1'
  const generatedAt = aeatTimestamp()
  // CuotaTotal incluye el recargo de equivalencia. ImporteTotal es base + cuotas: la retención de
  // IRPF no cuenta (VeriFactu solo recoge lo relativo al IVA) aunque reduzca lo que se cobra
  const vatTotal = round2(doc.vatTotal + doc.surchargeTotal)
  const total = verifactuTotal(doc)
  const hash = altaHash({ issuerNif, invoiceNumber: doc.number, invoiceDate: doc.issueDate, invoiceType, vatTotal, total, previousHash: prev?.hash ?? null, generatedAt })
  await tx.insert(tables.verifactuRecords).values({
    companyId: doc.companyId,
    salesDocumentId: doc.id,
    type: 'alta',
    issuerNif,
    invoiceNumber: doc.number,
    invoiceDate: doc.issueDate,
    invoiceType,
    vatTotal,
    total,
    hash,
    previousHash: prev?.hash ?? null,
    previousId: prev?.id ?? null,
    generatedAt,
  })
  return hash
}
