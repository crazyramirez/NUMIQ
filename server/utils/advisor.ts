import { randomBytes } from 'node:crypto'
import { and, eq, gte, inArray, isNotNull, lte, notInArray, or } from 'drizzle-orm'
import { zipSync } from 'fflate'
import { z } from 'zod'
import type { AdvisorPackContents } from '../db/schema'

/**
 * Envío al gestor: las facturas emitidas, las recibidas con su original, la documentación del
 * archivo y un resumen (Excel + PDF) de un mes, trimestre, año o rango, en un ZIP con enlace seguro.
 */

type Company = typeof tables.companies.$inferSelect

const emailList = z.string().trim().max(500).nullish()
  .transform(s => (s ? s.split(/[,;\s]+/).filter(Boolean) : []))
  .pipe(z.array(z.email('Hay un email en copia no válido')).max(5, 'Máximo 5 emails en copia'))

export const advisorSchema = z.object({
  name: z.string().trim().max(120).nullish().transform(v => v || null),
  firm: z.string().trim().max(160).nullish().transform(v => v || null),
  email: optionalEmailField(),
  cc: emailList,
  phone: z.string().trim().max(40).nullish().transform(v => v || null),
  /** Mensaje habitual del correo (opcional) */
  message: z.string().trim().max(2000).nullish().transform(v => v || null),
})

export type AdvisorSettings = z.infer<typeof advisorSchema>

export function advisorOf(company: Pick<Company, 'settings'>): AdvisorSettings | null {
  const a = (company.settings as { advisor?: AdvisorSettings } | null)?.advisor
  return a?.email || a?.name ? a : null
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const packPeriodSchema = z.object({
  year: z.coerce.number().int().min(1990).max(2100).optional(),
  quarter: z.coerce.number().int().min(1).max(4).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
}).refine(p => (p.from && p.to ? p.from <= p.to : !!p.year), 'Elige un periodo')

/** Mes, trimestre, año o rango libre → periodo con etiqueta */
export function packPeriod(p: z.infer<typeof packPeriodSchema>): ReportPeriod {
  if (p.from && p.to) {
    const label = `${fmtDay(p.from)} – ${fmtDay(p.to)}`
    return { year: Number(p.from.slice(0, 4)), quarter: null, month: null, granularity: 'year', from: p.from, to: p.to, label, slug: `${p.from}_${p.to}` }
  }
  return resolveReportPeriod(p.year!, p.quarter ?? null, p.month ?? null)
}

function fmtDay(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '')
}

/** Documentos del archivo trimestral que caen en el periodo */
async function vaultFilesIn(companyId: number, from: string, to: string) {
  const quarters = quartersInRange(from, to)
  const f = tables.files
  if (!quarters.length) return []
  return useDb().select({ id: f.id, name: f.originalName, folder: f.folder, size: f.size, mime: f.mime, year: f.year, quarter: f.quarter, notes: f.notes })
    .from(f)
    .where(and(eq(f.companyId, companyId), eq(f.kind, 'vault'), or(...quarters.map(q => and(eq(f.year, q.year), eq(f.quarter, q.quarter))))))
    .orderBy(f.folder, f.originalName)
}

async function receivedOriginals(companyId: number, from: string, to: string) {
  const e = tables.expenses
  const f = tables.files
  return useDb().select({ id: e.id, number: e.number, date: e.issueDate, supplier: e.supplier, fileId: f.id, fileName: f.originalName, size: f.size, path: f.path })
    .from(e).innerJoin(f, eq(f.id, e.fileId))
    .where(and(eq(e.companyId, companyId), gte(e.issueDate, from), lte(e.issueDate, to), isNotNull(e.fileId)))
    .orderBy(e.issueDate)
}

export async function packPreview(company: Company, period: ReportPeriod) {
  const [issued, received, originals, vault] = await Promise.all([
    issuedBook(company.id, period.from, period.to),
    receivedBook(company.id, period.from, period.to),
    receivedOriginals(company.id, period.from, period.to),
    vaultFilesIn(company.id, period.from, period.to),
  ])
  const sum = (list: Array<{ total: number }>) => round2(list.reduce((s, x) => s + x.total, 0))
  const sumBase = (list: Array<{ base: number }>) => round2(list.reduce((s, x) => s + x.base, 0))
  return {
    period: { from: period.from, to: period.to, label: period.label, slug: period.slug },
    issued: { count: issued.length, base: sumBase(issued), total: sum(issued) },
    received: { count: received.length, base: sumBase(received), total: sum(received), withFile: originals.length, bytes: originals.reduce((s, o) => s + o.size, 0) },
    vault,
    // PDF de emitidas ~30 KB; el resto, su tamaño real
    estimate: issued.length * 30_000 + originals.reduce((s, o) => s + o.size, 0) + vault.reduce((s, v) => s + v.size, 0) + 60_000,
  }
}

const safePart = (s: string) => s.replace(/[\\/:*?"<>|\x00-\x1F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'documento'
const STORED = /\.(pdf|jpe?g|png|webp|zip|docx|xlsx|odt|ods)$/i

export interface PackOptions {
  issued: boolean
  received: boolean
  summary: boolean
  vaultIds: number[]
}

/** Construye el ZIP del periodo y lo guarda con un enlace de descarga que caduca a los 30 días */
export async function buildPack(company: Company, userId: number, period: ReportPeriod, opts: PackOptions) {
  const db = useDb()
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  const add = (path: string, data: Buffer | Uint8Array) => {
    let p = path
    for (let i = 2; entries[p]; i++) p = path.replace(/(\.[^./]+)?$/, ` (${i})$1`)
    entries[p] = [data instanceof Uint8Array ? data : new Uint8Array(data), { level: STORED.test(p) ? 0 : 6 }]
  }
  const [issued, received] = await Promise.all([
    issuedBook(company.id, period.from, period.to),
    receivedBook(company.id, period.from, period.to),
  ])

  if (opts.issued && issued.length) {
    const docs = await db.select({ id: tables.salesDocuments.id, number: tables.salesDocuments.number, kind: tables.salesDocuments.kind })
      .from(tables.salesDocuments).where(and(eq(tables.salesDocuments.companyId, company.id), inArray(tables.salesDocuments.id, issued.map(i => i.id))))
    for (const d of docs) {
      const name = `Facturas emitidas/${safePart(d.number ?? `sin-numero-${d.id}`)}`
      // Las facturas emitidas siempre se generan en PDF con la plantilla y diseño de NUMIQ (no los archivos importados/escaneados)
      add(`${name}.pdf`, (await salesPdf(company, d.id)).buffer)
    }
  }

  let receivedFiles = 0
  if (opts.received) {
    for (const o of await receivedOriginals(company.id, period.from, period.to)) {
      const ext = o.fileName.match(/\.[a-z0-9]{1,6}$/i)?.[0] ?? ''
      const data = await readStoredFile(o.path).catch(() => null)
      if (!data) continue
      add(`Facturas recibidas/${o.date} ${safePart(o.supplier?.name ?? 'Proveedor')}${o.number ? ` ${safePart(o.number)}` : ''}${ext}`, data)
      receivedFiles++
    }
  }

  let vaultCount = 0
  if (opts.vaultIds.length) {
    const vault = await db.select().from(tables.files)
      .where(and(eq(tables.files.companyId, company.id), eq(tables.files.kind, 'vault'), inArray(tables.files.id, opts.vaultIds)))
    for (const v of vault) {
      const data = await readStoredFile(v.path).catch(() => null)
      if (!data) continue
      const folder = (v.folder ?? 'otros').replace(/^./, ch => ch.toUpperCase())
      add(`Documentación/${safePart(folder)}/${v.quarter}T ${v.year} - ${safePart(v.originalName)}`, data)
      vaultCount++
    }
  }

  if (opts.summary) {
    const report = await buildReport(company, period)
    add(`Resumen ${period.label}.xlsx`, reportWorkbook(report, issued, received))
    add(`Resumen ${period.label}.pdf`, await reportPdf(company, report, issued, received))
  }

  const totals = { income: round2(issued.reduce((s, i) => s + i.base, 0)), expenses: round2(received.reduce((s, r) => s + r.base, 0)) }
  const brand = company.tradeName || company.legalName
  const readme = [
    `${brand} · NIF ${company.nif}`,
    `Documentación del periodo ${period.label} (${period.from} a ${period.to})`,
    `Preparado con NUMIQ el ${new Date().toLocaleString('es-ES')}`,
    '',
    opts.issued ? `Facturas emitidas (generadas en la app): ${issued.length} · base imponible ${eurText(totals.income)}` : '',
    opts.received ? `Facturas recibidas y gastos: ${received.length} (${receivedFiles} con documento original) · base ${eurText(totals.expenses)}` : '',
    vaultCount ? `Documentación adicional: ${vaultCount} documentos` : '',
    opts.summary ? 'Resumen: libros registro de emitidas y recibidas, IVA y retenciones (Excel y PDF)' : '',
  ].filter(Boolean).join('\r\n')
  add('Léeme.txt', Buffer.from(`﻿${readme}\r\n`, 'utf8'))

  const zip = Buffer.from(zipSync(entries))
  const path = await saveCompanyFile(company.id, 'packs', zip, 'zip')
  const contents: AdvisorPackContents = { issued: opts.issued ? issued.length : 0, received: opts.received ? received.length : 0, receivedFiles, vault: vaultCount, summary: opts.summary, files: Object.keys(entries).length, totals }
  const [res] = await db.insert(tables.advisorPacks).values({
    companyId: company.id,
    label: period.label,
    periodFrom: period.from,
    periodTo: period.to,
    contents,
    path,
    size: zip.length,
    token: randomBytes(24).toString('base64url'),
    expiresAt: new Date(Date.now() + 30 * 86_400_000),
    createdBy: userId,
  }).$returningId()
  const [pack] = await db.select().from(tables.advisorPacks).where(eq(tables.advisorPacks.id, res!.id))
  return pack!
}

export function packFilename(company: Pick<Company, 'tradeName' | 'legalName'>, label: string) {
  return `${safePart(company.tradeName || company.legalName)} - ${safePart(label)}.zip`
}

/** Hasta este tamaño el ZIP va adjunto (Gmail admite 25 MB contando la codificación) */
const MAX_ATTACH = 18 * 1024 * 1024

export async function sendPack(company: Company, user: { id: number, email: string }, pack: typeof tables.advisorPacks.$inferSelect, input: { to: string[], cc: string[], subject: string, message: string, site: string }) {
  const brand = company.tradeName || company.legalName
  const design = await getCompanyDesign(company)
  const c = pack.contents
  const link = `${input.site}/api/public/pack/${pack.token}`
  const attach = pack.size <= MAX_ATTACH
  const details: Array<[string, string]> = [
    ['Periodo', pack.label],
    ...(c?.issued ? [['Facturas emitidas', `${c.issued} · ${eurText(c.totals.income)}`] as [string, string]] : []),
    ...(c?.received ? [['Facturas recibidas', `${c.received} · ${eurText(c.totals.expenses)}`] as [string, string]] : []),
    ...(c?.vault ? [['Documentación', `${c.vault} documento${c.vault > 1 ? 's' : ''}`] as [string, string]] : []),
    ['Tamaño', `${(pack.size / 1024 / 1024).toLocaleString('es-ES', { maximumFractionDigits: 1 })} MB`],
  ]
  const { text, html } = mailLayout({
    brand,
    accent: design.accentColor,
    title: input.subject,
    lines: [...input.message.split(/\n{2,}/), attach ? 'Va adjunto en un ZIP y también puedes descargarlo con el botón (enlace válido 30 días).' : 'Por su tamaño, descárgalo con el botón (enlace válido 30 días).'],
    details,
    action: { label: 'Descargar documentación', url: link },
    footer: [company.legalName, `NIF ${company.nif}`, company.email].filter(Boolean).join(' · '),
  })
  const db = useDb()
  try {
    await sendMail({
      to: input.to.join(', '),
      cc: input.cc.length ? input.cc.join(', ') : undefined,
      subject: input.subject,
      text,
      html,
      fromName: brand,
      replyTo: company.email || user.email,
      attachments: attach ? [{ filename: packFilename(company, pack.label), content: await readStoredFile(pack.path), contentType: 'application/zip' }] : undefined,
    })
    await db.update(tables.advisorPacks).set({ sentTo: [...input.to, ...input.cc].join(', ').slice(0, 500), sentAt: new Date(), emailStatus: 'sent', emailError: null }).where(eq(tables.advisorPacks.id, pack.id))
    return { attached: attach }
  }
  catch (err) {
    const message = (err as { statusMessage?: string, message?: string }).statusMessage ?? (err as Error).message
    await db.update(tables.advisorPacks).set({ emailStatus: 'failed', emailError: message.slice(0, 500) }).where(eq(tables.advisorPacks.id, pack.id))
    throw createError({ statusCode: 502, statusMessage: `No se pudo enviar: ${message}` })
  }
}

/** ZIP de envíos caducados hace más de 60 días: se borran para no llenar el disco */
export async function purgeOldPacks(companyId: number) {
  const db = useDb()
  const old = await db.select({ id: tables.advisorPacks.id, path: tables.advisorPacks.path }).from(tables.advisorPacks)
    .where(and(eq(tables.advisorPacks.companyId, companyId), lte(tables.advisorPacks.expiresAt, new Date(Date.now() - 60 * 86_400_000)), notInArray(tables.advisorPacks.path, [''])))
  for (const p of old) {
    await deleteStoredFile(p.path)
    await db.update(tables.advisorPacks).set({ path: '' }).where(eq(tables.advisorPacks.id, p.id))
  }
}
