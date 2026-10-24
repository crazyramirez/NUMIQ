import { Agent, request } from 'node:https'
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm'
import type { PartySnapshot } from '../db/schema'

/**
 * Remisión de registros VeriFactu a la AEAT: XML según SuministroLR.xsd / SuministroInformacion.xsd,
 * SOAP sobre HTTPS con el certificado de la empresa (TLS mutuo). Entorno de pruebas o real.
 */

type Company = typeof tables.companies.$inferSelect
type VfRecord = typeof tables.verifactuRecords.$inferSelect

export interface VerifactuSettings {
  /** Pruebas (prewww1.aeat.es) o producción */
  environment: 'test' | 'production'
  /** Enviar solos los registros pendientes */
  autoSend: boolean
}

export function verifactuSettings(company: Pick<Company, 'settings'>): VerifactuSettings {
  const v = (company.settings as { verifactu?: Partial<VerifactuSettings> } | null)?.verifactu
  return { environment: v?.environment === 'production' ? 'production' : 'test', autoSend: !!v?.autoSend }
}

const NS_LR = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd'
const NS_SF = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd'

export function verifactuEndpoint(environment: VerifactuSettings['environment'], seal = false) {
  const host = environment === 'production' ? (seal ? 'www10.agenciatributaria.gob.es' : 'www1.agenciatributaria.gob.es') : (seal ? 'prewww10.aeat.es' : 'prewww1.aeat.es')
  return `https://${host}/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
const money = (n: number) => n.toFixed(2)
const el = (name: string, value: string | number | null | undefined) => (value == null || value === '' ? '' : `<sf:${name}>${esc(String(value))}</sf:${name}>`)
const clip = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max)

/** Datos del sistema informático (NUMIQ) que exige cada registro */
function sistemaInformatico(company: Company, multipleCompanies: boolean) {
  const c = useRuntimeConfig()
  const name = String(c.verifactuProducerName || company.legalName)
  const nif = normalizeNif(String(c.verifactuProducerNif || company.nif))
  return `<sf:SistemaInformatico>${el('NombreRazon', clip(name, 120))}${el('NIF', nif)}${el('NombreSistemaInformatico', 'NUMIQ')}${el('IdSistemaInformatico', 'NQ')}${el('Version', '1.0')}${el('NumeroInstalacion', `NQ-${company.id}`)}${el('TipoUsoPosibleSoloVerifactu', 'N')}${el('TipoUsoPosibleMultiOT', 'S')}${el('IndicadorMultiplesOT', multipleCompanies ? 'S' : 'N')}</sf:SistemaInformatico>`
}

/** Destinatario: NIF español o identificador extranjero (NIF-IVA, pasaporte…) */
function destinatario(p: PartySnapshot | null) {
  if (!p?.nif) return ''
  const nif = normalizeNif(p.nif)
  const spanish = validateNif(nif).valid
  const id = spanish
    ? el('NIF', nif)
    : `<sf:IDOtro>${el('CodigoPais', (p.country || nif.slice(0, 2)).toUpperCase().slice(0, 2))}${el('IDType', looksLikeEuVat(nif) ? '02' : '06')}${el('ID', nif.slice(0, 20))}</sf:IDOtro>`
  return `<sf:Destinatarios><sf:IDDestinatario>${el('NombreRazon', clip(p.name, 120))}${id}</sf:IDDestinatario></sf:Destinatarios>`
}

interface AltaData {
  record: VfRecord
  previous: VfRecord | null
  doc: typeof tables.salesDocuments.$inferSelect
  lines: Array<typeof tables.salesDocumentLines.$inferSelect>
  rectified: { number: string, issueDate: string } | null
}

/** Un RegistroAlta completo (el mismo contenido con el que se calculó la huella) */
export function registroAltaXml(company: Company, d: AltaData, multipleCompanies: boolean) {
  const r = d.record
  const totals = computeTotals(d.lines.map(l => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, vatRate: l.vatRate, surchargeRate: l.surchargeRate, irpfApplies: l.irpfApplies })), d.doc.irpfRate)
  const groups = totals.groups.length ? totals.groups : [{ vatRate: 0, surchargeRate: 0, base: d.doc.taxBase, vat: d.doc.vatTotal, surcharge: d.doc.surchargeTotal }]
  const desglose = groups.slice(0, 12).map(g => g.vatRate > 0
    ? `<sf:DetalleDesglose>${el('Impuesto', '01')}${el('ClaveRegimen', '01')}${el('CalificacionOperacion', 'S1')}${el('TipoImpositivo', money(g.vatRate))}${el('BaseImponibleOimporteNoSujeto', money(g.base))}${el('CuotaRepercutida', money(g.vat))}${g.surchargeRate ? el('TipoRecargoEquivalencia', money(g.surchargeRate)) + el('CuotaRecargoEquivalencia', money(g.surcharge)) : ''}</sf:DetalleDesglose>`
    // IVA 0 %: operación exenta por el artículo 20 de la Ley del IVA
    : `<sf:DetalleDesglose>${el('Impuesto', '01')}${el('ClaveRegimen', '01')}${el('OperacionExenta', 'E1')}${el('BaseImponibleOimporteNoSujeto', money(g.base))}</sf:DetalleDesglose>`,
  ).join('')
  const description = clip(d.lines.map(l => l.description.split('\n')[0]).join('; ') || 'Prestación de servicios', 500)
  const rectification = r.invoiceType.startsWith('R')
    ? `${el('TipoRectificativa', 'I')}${d.rectified ? `<sf:FacturasRectificadas><sf:IDFacturaRectificada>${el('IDEmisorFactura', r.issuerNif)}${el('NumSerieFactura', d.rectified.number)}${el('FechaExpedicionFactura', aeatDate(d.rectified.issueDate))}</sf:IDFacturaRectificada></sf:FacturasRectificadas>` : ''}`
    : ''
  const chain = d.previous
    ? `<sf:RegistroAnterior>${el('IDEmisorFactura', d.previous.issuerNif)}${el('NumSerieFactura', d.previous.invoiceNumber)}${el('FechaExpedicionFactura', aeatDate(d.previous.invoiceDate))}${el('Huella', d.previous.hash)}</sf:RegistroAnterior>`
    : el('PrimerRegistro', 'S')
  const operation = d.doc.operationDate && d.doc.operationDate !== d.doc.issueDate ? el('FechaOperacion', aeatDate(d.doc.operationDate)) : ''
  return `<sf:RegistroAlta>${el('IDVersion', '1.0')}<sf:IDFactura>${el('IDEmisorFactura', r.issuerNif)}${el('NumSerieFactura', r.invoiceNumber)}${el('FechaExpedicionFactura', aeatDate(r.invoiceDate))}</sf:IDFactura>${el('NombreRazonEmisor', clip(company.legalName, 120))}${el('TipoFactura', r.invoiceType)}${rectification}${operation}${el('DescripcionOperacion', description)}${destinatario(d.doc.customer)}<sf:Desglose>${desglose}</sf:Desglose>${el('CuotaTotal', money(r.vatTotal))}${el('ImporteTotal', money(r.total))}<sf:Encadenamiento>${chain}</sf:Encadenamiento>${sistemaInformatico(company, multipleCompanies)}${el('FechaHoraHusoGenRegistro', r.generatedAt)}${el('TipoHuella', '01')}${el('Huella', r.hash)}</sf:RegistroAlta>`
}

export function soapEnvelope(company: Company, registros: string[]) {
  return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sfLR="${NS_LR}" xmlns:sf="${NS_SF}"><soapenv:Header/><soapenv:Body><sfLR:RegFactuSistemaFacturacion><sfLR:Cabecera><sf:ObligadoEmision>${el('NombreRazon', clip(company.legalName, 120))}${el('NIF', normalizeNif(company.nif))}</sf:ObligadoEmision></sfLR:Cabecera>${registros.map(r => `<sfLR:RegistroFactura>${r}</sfLR:RegistroFactura>`).join('')}</sfLR:RegFactuSistemaFacturacion></soapenv:Body></soapenv:Envelope>`
}

/** Valor del primer elemento con ese nombre local (la respuesta de la AEAT es pequeña y regular) */
function tag(xml: string, name: string) {
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`))
  return m ? m[1]!.replace(/<[^>]+>/g, '').trim() : null
}

function blocks(xml: string, name: string) {
  return [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'g'))].map(m => m[1]!)
}

export interface AeatLine {
  number: string
  status: 'Correcto' | 'AceptadoConErrores' | 'Incorrecto'
  code: string | null
  message: string | null
}

export interface AeatResult {
  status: 'Correcto' | 'ParcialmenteCorrecto' | 'Incorrecto'
  csv: string | null
  wait: number
  lines: AeatLine[]
}

export function parseAeatResponse(xml: string): AeatResult {
  const fault = tag(xml, 'faultstring')
  if (fault) throw createError({ statusCode: 502, statusMessage: `La AEAT rechazó el envío: ${fault}` })
  const status = tag(xml, 'EstadoEnvio') as AeatResult['status'] | null
  if (!status) throw createError({ statusCode: 502, statusMessage: 'Respuesta de la AEAT no reconocida' })
  return {
    status,
    csv: tag(xml, 'CSV'),
    wait: Number(tag(xml, 'TiempoEsperaEnvio')) || 60,
    lines: blocks(xml, 'RespuestaLinea').map(b => ({
      number: tag(b, 'NumSerieFactura') ?? '',
      status: (tag(b, 'EstadoRegistro') ?? 'Incorrecto') as AeatLine['status'],
      code: tag(b, 'CodigoErrorRegistro'),
      message: tag(b, 'DescripcionErrorRegistro'),
    })),
  }
}

/** POST SOAP con TLS mutuo (certificado de la empresa) */
function postSoap(url: string, body: string, tls: { key: string, cert: string }) {
  return new Promise<{ status: number, body: string, location: string | null }>((resolve, reject) => {
    const agent = new Agent({ key: tls.key, cert: tls.cert, keepAlive: false })
    const req = request(url, { method: 'POST', agent, headers: { 'content-type': 'text/xml; charset=utf-8', 'soapaction': '""', 'content-length': Buffer.byteLength(body) }, timeout: 60_000 }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), location: res.headers.location ?? null }))
    })
    req.on('timeout', () => req.destroy(new Error('La AEAT no respondió a tiempo')))
    req.on('error', reject)
    req.end(body)
  })
}

/** Espera mínima entre envíos que pide la AEAT (control de flujo), por empresa */
const nextAllowed = new Map<number, number>()

export interface SendSummary {
  sent: number
  accepted: number
  withErrors: number
  rejected: number
  csv: string | null
  waitSeconds: number
  message: string
}

/** Envía los registros pendientes de la empresa, en orden de la cadena (máximo 1.000 por envío) */
export async function sendPendingRecords(company: Company): Promise<SendSummary> {
  const settings = verifactuSettings(company)
  const db = useDb()
  const v = tables.verifactuRecords
  const wait = (nextAllowed.get(company.id) ?? 0) - Date.now()
  if (wait > 0) throw createError({ statusCode: 429, statusMessage: `La AEAT pide esperar ${Math.ceil(wait / 1000)} s entre envíos` })
  const pending = await db.select().from(v).where(and(eq(v.companyId, company.id), inArray(v.status, ['pending']))).orderBy(asc(v.id)).limit(1000)
  if (!pending.length) return { sent: 0, accepted: 0, withErrors: 0, rejected: 0, csv: null, waitSeconds: 0, message: 'No hay registros pendientes de enviar' }

  const tls = await certificateTls(company.id)
  const docs = await db.select().from(tables.salesDocuments).where(inArray(tables.salesDocuments.id, pending.map(p => p.salesDocumentId)))
  const lines = await db.select().from(tables.salesDocumentLines).where(inArray(tables.salesDocumentLines.documentId, pending.map(p => p.salesDocumentId)))
  const prevIds = pending.map(p => p.previousId).filter((x): x is number => !!x)
  const prevs = prevIds.length ? await db.select().from(v).where(inArray(v.id, prevIds)) : []
  const rectIds = docs.map(d => d.rectifiesId).filter((x): x is number => !!x)
  const rects = rectIds.length ? await db.select({ id: tables.salesDocuments.id, number: tables.salesDocuments.number, issueDate: tables.salesDocuments.issueDate }).from(tables.salesDocuments).where(inArray(tables.salesDocuments.id, rectIds)) : []
  const [companies] = await db.select({ n: sql<number>`count(*)` }).from(tables.companies)
  const multiple = Number(companies?.n ?? 1) > 1

  const xmls = pending.map((record) => {
    const doc = docs.find(d => d.id === record.salesDocumentId)!
    const rect = doc.rectifiesId ? rects.find(r => r.id === doc.rectifiesId) : undefined
    return registroAltaXml(company, {
      record,
      previous: prevs.find(p => p.id === record.previousId) ?? null,
      doc,
      lines: lines.filter(l => l.documentId === doc.id).sort((a, b) => a.position - b.position),
      rectified: rect?.number ? { number: rect.number, issueDate: rect.issueDate } : null,
    }, multiple)
  })
  const envelope = soapEnvelope(company, xmls)
  const url = verifactuEndpoint(settings.environment, tls.info.kind === 'sello')
  let res: { status: number, body: string, location: string | null }
  try {
    res = await postSoap(url, envelope, tls)
  }
  catch (err) {
    throw createError({ statusCode: 502, statusMessage: `No se pudo conectar con la AEAT: ${(err as Error).message}` })
  }
  // La AEAT redirige a su página de error cuando no reconoce el certificado (erro4011, erro4031…)
  if (res.status === 403 || res.status === 401 || (res.status >= 300 && res.status < 400 && /errores|erro4/.test(res.location ?? ''))) {
    throw createError({ statusCode: 502, statusMessage: 'La AEAT no reconoce el certificado: debe estar emitido por un prestador reconocido (FNMT, Camerfirma…) y ser del titular o de su representante' })
  }
  if (!/xml/i.test(res.body.slice(0, 200)) && !/Envelope/.test(res.body)) throw createError({ statusCode: 502, statusMessage: `La AEAT respondió de forma inesperada (HTTP ${res.status}): inténtalo más tarde` })
  const result = parseAeatResponse(res.body)
  nextAllowed.set(company.id, Date.now() + result.wait * 1000)

  const summary: SendSummary = { sent: pending.length, accepted: 0, withErrors: 0, rejected: 0, csv: result.csv, waitSeconds: result.wait, message: '' }
  for (const [i, record] of pending.entries()) {
    const line = result.lines.find(l => l.number === record.invoiceNumber) ?? (result.status === 'Correcto' ? { number: record.invoiceNumber, status: 'Correcto' as const, code: null, message: null } : null)
    const status = !line ? 'rejected' as const : line.status === 'Correcto' ? 'accepted' as const : line.status === 'AceptadoConErrores' ? 'accepted_with_errors' as const : 'rejected' as const
    if (status === 'accepted') summary.accepted++
    else if (status === 'accepted_with_errors') summary.withErrors++
    else summary.rejected++
    await db.update(v).set({
      status,
      xml: xmls[i]!,
      aeatCsv: result.csv,
      aeatResponse: { envio: result.status, ...(line ? { estado: line.status, codigo: line.code, descripcion: line.message } : {}) },
      error: line?.message ?? (status === 'rejected' ? 'Rechazado por la AEAT' : null),
      sentAt: new Date(),
    }).where(eq(v.id, record.id))
  }
  summary.message = summary.rejected
    ? `${summary.rejected} registro${summary.rejected > 1 ? 's' : ''} rechazado${summary.rejected > 1 ? 's' : ''}: revisa el detalle`
    : `${summary.accepted + summary.withErrors} registro${summary.sent > 1 ? 's' : ''} aceptado${summary.sent > 1 ? 's' : ''} por la AEAT`
  return summary
}

/** XML de un registro (el enviado o, si aún no se envió, el que se enviaría) */
export async function recordXml(company: Company, id: number) {
  const db = useDb()
  const v = tables.verifactuRecords
  const [record] = await db.select().from(v).where(and(eq(v.id, id), eq(v.companyId, company.id)))
  if (!record) throw createError({ statusCode: 404, statusMessage: 'Registro no encontrado' })
  if (record.xml) return soapEnvelope(company, [record.xml])
  const [doc] = await db.select().from(tables.salesDocuments).where(eq(tables.salesDocuments.id, record.salesDocumentId))
  const lines = await db.select().from(tables.salesDocumentLines).where(eq(tables.salesDocumentLines.documentId, record.salesDocumentId))
  const [previous] = record.previousId ? await db.select().from(v).where(eq(v.id, record.previousId)) : []
  const [rect] = doc?.rectifiesId ? await db.select({ number: tables.salesDocuments.number, issueDate: tables.salesDocuments.issueDate }).from(tables.salesDocuments).where(eq(tables.salesDocuments.id, doc.rectifiesId)) : []
  const [companies] = await db.select({ n: sql<number>`count(*)` }).from(tables.companies)
  return soapEnvelope(company, [registroAltaXml(company, { record, previous: previous ?? null, doc: doc!, lines: lines.sort((a, b) => a.position - b.position), rectified: rect?.number ? { number: rect.number, issueDate: rect.issueDate } : null }, Number(companies?.n ?? 1) > 1)])
}

/** Registros que quedaron "enviando" en un corte: vuelven a pendientes */
export async function resetStuckRecords(companyId: number) {
  const v = tables.verifactuRecords
  await useDb().update(v).set({ status: 'pending' }).where(and(eq(v.companyId, companyId), eq(v.status, 'sent'), lt(v.sentAt, new Date(Date.now() - 10 * 60_000))))
}
