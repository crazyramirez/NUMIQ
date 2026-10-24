import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, notInArray, or, sql } from 'drizzle-orm'
import type { Column } from 'drizzle-orm'
import type { ExtractedDocType, ExtractedDocument, ImportCatalogData, ScanReading, ImportContactData, ImportDirection, ImportDocRef, ImportDuplicate, ImportInvoiceData, ImportItemStatus, ImportItemType, ImportLink, ImportParty, ImportUndoSummary, ImportVaultData } from '../../shared/types/import'
import type { ImportOptions } from '../db/schema'
import { ImportDuplicateIndex, findImportContact, findSimilarContact } from '../../shared/utils/duplicate-matching'
import type { DuplicateParty, DuplicateRecord } from '../../shared/utils/duplicate-matching'
import { resolveDocumentDate, sourceDateWarning } from '../../shared/utils/source-date'
import type { SourceFileDate } from '../../shared/utils/source-date'
import { resolveFileDate } from './file-date'
import { folderSignals } from './doc-read'
import { currencyWarning, folderMismatch, typeFromFolder } from './extract'
import { conversionNote, ecbRate, isTrustedSupplier, scaleTaxLines, supplierByNumber } from './expense-review'
import { reviewKind, reviewNotesOf } from '../../shared/utils/review'

/**
 * Importación por lotes: archivos sueltos, ZIP con carpetas, Excel/CSV y escaneos. Cada archivo se lee
 * con IA en segundo plano; lo encontrado queda en import_items para revisarlo antes de crear nada.
 */

type Company = typeof tables.companies.$inferSelect
type ItemRow = typeof tables.importItems.$inferSelect
type FileRow = typeof tables.files.$inferSelect

export const MAX_IMPORT_FILE_BYTES = 40 * 1024 * 1024
export const MAX_IMPORT_ZIP_BYTES = 300 * 1024 * 1024

export async function createBatch(companyId: number, userId: number, input: { source: 'upload' | 'scan' | 'email', name?: string | null, direction: ImportDirection | 'auto', options?: Partial<ImportOptions> }) {
  const [res] = await useDb().insert(tables.importBatches).values({
    companyId,
    source: input.source,
    name: input.name?.slice(0, 200) || null,
    direction: input.direction,
    status: 'uploading',
    options: { createItems: input.options?.createItems ?? true, markPaid: input.options?.markPaid ?? true },
    createdBy: userId,
  }).$returningId()
  return res!.id
}

export async function getBatch(companyId: number, id: number) {
  const [batch] = await useDb().select().from(tables.importBatches)
    .where(and(eq(tables.importBatches.id, id), eq(tables.importBatches.companyId, companyId)))
  if (!batch) throw createError({ statusCode: 404, statusMessage: 'Importación no encontrada' })
  return batch
}

export interface AddedFiles {
  added: number
  skipped: Array<{ name: string, reason: string }>
}

/** Guarda un archivo del lote; los ZIP se abren y cada archivo conserva su carpeta */
export async function addBatchFile(companyId: number, userId: number, batchId: number, file: { filename: string, data: Buffer, sourcePath?: string | null, lastModified?: unknown, sourceDate?: SourceFileDate }): Promise<AddedFiles> {
  const name = safeFilename(file.filename.split(/[\\/]/).pop() || 'archivo')
  const sourcePath = (file.sourcePath || file.filename).replace(/\\/g, '/').replace(/^\/+/, '').slice(0, 500)
  const kind = importKind(file.data, name)
  const result: AddedFiles = { added: 0, skipped: [] }
  if (!kind) {
    result.skipped.push({ name: sourcePath, reason: 'Formato no admitido' })
    return result
  }
  if (kind.family === 'zip') {
    if (file.data.length > MAX_IMPORT_ZIP_BYTES) throw createError({ statusCode: 413, statusMessage: `${name} supera 300 MB` })
    const base = sourcePath.replace(/\.zip$/i, '')
    for (const entry of expandZip(file.data)) {
      const r = await addBatchFile(companyId, userId, batchId, { filename: entry.path.split('/').pop()!, data: entry.data, sourcePath: `${base}/${entry.path}`, sourceDate: entry.sourceDate })
      result.added += r.added
      result.skipped.push(...r.skipped)
    }
    return result
  }
  if (file.data.length > MAX_IMPORT_FILE_BYTES) {
    result.skipped.push({ name: sourcePath, reason: 'Supera 40 MB' })
    return result
  }
  const sha256 = createHash('sha256').update(file.data).digest('hex')
  // El mismo archivo dos veces en la importación (arrastrado otra vez o en dos carpetas del ZIP): se lee una
  const [twin] = await useDb().select({ id: tables.files.id }).from(tables.files)
    .where(and(eq(tables.files.companyId, companyId), eq(tables.files.batchId, batchId), eq(tables.files.sha256, sha256))).limit(1)
  if (twin) {
    result.skipped.push({ name: sourcePath, reason: 'Repetido: ya está en esta importación' })
    return result
  }
  const path = await saveCompanyFile(companyId, `imports/${batchId}`, file.data, kind.ext)
  const sourceDate = await resolveFileDate(file.data, kind.ext, { lastModified: file.lastModified, archiveDate: file.sourceDate })
  await useDb().insert(tables.files).values({
    companyId,
    kind: 'import',
    originalName: name,
    sourcePath,
    sourceDate,
    mime: kind.mime,
    size: file.data.length,
    path,
    sha256,
    batchId,
    aiStatus: 'pending',
    uploadedBy: userId,
  })
  await useDb().update(tables.importBatches).set({ totalFiles: sql`${tables.importBatches.totalFiles} + 1` }).where(eq(tables.importBatches.id, batchId))
  result.added = 1
  return result
}

// ─── Procesado en segundo plano ──────────────────────────────────────────────

const running = new Map<number, Promise<void>>()

/** Lanza (o continúa) la lectura del lote. Devuelve la promesa por si se quiere esperar (escaneo rápido). */
export function startBatch(companyId: number, batchId: number) {
  const current = running.get(batchId)
  if (current) return current
  const p = processBatch(companyId, batchId)
    .catch(async (err) => {
      console.error('[import] lote', batchId, err)
      await useDb().update(tables.importBatches).set({ status: 'failed' }).where(eq(tables.importBatches.id, batchId))
    })
    .finally(() => running.delete(batchId))
  running.set(batchId, p)
  return p
}

export const isBatchRunning = (batchId: number) => running.has(batchId)

/** Lo que se sabe de la empresa para emparejar contactos y detectar duplicados */
interface Knowledge {
  ctx: Omit<ExtractContext, 'path'>
  contacts: Array<DuplicateParty & { id: number, name: string }>
  duplicates: ImportDuplicateIndex<ImportDuplicate>
  itemsByName: Map<string, { id: number, label: string }>
  /** Claves ya vistas en este lote: la segunda aparición es un duplicado */
  seen: Map<string, string>
}

async function loadKnowledge(company: Company, direction: ImportDirection | 'auto', batchId: number | null): Promise<Knowledge> {
  const db = useDb()
  const [categories, contacts, sales, expenses, items, existing, accounts] = await Promise.all([
    db.select({ id: tables.categories.id, name: tables.categories.name }).from(tables.categories)
      .where(and(eq(tables.categories.companyId, company.id), eq(tables.categories.kind, 'expense'))),
    db.select().from(tables.contacts)
      .where(eq(tables.contacts.companyId, company.id)),
    db.select({ id: tables.salesDocuments.id, number: tables.salesDocuments.number, kind: tables.salesDocuments.kind, customer: tables.salesDocuments.customer, issueDate: tables.salesDocuments.issueDate, total: tables.salesDocuments.total }).from(tables.salesDocuments)
      .where(eq(tables.salesDocuments.companyId, company.id)),
    db.select({ id: tables.expenses.id, number: tables.expenses.number, issueDate: tables.expenses.issueDate, total: tables.expenses.total, supplier: tables.expenses.supplier, description: tables.expenses.description, notes: tables.expenses.notes, fileId: tables.expenses.fileId }).from(tables.expenses)
      .where(eq(tables.expenses.companyId, company.id)),
    db.select({ id: tables.items.id, name: tables.items.name, sku: tables.items.sku }).from(tables.items)
      .where(eq(tables.items.companyId, company.id)),
    batchId
      ? db.select({ id: tables.importItems.id, type: tables.importItems.type, data: tables.importItems.data, status: tables.importItems.status }).from(tables.importItems)
          .where(eq(tables.importItems.batchId, batchId))
      : [],
    db.select({ iban: tables.bankAccounts.iban }).from(tables.bankAccounts).where(eq(tables.bankAccounts.companyId, company.id)),
  ])
  const ibans = [company.iban, ...accounts.map(a => a.iban)].filter((x): x is string => !!x)
  // Web, email, teléfono y dirección: la IA reconoce así el pie de página de las facturas propias
  const contact = [company.website, company.email, company.phone, [company.address, company.city].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || null
  const k: Knowledge = {
    ctx: {
      company: { legalName: company.legalName, tradeName: company.tradeName, nif: company.nif, ibans, contact, email: company.email, phone: company.phone, address: company.address, postalCode: company.postalCode, city: company.city, province: company.province, country: company.country, defaultVatRate: company.defaultVatRate },
      contacts: contacts.map(c => ({ name: c.name, tradeName: c.tradeName, nif: c.nif, email: c.email, phone: c.phone, address: c.address, iban: c.iban, isClient: c.isClient, isSupplier: c.isSupplier })),
      categories,
      direction,
      today: toISODate(new Date()),
    },
    contacts,
    duplicates: new ImportDuplicateIndex(),
    itemsByName: new Map(),
    seen: new Map(),
  }
  for (const c of contacts) {
    k.duplicates.add({ type: 'contact', party: c }, { type: 'contact', id: c.id, label: `Ya existe: ${c.name}` })
  }
  for (const s of sales) k.duplicates.add({ type: 'sales', kind: s.kind, party: s.customer, number: s.number, issueDate: s.issueDate, total: s.total }, { type: 'sales', id: s.id, label: `Ya existe: ${s.kind === 'quote' ? 'Presupuesto' : s.kind === 'proforma' ? 'Proforma' : 'Factura'} ${s.number ?? '(sin número)'}` })
  for (const e of expenses) {
    const label = `Gasto ${e.number ?? ''} de ${e.supplier?.name ?? e.description ?? ''}`.replace(/\s+/g, ' ')
    // Creado desde un cargo y aún sin factura: su fecha es la del pago
    const paidOnBank = !e.fileId && !e.number && !!e.notes?.startsWith('Creado desde el banco')
    k.duplicates.add({ type: 'expense', party: e.supplier, number: e.number, issueDate: e.issueDate, total: e.total, description: e.description, paidOnBank }, { type: 'expense', id: e.id, label: `Ya existe: ${label}${paidOnBank ? ` (pagado el ${e.issueDate.split('-').reverse().join('/')})` : ''}` })
  }
  for (const i of items) {
    k.itemsByName.set(comparableName(i.name), { id: i.id, label: i.name })
    if (i.sku) k.itemsByName.set(`sku:${i.sku.toLowerCase()}`, { id: i.id, label: i.name })
  }
  // Reanudar un lote: lo ya leído cuenta para los duplicados internos
  for (const it of existing) {
    if (it.status === 'excluded') continue
    const record = duplicateRecord(it.type, it.data)
    if (record) k.duplicates.add(record, { type: 'file', id: 0, label: 'Repetido en otro archivo de este lote' })
    for (const key of itemKeys(it.type, it.data)) k.seen.set(key, 'otro archivo de este lote')
  }
  return k
}

const normalizeNumber = (n: string) => normalizeDocNumber(n)

const isQuoteData = (d: ImportInvoiceData) => d.docType === 'quote' || d.docType === 'proforma'

/** Claves con las que se reconoce un registro repetido */
function itemKeys(type: ImportItemType, data: ItemRow['data']): string[] {
  if (!data) return []
  if (type === 'item') {
    const d = data as ImportCatalogData
    return [`item|${comparableName(d.name)}`, ...(d.sku ? [`item|sku:${d.sku.toLowerCase()}`] : [])]
  }
  return []
}

function matchContact(k: Knowledge, party: ImportParty | null) {
  return party ? findSimilarContact(k.contacts, party)?.id ?? null : null
}

function duplicateRecord(type: ImportItemType, data: ItemRow['data']): DuplicateRecord | null {
  if (!data) return null
  if (type === 'sales' || type === 'expense') {
    const d = data as ImportInvoiceData
    return { type, kind: d.docType, party: d.party, number: d.number, issueDate: d.issueDate, total: d.total, description: d.description }
  }
  return type === 'contact' ? { type, party: (data as ImportContactData).party } : null
}

/** El usuario confirmó que no es un duplicado: solo cuentan las coincidencias seguras */
const allowsDuplicate = (type: ImportItemType, data: ItemRow['data']) => (type === 'sales' || type === 'expense') && !!(data as ImportInvoiceData | null)?.allowDuplicate

/** Duplicado en la base de datos o ya visto en el lote */
function findDuplicate(k: Knowledge, type: ImportItemType, data: ItemRow['data']): ImportDuplicate | null {
  const record = duplicateRecord(type, data)
  const match = record ? k.duplicates.find(record, { certainOnly: allowsDuplicate(type, data) }) : null
  if (match) return { ...match.value, label: `${match.value.label}. ${match.reason}`, certain: match.certain }
  if (type === 'item') {
    const d = data as ImportCatalogData
    const hit = (d.sku ? k.itemsByName.get(`sku:${d.sku.toLowerCase()}`) : undefined) ?? k.itemsByName.get(comparableName(d.name))
    if (hit) return { type: 'item', id: hit.id, label: `Ya está en el catálogo: ${hit.label}` }
  }
  for (const key of itemKeys(type, data)) {
    const where = k.seen.get(key)
    if (where) return { type: 'file', id: 0, label: `Repetida en ${where}` }
  }
  return null
}

interface NewItem {
  type: ImportItemType
  data: NonNullable<ItemRow['data']>
  warnings: string[]
  blocking: boolean
  confidence: number | null
}

async function saveItems(k: Knowledge, companyId: number, batchId: number, file: FileRow, items: NewItem[]) {
  if (!items.length) return
  const rows = items.map((it, position) => {
    const duplicate = findDuplicate(k, it.type, it.data)
    const record = duplicateRecord(it.type, it.data)
    if (record) k.duplicates.add(record, { type: 'file', id: 0, label: `Repetido en ${file.originalName}` })
    // Sin await entre comprobar y anotar: los archivos que se leen a la vez no se pisan
    for (const key of itemKeys(it.type, it.data)) if (!k.seen.has(key)) k.seen.set(key, file.originalName)
    // Reutilizar un contacto puede añadir su papel de cliente/proveedor, sin crear otro.
    const reuseContact = !!duplicate && it.type === 'contact'
    const warnings = reuseContact ? [...it.warnings, 'Se reutilizará el contacto existente y se añadirá su papel de cliente o proveedor si falta'] : it.warnings
    const status: ImportItemStatus = duplicate && !reuseContact ? 'duplicate' : it.blocking ? 'error' : warnings.length ? 'warning' : 'ready'
    const contactId = it.type === 'sales' || it.type === 'expense' ? matchContact(k, (it.data as ImportInvoiceData).party) : null
    return { companyId, batchId, fileId: file.id, position, type: it.type, status, data: it.data, contactId, duplicate, confidence: it.confidence, warnings }
  })
  await useDb().insert(tables.importItems).values(rows)
}

function quarterFromDate(date: string | null) {
  if (!date) return null
  return { year: Number(date.slice(0, 4)), quarter: Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1 }
}

/** Cliente o proveedor de un registro (las facturas y los contactos) */
function partyOf(it: Pick<NewItem, 'type' | 'data'>): ImportParty | null {
  if (it.type === 'sales' || it.type === 'expense') return (it.data as ImportInvoiceData).party
  if (it.type === 'contact') return (it.data as ImportContactData).party
  return null
}

/** Documentos leídos de un archivo → registros a revisar */
function documentsToItems(docs: ExtractedDocument[], k: Knowledge, path: string, file: FileRow): NewItem[] {
  const hints = pathHints(path)
  // Las carpetas del usuario (Emitidas, Gastos, Presupuestos, Albaranes, Nóminas…) dicen qué hay dentro
  const folder = folderSignals(path)
  const ctx: ExtractContext = { ...k.ctx, path, fileDate: file.sourceDate }
  return docs.map((read): NewItem => {
    const d = { ...read, documentType: typeFromFolder(read.documentType, folder) }
    const mismatch = folderMismatch(d.documentType, folder)
    const notes = mismatch ? [mismatch] : []
    const quote = d.documentType === 'quote' || d.documentType === 'proforma'
    const dir = isInvoiceDoc(d) || quote ? detectDirection(d, ctx, hints.direction) : null
    // Presupuestos y proformas de la empresa van a Presupuestos; los de proveedores, al archivo
    if (!dir || (quote && dir.direction !== 'issued')) {
      const resolvedDate = resolveDocumentDate(d.issueDate, file.sourceDate)
      return { type: 'vault', data: vaultData({ ...d, issueDate: resolvedDate.date }, hints, file, vaultFolderFor(d.documentType, folder.kind), ctx), warnings: [...notes, ...vaultWarnings(d.documentType), ...(resolvedDate.warning ? [resolvedDate.warning] : [])], blocking: false, confidence: d.confidence }
    }
    // La IA cruzó emisor y cliente: se intercambian para tomar bien el cliente o el proveedor
    const conv = toInvoiceData(dir.document, dir.direction, ctx)
    return {
      type: dir.direction === 'issued' ? 'sales' : 'expense',
      data: quote ? { ...conv.data, references: cleanReferences([...(d.references ?? []), ...(d.customerReference ? [d.customerReference] : [])], d.number) } : conv.data,
      warnings: [...notes, ...(dir.warning ? [dir.warning] : []), ...conv.warnings],
      blocking: conv.blocking || dir.blocking,
      confidence: d.confidence,
    }
  })
}

/** Avisos de un documento que no es factura (sin vincular a ninguna) */
export function vaultWarnings(type: ExtractedDocType) {
  if (type === 'quote' || type === 'proforma') return ['Es un presupuesto o proforma que no emite tu empresa: se guardará en el archivo']
  if (type === 'purchase_order') return ['Es una orden de pedido, no una factura: se guardará en el archivo salvo que la vincules a su factura']
  if (type === 'delivery_note') return ['Es un albarán, no una factura: se guardará en el archivo salvo que lo vincules a su factura']
  if (type === 'other') return ['No parece una factura: se guardará en el archivo trimestral']
  return []
}

function vaultData(d: ExtractedDocument, hints: PathHints, file: FileRow, folder: string, ctx: ExtractContext): ImportVaultData {
  const issueDate = d.issueDate && /^\d{4}-\d{2}-\d{2}$/.test(d.issueDate) ? d.issueDate : null
  const q = quarterFromDate(issueDate)
  const created = quarterFromDate(toISODate(file.createdAt))!
  return {
    folder,
    // Un modelo de Hacienda se presenta después de su periodo: manda el trimestre de la carpeta o del nombre
    year: (d.documentType === 'tax_form' && hints.year && hints.quarter ? hints.year : null) ?? q?.year ?? hints.year ?? created.year,
    quarter: (d.documentType === 'tax_form' && hints.year && hints.quarter ? hints.quarter : null) ?? q?.quarter ?? hints.quarter ?? created.quarter,
    docType: d.documentType,
    summary: d.summary,
    ref: {
      number: d.number?.trim().slice(0, 60) || null,
      parties: otherParties(d, ctx),
      issueDate,
      total: d.total,
      references: cleanReferences([...(d.references ?? []), ...(d.customerReference ? [d.customerReference] : [])], d.number),
    },
    link: null,
  }
}

async function processFile(k: Knowledge, companyId: number, batchId: number, file: FileRow) {
  const db = useDb()
  await db.update(tables.files).set({ aiStatus: 'processing', aiError: null }).where(eq(tables.files.id, file.id))
  try {
    // Archivo ya importado antes (misma huella): no se vuelve a leer
    const [same] = await db.select({ id: tables.files.id, linkedType: tables.files.linkedType, linkedId: tables.files.linkedId, kind: tables.files.kind })
      .from(tables.files)
      .where(and(eq(tables.files.companyId, companyId), eq(tables.files.sha256, file.sha256!), ne(tables.files.id, file.id), isNotNull(tables.files.linkedId)))
      .limit(1)
    if (same && (same.linkedType === 'sales_document' || same.linkedType === 'expense')) {
      const type = same.linkedType === 'sales_document' ? 'sales' : 'expense'
      await db.insert(tables.importItems).values({
        companyId, batchId, fileId: file.id, position: 0, type, status: 'duplicate', data: null, contactId: null, confidence: null, warnings: [],
        duplicate: { type, id: same.linkedId!, label: 'Este archivo ya se importó', certain: true },
      })
      await db.update(tables.files).set({ aiStatus: 'done' }).where(eq(tables.files.id, file.id))
      return
    }
    // Ya guardado en el archivo trimestral o como adjunto: no se vuelve a archivar
    const [archived] = await db.select({ id: tables.files.id, folder: tables.files.folder, year: tables.files.year, quarter: tables.files.quarter }).from(tables.files)
      .where(and(eq(tables.files.companyId, companyId), eq(tables.files.sha256, file.sha256!), ne(tables.files.id, file.id), inArray(tables.files.kind, ['vault', 'attachment'])))
      .limit(1)
    if (archived) {
      const where = archived.year && archived.quarter ? ` (${archived.quarter}T ${archived.year}${archived.folder ? ` · ${archived.folder}` : ''})` : ''
      await db.insert(tables.importItems).values({
        companyId, batchId, fileId: file.id, position: 0, type: 'vault', status: 'duplicate', data: null, contactId: null, confidence: null, warnings: [],
        duplicate: { type: 'file', id: archived.id, label: `Este documento ya está en el archivo${where}`, certain: true },
      })
      await db.update(tables.files).set({ aiStatus: 'done' }).where(eq(tables.files.id, file.id))
      return
    }

    const data = await readStoredFile(file.path)
    const kind = importKind(data, file.originalName)
    if (!kind) throw new AiError('Formato no admitido', 415)
    // Lotes anteriores a guardar metadatos: recuperarlos del original, sin usar la fecha del reintento.
    if (!file.sourceDate) {
      file.sourceDate = await resolveFileDate(data, kind.ext, { uploadedAt: file.createdAt })
      await db.update(tables.files).set({ sourceDate: file.sourceDate }).where(eq(tables.files.id, file.id))
    }
    const path = file.sourcePath || file.originalName
    const ctx: ExtractContext = { ...k.ctx, path, fileDate: file.sourceDate }
    let items: NewItem[] = []
    let meta: { model: string, ms: number, tokens: { input: number, output: number } }
    let documents: ExtractedDocument[] | undefined
    let sheet: Record<string, unknown> | undefined

    if (kind.family === 'sheet') {
      const sheets = readSheets(data, kind.ext)
      if (!sheets.length) throw new AiError('La hoja de cálculo está vacía', 422)
      const analysis = await analyzeSheets(sheets, ctx)
      meta = { model: analysis.model, ms: analysis.ms, tokens: analysis.tokens }
      sheet = { mappings: analysis.mappings }
      const hint = pathHints(path).direction
      for (const m of analysis.mappings) {
        const s = sheets.find(x => x.name === m.name) ?? (analysis.mappings.length === 1 ? sheets[0] : undefined)
        if (!s) continue
        if (m.kind === 'invoice_document') {
          const ex = await extractDocuments([{ type: 'input_text', text: `Hoja "${s.name}":\n${sheetAsText(s)}` }], ctx)
          meta = { model: ex.model, ms: meta.ms + ex.ms, tokens: { input: meta.tokens.input + ex.tokens.input, output: meta.tokens.output + ex.tokens.output } }
          documents = [...(documents ?? []), ...ex.documents]
          items.push(...documentsToItems(ex.documents, k, path, file))
        }
        else {
          items.push(...sheetRecords(s, m, ctx, hint).map(r => ({ ...r, confidence: 92 })))
        }
      }
      if (!items.length) throw new AiError('No se encontraron facturas, contactos ni productos en la hoja', 422)
    }
    else {
      const ex = await extractDocuments(aiPartsFor(kind, data, file.originalName), ctx)
      meta = { model: ex.model, ms: ex.ms, tokens: ex.tokens }
      documents = ex.documents
      if (!ex.documents.length) throw new AiError('No se encontró ningún documento legible', 422)
      items = documentsToItems(ex.documents, k, path, file)
    }

    // Si el documento no trae el código postal, se busca por la dirección
    await completePostalCodes(items.map(partyOf))
    await saveItems(k, companyId, batchId, file, items)
    await db.update(tables.files).set({ aiStatus: 'done', aiResult: { ...meta, documents, sheet } }).where(eq(tables.files.id, file.id))
  }
  catch (err) {
    const message = err instanceof AiError ? err.message : (err as { statusMessage?: string }).statusMessage ?? 'No se pudo leer el archivo'
    if (!(err instanceof AiError)) console.error('[import] archivo', file.id, err)
    await db.update(tables.files).set({ aiStatus: 'failed', aiError: message.slice(0, 500) }).where(eq(tables.files.id, file.id))
  }
  finally {
    await db.update(tables.importBatches).set({ processedFiles: sql`${tables.importBatches.processedFiles} + 1` }).where(eq(tables.importBatches.id, batchId))
  }
}

async function processBatch(companyId: number, batchId: number) {
  const db = useDb()
  const batch = await getBatch(companyId, batchId)
  const [company] = await db.select().from(tables.companies).where(eq(tables.companies.id, companyId))
  if (!company) return
  await db.update(tables.importBatches).set({ status: 'processing' }).where(eq(tables.importBatches.id, batchId))
  const k = await loadKnowledge(company, batch.direction, batch.id)
  // Pendientes y los que quedaron a medias si el servidor se reinició
  const files = await db.select().from(tables.files)
    .where(and(eq(tables.files.batchId, batchId), inArray(tables.files.aiStatus, ['pending', 'processing'])))
  // Recontar: los reintentos y reinicios no deben inflar el progreso
  const [counted] = await db.select({ done: sql<number>`count(*)` }).from(tables.files)
    .where(and(eq(tables.files.batchId, batchId), inArray(tables.files.aiStatus, ['done', 'failed'])))
  await db.update(tables.importBatches).set({ processedFiles: Number(counted?.done ?? 0) }).where(eq(tables.importBatches.id, batchId))
  await runLimited(files.map(f => () => processFile(k, companyId, batchId, f)), aiSettings().concurrency)
  await linkRelatedDocuments(batchId)
  await db.update(tables.importBatches).set({ status: 'review' }).where(eq(tables.importBatches.id, batchId))
  if (batch.source !== 'scan' && batch.createdBy) {
    void sendPush([batch.createdBy], {
      title: `La IA ha leído ${batch.totalFiles} ${batch.totalFiles === 1 ? 'documento' : 'documentos'}`,
      body: `${batch.name ?? 'Importación'}: revisa y confirma lo que ha encontrado.`,
      url: `/documentos/importacion/${batchId}`,
      tag: `import-${batchId}`,
    }).catch(() => {})
  }
}

// ─── Pedidos, albaranes y presupuestos que acompañan a una factura emitida ───

/** Lo que puede ir con una factura emitida: se adjunta a ella en vez de ir al archivo trimestral */
const LINKABLE_TYPES = new Set<ExtractedDocType>(['purchase_order', 'delivery_note', 'quote', 'proforma', 'contract', 'other'])

export const isLinkableDoc = (d: ImportVaultData) => !!d.ref && LINKABLE_TYPES.has(d.docType)

/** Números con cifras que aparecen en unas referencias ("Pedido 4500123 de 12/03" → 4500123 y 1203), con su texto */
function refKeys(values: Array<string | null | undefined>) {
  const keys = new Map<string, string>()
  for (const v of values) {
    if (!v) continue
    for (const text of [v, ...v.split(/[\s,;:()#]+|N[º°]/i)]) {
      const key = normalizeNumber(text)
      if (/\d/.test(key) && !keys.has(key)) keys.set(key, text.trim())
    }
  }
  return keys
}

/** Mismo número, o el mismo con un prefijo de letras delante ("PO4500123" = "4500123") */
function sameRef(a: string, b: string) {
  if (a === b) return true
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  return short.length >= 4 && (short.match(/\d/g)?.length ?? 0) >= 3 && long.endsWith(short) && /[A-Z]/.test(long[long.length - short.length - 1]!)
}

/** El número que comparten dos listas de referencias, tal y como figura (el más corto: "EC-4521", no "pedido EC-4521") */
function commonRef(as: Map<string, string>, bs: Map<string, string>) {
  for (const [a, aText] of as) {
    for (const [b, bText] of bs) if (sameRef(a, b)) return a.length <= b.length ? aText : bText
  }
  return null
}

/** ¿Es el cliente de la factura? Por NIF si ambos lo tienen; si no, por el nombre */
function partyLevel(parties: ImportDocRef['parties'], p: ImportParty | null): 'nif' | 'name' | 'mismatch' | null {
  if (!p || !parties.length) return null
  let level: 'name' | 'mismatch' | null = null
  for (const x of parties) {
    if (x.nif && p.nif) {
      if (comparableNif(x.nif) === comparableNif(p.nif)) return 'nif'
      level ??= 'mismatch'
      continue
    }
    const a = comparableName(x.name)
    const b = comparableName(p.name)
    if (a && b && (a === b || (Math.min(a.length, b.length) >= 5 && (a.includes(b) || b.includes(a))))) level = 'name'
  }
  return level
}

interface Relation {
  score: number
  reason: string
  days: number | null
}

/** Cuánto indica que un documento acompaña a una factura: números citados, cliente, importe, fecha y archivo */
function relation(doc: ImportVaultData, inv: ImportInvoiceData, place: 'file' | 'folder' | null): Relation | null {
  const r = doc.ref!
  const party = partyLevel(r.parties, inv.party)
  if (party === 'mismatch') return null
  const noun = docTypeNoun(doc.docType)
  const invCites = refKeys([inv.customerReference, ...(inv.references ?? [])])
  const docCites = refKeys(r.references)
  let score = 0
  let reason: string | null = null
  if (r.number && commonRef(invCites, refKeys([r.number]))) {
    score += 60
    reason = `La factura cita ${noun} ${r.number}`
  }
  else if (inv.number && commonRef(docCites, refKeys([inv.number]))) {
    score += 60
    reason = `${noun.charAt(0).toUpperCase()}${noun.slice(1)} cita la factura ${inv.number}`
  }
  else {
    const common = commonRef(invCites, docCites)
    if (common) {
      score += 45
      reason = `Los dos citan el número ${common}`
    }
  }
  const byNumber = score > 0
  if (party === 'nif') score += 30
  else if (party === 'name') score += 20
  const base = round2(inv.taxLines.reduce((s, t) => s + t.base, 0))
  const amount = !!r.total && [inv.total, base].some(x => Math.abs(x - r.total!) <= Math.max(0.05, Math.abs(x) * 0.001))
  if (amount) score += 25
  if (place === 'file') score += 20
  else if (place === 'folder') score += 8
  const days = r.issueDate && inv.issueDate ? Math.round((Date.parse(inv.issueDate) - Date.parse(r.issueDate)) / 86_400_000) : null
  // Un pedido o un albarán es de antes de la factura (o de pocos días después), no de otro año
  const plausibleDate = days == null || (days >= -31 && days <= 400)
  if (!plausibleDate) score -= 25
  if (!byNumber) {
    if (!plausibleDate) return null
    if (party && amount) reason = 'Mismo cliente e importe'
    else if (party && place === 'file') reason = 'Mismo cliente y en el mismo archivo'
    else if (amount && place === 'file') reason = 'Mismo importe y en el mismo archivo'
    else return null
  }
  return { score, reason: reason!, days }
}

const folderOf = (path: string | undefined) => (path?.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/** Distancia para desempatar: mejor la factura posterior más cercana al documento */
const dayDistance = (r: Relation) => (r.days == null ? 100_000 : r.days < 0 ? 1000 - r.days : r.days)

/**
 * Vincula cada pedido, albarán o presupuesto del lote con la factura emitida a la que acompaña, para
 * adjuntarlo a ella al importar. Lo que el usuario vinculó o desvinculó a mano no se toca.
 */
async function linkRelatedDocuments(batchId: number) {
  const db = useDb()
  const [items, files] = await Promise.all([
    db.select().from(tables.importItems).where(and(eq(tables.importItems.batchId, batchId), inArray(tables.importItems.type, ['sales', 'vault']))),
    db.select({ id: tables.files.id, sourcePath: tables.files.sourcePath, originalName: tables.files.originalName }).from(tables.files).where(eq(tables.files.batchId, batchId)),
  ])
  const folder = new Map(files.map(f => [f.id, folderOf(f.sourcePath || f.originalName)]))
  // La copia repetida de una factura del mismo lote no cuenta: el documento va con la original
  const invoices = items.filter(i => i.type === 'sales' && i.data && !isQuoteData(i.data as ImportInvoiceData) && i.status !== 'excluded' && i.duplicate?.type !== 'file')
  for (const doc of items) {
    if (!doc.data || (doc.status !== 'ready' && doc.status !== 'warning')) continue
    if (doc.type === 'sales') {
      if (isQuoteData(doc.data as ImportInvoiceData)) await linkQuote(doc, invoices, folder)
      continue
    }
    const d = doc.data as ImportVaultData
    if (!isLinkableDoc(d) || d.link?.manual) continue
    const docFolder = doc.fileId ? folder.get(doc.fileId) : ''
    let best: (Relation & { itemId: number }) | null = null
    for (const inv of invoices) {
      const place = doc.fileId && doc.fileId === inv.fileId ? 'file' : docFolder && inv.fileId && folder.get(inv.fileId) === docFolder ? 'folder' : null
      const rel = relation(d, inv.data as ImportInvoiceData, place)
      if (rel && (!best || rel.score > best.score || (rel.score === best.score && dayDistance(rel) < dayDistance(best)))) best = { ...rel, itemId: inv.id }
    }
    const link: ImportLink | null = best ? { itemId: best.itemId, reason: best.reason, manual: false } : null
    if ((link?.itemId ?? null) === (d.link?.itemId ?? null) && (link?.reason ?? null) === (d.link?.reason ?? null)) continue
    const warnings = link ? [] : vaultWarnings(d.docType)
    await db.update(tables.importItems).set({ data: { ...d, link }, warnings, status: warnings.length ? 'warning' : 'ready' }).where(eq(tables.importItems.id, doc.id))
  }
}

/** Presupuesto emitido → su factura del lote (al importar, la factura queda como hecha a partir de él) */
async function linkQuote(quote: ItemRow, invoices: ItemRow[], folder: Map<number, string>) {
  const q = quote.data as ImportInvoiceData
  if (q.link?.manual) return
  const asDoc: ImportVaultData = {
    folder: 'otros', year: 0, quarter: 0, summary: null, docType: q.docType === 'proforma' ? 'proforma' : 'quote',
    // Con la base: el presupuesto no suele llevar la retención que sí lleva la factura
    ref: { number: q.number, parties: q.party ? [{ name: q.party.name, nif: q.party.nif }] : [], issueDate: q.issueDate, total: round2(q.taxLines.reduce((s, t) => s + t.base, 0)), references: q.references ?? [] },
  }
  const qFolder = quote.fileId ? folder.get(quote.fileId) : ''
  let best: (Relation & { itemId: number }) | null = null
  for (const inv of invoices) {
    const place = quote.fileId && quote.fileId === inv.fileId ? 'file' : qFolder && inv.fileId && folder.get(inv.fileId) === qFolder ? 'folder' : null
    const rel = relation(asDoc, inv.data as ImportInvoiceData, place)
    if (rel && (!best || rel.score > best.score || (rel.score === best.score && dayDistance(rel) < dayDistance(best)))) best = { ...rel, itemId: inv.id }
  }
  const link: ImportLink | null = best ? { itemId: best.itemId, reason: best.reason, manual: false } : null
  if ((link?.itemId ?? null) === (q.link?.itemId ?? null) && (link?.reason ?? null) === (q.link?.reason ?? null)) return
  await useDb().update(tables.importItems).set({ data: { ...q, link } }).where(eq(tables.importItems.id, quote.id))
}

/** Factura a la que se adjunta un documento vinculado: la recién importada o la que ya existía (duplicada) */
async function linkTarget(companyId: number, batchId: number, itemId: number) {
  const [inv] = await useDb().select({ type: tables.importItems.type, status: tables.importItems.status, resultId: tables.importItems.resultId, duplicate: tables.importItems.duplicate })
    .from(tables.importItems)
    .where(and(eq(tables.importItems.id, itemId), eq(tables.importItems.batchId, batchId), eq(tables.importItems.companyId, companyId)))
  // Factura excluida o que ya no está: el documento va al archivo como cualquier otro
  if (!inv || inv.type !== 'sales' || inv.status === 'excluded') return null
  if (inv.status === 'imported' && inv.resultId) return inv.resultId
  if (inv.status === 'duplicate' && inv.duplicate?.type === 'sales' && inv.duplicate.id) return inv.duplicate.id
  throw createError({ statusCode: 409, statusMessage: 'Importa antes la factura a la que va vinculado o desvincúlalo' })
}

// ─── Revisión ────────────────────────────────────────────────────────────────

/** Avisos de una factura editada a mano (los de la IA ya no aplican) */
export function invoiceWarnings(d: ImportInvoiceData, direction: ImportDirection) {
  const warnings: string[] = []
  if (d.dateFallback?.date === d.issueDate) warnings.push(sourceDateWarning(d.dateFallback))
  const computed = round2(d.taxLines.reduce((s, t) => s + t.base + t.vatAmount + t.surchargeAmount, 0) - d.irpfAmount)
  if (Math.abs(computed - d.total) > 0.05) warnings.push(`Los importes no cuadran: base + IVA − retención suman ${eurText(computed)} y el total es ${eurText(d.total)}`)
  for (const t of d.taxLines) {
    if (Math.abs(t.vatAmount - pctOf(t.base, t.vatRate)) > Math.max(0.05, Math.abs(t.base) * 0.002)) warnings.push(`La cuota del IVA ${t.vatRate} % no corresponde a su base`)
  }
  if (!d.number && d.docType === 'invoice') warnings.push('No se encontró el número de factura')
  if (d.party?.nif && d.party.country === 'ES' && !validateNif(d.party.nif).valid) warnings.push(`El NIF ${d.party.nif} no es válido: revísalo`)
  if (!d.party && d.docType === 'invoice') warnings.push(direction === 'issued' ? 'No figura el cliente' : 'No figura el proveedor')
  if (d.currency && d.currency !== 'EUR') warnings.push(currencyWarning(d.currency, direction))
  return { warnings, blocking: !d.issueDate || !d.taxLines.length }
}

// ─── Confirmación: crear facturas, gastos, contactos y productos ────────────

export interface CommitResult {
  imported: number
  failed: Array<{ id: number, message: string }>
  summary: NonNullable<typeof tables.importBatches.$inferSelect['summary']>
}

interface CommitState {
  company: Company
  userId: number
  options: ImportOptions
  today: string
  contacts: Array<DuplicateParty & { id: number, name: string }>
  itemIds: Map<string, number>
  categories: Map<number, { deductiblePct: number, accountCode: string | null }>
  /** Deducibilidad que se marcó la última vez con cada proveedor (o la de la categoría) */
  guessDeductible: Awaited<ReturnType<typeof deductibleGuesser>>
  summary: CommitResult['summary']
  /** Contactos y productos nuevos: el lote los guarda para poder eliminarlos con él */
  created: { contacts: number[], items: number[] }
}

const IMPORTED_CONTACT_NOTE = 'Creado al importar documentos'

async function ensureContact(st: CommitState, party: ImportParty, role: { client: boolean, supplier: boolean }, existingId: number | null) {
  const db = useDb()
  const id = existingId ?? findSimilarContact(st.contacts, party)?.id
  if (id) {
    // Si ya existe, se marca también como cliente o proveedor según el caso
    const patch = { ...(role.client ? { isClient: true } : {}), ...(role.supplier ? { isSupplier: true } : {}) }
    if (Object.keys(patch).length) await db.update(tables.contacts).set(patch).where(and(eq(tables.contacts.id, id), eq(tables.contacts.companyId, st.company.id)))
    // Y se completa con lo que faltaba en su ficha (NIF, email, dirección…), sin crear otro contacto.
    // Elegido a mano para datos de otra empresa: no se le copia nada.
    const known = st.contacts.find(c => c.id === id)
    if (known && (!existingId || findSimilarContact([known], party))) Object.assign(known, await fillContactGaps(st.company.id, id, party))
    return id
  }
  const nif = party.nif
  const [res] = await db.insert(tables.contacts).values({
    companyId: st.company.id,
    isClient: role.client,
    isSupplier: role.supplier,
    kind: party.isPerson ? 'person' : 'company',
    name: party.name,
    nif,
    nifType: nif && !validateNif(nif).valid && looksLikeEuVat(nif) ? 'vat_eu' : 'nif',
    email: party.email,
    phone: party.phone,
    address: party.address,
    postalCode: party.postalCode,
    city: party.city,
    province: party.province,
    country: party.country || 'ES',
    notes: IMPORTED_CONTACT_NOTE,
  }).$returningId()
  st.contacts.push({ ...party, id: res!.id })
  st.created.contacts.push(res!.id)
  st.summary.contactsCreated = (st.summary.contactsCreated ?? 0) + 1
  return res!.id
}

/** Producto o servicio del catálogo para una línea: el existente o uno nuevo */
async function ensureCatalogItem(st: CommitState, l: { description: string, sku: string | null, kind: 'service' | 'product', unitPrice: number, vatRate: number }, fromCatalog = false) {
  const [first, ...rest] = l.description.split('\n')
  const name = first!.trim().slice(0, 200)
  if (!name) return null
  const keys = [comparableName(name), ...(l.sku ? [`sku:${l.sku.toLowerCase()}`] : [])]
  for (const key of keys) {
    const id = st.itemIds.get(key)
    if (id) return id
  }
  // Solo conceptos con aspecto de producto o servicio de catálogo, no textos largos a medida
  if (!fromCatalog && (!st.options.createItems || name.length > 120 || l.unitPrice <= 0)) return null
  const [res] = await useDb().insert(tables.items).values({
    companyId: st.company.id,
    kind: l.kind,
    name,
    description: rest.join('\n').trim() || null,
    sku: l.sku,
    unitPrice: l.unitPrice,
    vatRate: l.vatRate,
  }).$returningId()
  for (const key of keys) st.itemIds.set(key, res!.id)
  st.created.items.push(res!.id)
  st.summary.itemsCreated = (st.summary.itemsCreated ?? 0) + 1
  return res!.id
}

function isPaid(st: CommitState, d: ImportInvoiceData) {
  return d.paid === true || (d.paid === null && st.options.markPaid && (d.dueDate ?? d.issueDate ?? st.today) < st.today)
}

/** Un Excel o CSV con muchas facturas no es "el documento original" de ninguna de ellas */
const ownFile = (file: FileRow | null) => (file && !/spreadsheet|excel|csv|tab-separated/.test(file.mime) ? file : null)

async function commitSales(st: CommitState, item: ItemRow, file: FileRow | null) {
  const d = item.data as ImportInvoiceData
  const db = useDb()
  const quote = isQuoteData(d)
  const contactId = d.party ? await ensureContact(st, d.party, { client: true, supplier: false }, item.contactId) : null
  const lines = await Promise.all(d.lines.map(async l => ({
    ...l,
    itemId: d.linesMatch ? await ensureCatalogItem(st, l) : null,
    irpfApplies: true,
  })))
  const fromLines = computeTotals(lines, d.irpfRate)
  const taxBase = round2(d.taxLines.reduce((s, t) => s + t.base, 0))
  const paid = !quote && isPaid(st, d)
  const rectifying = d.docType === 'credit_note'
  const [rectified] = rectifying && d.rectifiedNumber
    ? await db.select({ id: tables.salesDocuments.id }).from(tables.salesDocuments)
        .where(and(eq(tables.salesDocuments.companyId, st.company.id), eq(tables.salesDocuments.number, d.rectifiedNumber))).limit(1)
    : []
  const payDate = [d.dueDate ?? d.issueDate!, st.today].sort()[0]!

  return db.transaction(async (tx) => {
    const [res] = await tx.insert(tables.salesDocuments).values({
      companyId: st.company.id,
      kind: quote ? (d.docType as 'quote' | 'proforma') : rectifying ? 'rectifying' : 'invoice',
      // Un presupuesto antiguo ya se envió (si su factura está en el lote, queda facturado al confirmarla)
      status: quote ? 'sent' : paid ? 'paid' : 'issued',
      number: d.number,
      year: Number(d.issueDate!.slice(0, 4)),
      issueDate: d.issueDate!,
      dueDate: d.dueDate,
      contactId,
      customerReference: d.customerReference,
      customer: d.party ? { name: d.party.name, nif: d.party.nif, email: d.party.email, address: d.party.address, postalCode: d.party.postalCode, city: d.party.city, province: d.party.province, country: d.party.country } : { name: 'Cliente final' },
      issuer: companySnapshot(st.company),
      subtotal: d.linesMatch ? fromLines.subtotal : taxBase,
      discountTotal: d.linesMatch ? fromLines.discountTotal : 0,
      taxBase,
      vatTotal: round2(d.taxLines.reduce((s, t) => s + t.vatAmount, 0)),
      surchargeTotal: round2(d.taxLines.reduce((s, t) => s + t.surchargeAmount, 0)),
      irpfRate: d.irpfRate,
      irpfTotal: d.irpfAmount,
      total: d.total,
      paidTotal: paid ? d.total : 0,
      paymentMethod: d.paymentMethod ?? 'transfer',
      // Texto del cuerpo del original (asunto, alcance, condiciones…) como descripción antes de los conceptos
      description: plainToRich(d.bodyText),
      rectifiesId: rectified?.id ?? null,
      rectificationCode: rectifying ? 'R1' : null,
      rectificationReason: rectifying && d.rectifiedNumber ? `Rectifica la factura ${d.rectifiedNumber}` : null,
      imported: true,
      fileId: ownFile(file)?.id ?? null,
      publicToken: randomBytes(24).toString('base64url'),
      paidAt: paid ? new Date(`${payDate}T12:00:00`) : null,
      createdBy: st.userId,
    }).$returningId()
    const id = res!.id
    await tx.insert(tables.salesDocumentLines).values(lines.map((l, position) => ({
      documentId: id,
      position,
      itemId: l.itemId,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPct: l.discountPct,
      vatRate: l.vatRate,
      surchargeRate: l.surchargeRate,
      irpfApplies: true,
      base: lineAmounts(l).base,
    })))
    if (paid && d.total) {
      await tx.insert(tables.payments).values({ companyId: st.company.id, direction: 'in', salesDocumentId: id, amount: d.total, date: payDate, method: d.paymentMethod ?? 'transfer', notes: 'Importada como cobrada' })
    }
    if (quote) st.summary.quotes = (st.summary.quotes ?? 0) + 1
    else st.summary.invoices = (st.summary.invoices ?? 0) + 1
    return id
  })
}

/**
 * Presupuesto y factura del mismo lote: la factura queda hecha a partir del presupuesto (como al
 * convertirlo en la app) y el presupuesto, facturado. Vale en cualquier orden de confirmación.
 */
async function relateQuote(st: CommitState, item: ItemRow, salesId: number) {
  const db = useDb()
  const d = item.data as ImportInvoiceData
  const pairs: Array<{ quoteId: number, invoiceId: number }> = []
  if (isQuoteData(d)) {
    if (!d.link?.itemId) return
    const [inv] = await db.select({ status: tables.importItems.status, resultId: tables.importItems.resultId }).from(tables.importItems)
      .where(and(eq(tables.importItems.id, d.link.itemId), eq(tables.importItems.batchId, item.batchId)))
    if (inv?.status === 'imported' && inv.resultId) pairs.push({ quoteId: salesId, invoiceId: inv.resultId })
  }
  else {
    const quotes = await db.select({ id: tables.importItems.id, data: tables.importItems.data, resultId: tables.importItems.resultId }).from(tables.importItems)
      .where(and(eq(tables.importItems.batchId, item.batchId), eq(tables.importItems.type, 'sales'), eq(tables.importItems.status, 'imported')))
    for (const q of quotes) {
      if (q.resultId && (q.data as ImportInvoiceData | null)?.link?.itemId === item.id) pairs.push({ quoteId: q.resultId, invoiceId: salesId })
    }
  }
  for (const p of pairs) {
    await db.update(tables.salesDocuments).set({ sourceId: p.quoteId })
      .where(and(eq(tables.salesDocuments.id, p.invoiceId), eq(tables.salesDocuments.companyId, st.company.id), isNull(tables.salesDocuments.sourceId)))
    await db.update(tables.salesDocuments).set({ status: 'invoiced' })
      .where(and(eq(tables.salesDocuments.id, p.quoteId), eq(tables.salesDocuments.companyId, st.company.id)))
  }
}

async function commitExpense(st: CommitState, item: ItemRow, file: FileRow | null) {
  let d = item.data as ImportInvoiceData
  const db = useDb()
  // Sin proveedor en el documento: el de las facturas con la misma numeración (9BF0758D-…)
  const supplierId = d.party ? await ensureContact(st, d.party, { client: false, supplier: true }, item.contactId) : await supplierByNumber(st.company.id, d.number)
  const [supplier] = supplierId ? await db.select().from(tables.contacts).where(eq(tables.contacts.id, supplierId)) : []
  const categoryId = d.categoryId ?? supplier?.defaultCategoryId ?? null
  const category = categoryId ? st.categories.get(categoryId) : undefined
  const deductible = st.guessDeductible({ supplierId, supplierName: d.party?.name, categoryId })
  const paid = isPaid(st, d)

  // Solo lo que pide una acción queda «por revisar»; las notas de la lectura son informativas
  let reviewNotes = reviewNotesOf(item.warnings)
  if (supplierId) reviewNotes = reviewNotes.filter(n => reviewKind(n) !== 'supplier')
  if (reviewNotes.some(n => reviewKind(n) === 'parties') && await isTrustedSupplier(st.company.id, supplierId)) reviewNotes = reviewNotes.filter(n => reviewKind(n) !== 'parties')
  // Importes en otra moneda: a euros con el cambio oficial del BCE de su fecha
  let converted: string | null = null
  if (d.currency && d.currency !== 'EUR' && d.issueDate && d.total) {
    try {
      const fx = await ecbRate(d.currency, d.issueDate)
      const s = scaleTaxLines(d.taxLines, d.irpfAmount, fx.rate)
      converted = conversionNote(d.currency, d.total, fx)
      d = { ...d, taxLines: s.lines, irpfAmount: s.irpfTotal, total: s.total }
      reviewNotes = reviewNotes.filter(n => reviewKind(n) !== 'currency')
    }
    catch (err) {
      console.warn('[import] cambio de moneda', (err as Error).message)
      reviewNotes = [...reviewNotes.filter(n => reviewKind(n) !== 'currency'), `Importes en ${d.currency}: conviértelos a euros`]
    }
  }
  const taxBase = round2(d.taxLines.reduce((s, t) => s + t.base, 0))
  return db.transaction(async (tx) => {
    const [res] = await tx.insert(tables.expenses).values({
      companyId: st.company.id,
      kind: d.docType === 'ticket' || d.docType === 'simplified' ? 'ticket' : 'invoice',
      status: paid ? 'paid' : 'pending',
      supplierId,
      supplier: supplier ? contactSnapshot(supplier) : d.party ? { name: d.party.name, nif: d.party.nif } : null,
      number: d.number,
      issueDate: d.issueDate!,
      dueDate: d.dueDate,
      categoryId,
      description: d.description,
      taxBase,
      vatTotal: round2(d.taxLines.reduce((s, t) => s + t.vatAmount, 0)),
      surchargeTotal: round2(d.taxLines.reduce((s, t) => s + t.surchargeAmount, 0)),
      irpfRate: d.irpfRate,
      irpfTotal: d.irpfAmount,
      total: d.total,
      paidTotal: paid ? d.total : 0,
      deductiblePct: deductible.deductiblePct,
      vatDeductiblePct: deductible.vatDeductiblePct,
      isInvestment: category?.accountCode === '217',
      paymentMethod: d.paymentMethod,
      fileId: ownFile(file)?.id ?? null,
      aiConfidence: item.confidence,
      reviewed: !reviewNotes.length,
      reviewNotes: reviewNotes.length ? reviewNotes : null,
      notes: [converted, d.bodyText].filter(Boolean).join('\n\n').slice(0, 5000) || null,
      paidAt: paid ? new Date() : null,
      createdBy: st.userId,
    }).$returningId()
    const id = res!.id
    await tx.insert(tables.expenseTaxLines).values(d.taxLines.map(t => ({ expenseId: id, base: t.base, vatRate: t.vatRate, vatAmount: t.vatAmount, surchargeRate: t.surchargeRate, surchargeAmount: t.surchargeAmount })))
    st.summary.expenses = (st.summary.expenses ?? 0) + 1
    return id
  })
}

async function commitItem(st: CommitState, item: ItemRow, file: FileRow | null): Promise<number> {
  const db = useDb()
  if (item.type === 'sales' || item.type === 'expense') {
    const d = item.data as ImportInvoiceData
    if (!d.issueDate || !d.taxLines.length) throw createError({ statusCode: 400, statusMessage: 'Falta la fecha o los importes' })
    const id = item.type === 'sales' ? await commitSales(st, item, file) : await commitExpense(st, item, file)
    if (item.type === 'sales') await relateQuote(st, item, id)
    const own = ownFile(file)
    if (own && !own.linkedId) {
      own.linkedType = item.type === 'sales' ? 'sales_document' : 'expense'
      own.linkedId = id
      await db.update(tables.files).set({ linkedType: own.linkedType, linkedId: id }).where(eq(tables.files.id, own.id))
    }
    return id
  }
  if (item.type === 'contact') {
    const d = item.data as ImportContactData
    return ensureContact(st, d.party, { client: d.isClient, supplier: d.isSupplier }, null)
  }
  if (item.type === 'item') {
    const d = item.data as ImportCatalogData
    const id = await ensureCatalogItem(st, { description: d.description ? `${d.name}\n${d.description}` : d.name, sku: d.sku, kind: d.kind, unitPrice: d.unitPrice, vatRate: d.vatRate }, true)
    if (!id) throw createError({ statusCode: 400, statusMessage: 'Producto sin nombre' })
    return id
  }
  // Archivo trimestral, o adjunto de la factura emitida a la que acompaña
  const d = item.data as ImportVaultData
  if (!file) throw createError({ statusCode: 400, statusMessage: 'Sin archivo' })
  const target = d.link?.itemId ? await linkTarget(st.company.id, item.batchId, d.link.itemId) : null
  if (target) {
    // En el mismo PDF que la factura: ya es su documento original
    if (!(file.linkedType === 'sales_document' && file.linkedId === target)) {
      await db.update(tables.files).set({ kind: 'attachment', linkedType: 'sales_document', linkedId: target, notes: d.summary?.slice(0, 255) ?? null }).where(eq(tables.files.id, file.id))
      Object.assign(file, { kind: 'attachment', linkedType: 'sales_document', linkedId: target })
    }
    // El nº de pedido pasa a "su referencia" de la factura si no tenía
    if (d.docType === 'purchase_order' && d.ref?.number) {
      await db.update(tables.salesDocuments).set({ customerReference: d.ref.number.slice(0, 80) })
        .where(and(eq(tables.salesDocuments.id, target), eq(tables.salesDocuments.companyId, st.company.id), isNull(tables.salesDocuments.customerReference)))
    }
    st.summary.attachments = (st.summary.attachments ?? 0) + 1
    return file.id
  }
  await db.update(tables.files).set({ kind: 'vault', folder: d.folder, year: d.year, quarter: d.quarter, notes: d.summary?.slice(0, 255) ?? null }).where(eq(tables.files.id, file.id))
  st.summary.vault = (st.summary.vault ?? 0) + 1
  return file.id
}

/** Contactos, catálogo y categorías de la empresa para crear sin duplicar */
async function commitState(company: Company, userId: number, options: ImportOptions, summary: CommitResult['summary']): Promise<CommitState> {
  const db = useDb()
  const [contacts, catalog, categories, guessDeductible] = await Promise.all([
    db.select().from(tables.contacts).where(eq(tables.contacts.companyId, company.id)),
    db.select({ id: tables.items.id, name: tables.items.name, sku: tables.items.sku }).from(tables.items).where(eq(tables.items.companyId, company.id)),
    db.select({ id: tables.categories.id, deductiblePct: tables.categories.deductiblePct, accountCode: tables.categories.accountCode }).from(tables.categories).where(eq(tables.categories.companyId, company.id)),
    deductibleGuesser(company.id),
  ])
  const st: CommitState = {
    company,
    userId,
    options,
    today: toISODate(new Date()),
    contacts,
    itemIds: new Map(),
    categories: new Map(categories.map(c => [c.id, c])),
    guessDeductible,
    summary,
    created: { contacts: [], items: [] },
  }
  for (const i of catalog) {
    st.itemIds.set(comparableName(i.name), i.id)
    if (i.sku) st.itemIds.set(`sku:${i.sku.toLowerCase()}`, i.id)
  }
  return st
}

/** Crea lo revisado. Cada registro va por separado: si uno falla, el resto se importa igual. */
export async function commitBatch(companyId: number, userId: number, batchId: number, itemIds?: number[]): Promise<CommitResult> {
  return withImportLock(companyId, () => commitBatchLocked(companyId, userId, batchId, itemIds))
}

async function commitBatchLocked(companyId: number, userId: number, batchId: number, itemIds?: number[]): Promise<CommitResult> {
  const db = useDb()
  const batch = await getBatch(companyId, batchId)
  const [company] = await db.select().from(tables.companies).where(eq(tables.companies.id, companyId))

  const itemsToHeal = await db.select({ id: tables.importItems.id, data: tables.importItems.data, warnings: tables.importItems.warnings, type: tables.importItems.type })
    .from(tables.importItems)
    .where(and(
      eq(tables.importItems.batchId, batchId),
      eq(tables.importItems.status, 'error'),
    ))
  for (const it of itemsToHeal) {
    if ((it.type === 'sales' || it.type === 'expense') && it.data) {
      const inv = it.data as ImportInvoiceData
      if (inv.issueDate && inv.taxLines?.length && (it.warnings ?? []).some(w => w.includes('Los NIF de ambas partes son distintos'))) {
        await db.update(tables.importItems).set({ status: 'warning' }).where(eq(tables.importItems.id, it.id))
      }
    }
  }

  const items = await db.select().from(tables.importItems).where(and(
    eq(tables.importItems.batchId, batchId),
    itemIds
      ? and(
          inArray(tables.importItems.id, itemIds.length ? itemIds : [0]),
          notInArray(tables.importItems.status, ['excluded', 'imported']),
        )
      : or(
          inArray(tables.importItems.status, ['ready', 'warning']),
          and(eq(tables.importItems.type, 'contact'), eq(tables.importItems.status, 'duplicate'), isNotNull(tables.importItems.data)),
        ),
  ))
  const fileIds = [...new Set(items.map(i => i.fileId).filter((x): x is number => !!x))]
  const files = fileIds.length ? await db.select().from(tables.files).where(inArray(tables.files.id, fileIds)) : []
  const fileById = new Map(files.map(f => [f.id, f]))
  const st = await commitState(company!, userId, batch.options ?? { createItems: true, markPaid: true }, { ...batch.summary })
  // Datos actuales: el lote puede llevar horas abierto y otros lotes haber terminado.
  const knowledge = await loadKnowledge(company!, batch.direction, null)

  // Primero contactos y catálogo; después facturas y gastos (que los usan); al final el archivo
  const order: Record<ImportItemType, number> = { contact: 0, item: 1, sales: 2, expense: 3, vault: 4 }
  items.sort((a, b) => order[a.type] - order[b.type] || a.id - b.id)
  const result: CommitResult = { imported: 0, failed: [], summary: st.summary }
  for (const item of items) {
    try {
      const selectedContact = item.contactId ? knowledge.contacts.find(c => c.id === item.contactId) : null
      const recordForContact = duplicateRecord(item.type, item.data)
      const matchedByContact = selectedContact && recordForContact && item.type !== 'contact'
        ? knowledge.duplicates.find({ ...recordForContact, party: selectedContact }, { certainOnly: allowsDuplicate(item.type, item.data) }) : null
      const duplicate = findDuplicate(knowledge, item.type, item.data) ?? (matchedByContact ? { ...matchedByContact.value, label: `${matchedByContact.value.label}. ${matchedByContact.reason}`, certain: matchedByContact.certain } : null)
      if (duplicate) {
        if (item.type === 'contact' && item.data) {
          const d = item.data as ImportContactData
          const existing = findImportContact(st.contacts, d.party)
          // Un homónimo ambiguo se omite, sin asignar sus papeles a una ficha arbitraria.
          if (existing) await ensureContact(st, d.party, { client: d.isClient, supplier: d.isSupplier }, existing.id)
        }
        await db.update(tables.importItems).set({ status: 'duplicate', duplicate, resultId: null }).where(eq(tables.importItems.id, item.id))
        continue
      }
      const file = item.fileId ? fileById.get(item.fileId) ?? null : null
      const fileDuplicate = ownFile(file) ? await duplicateImportedFile(companyId, file!.id) : null
      if (fileDuplicate) {
        await db.update(tables.importItems).set({ status: 'duplicate', duplicate: fileDuplicate }).where(eq(tables.importItems.id, item.id))
        continue
      }
      const resultId = await commitItem(st, item, item.fileId ? fileById.get(item.fileId) ?? null : null)
      await db.update(tables.importItems).set({ status: 'imported', resultId }).where(eq(tables.importItems.id, item.id))
      const record = duplicateRecord(item.type, item.data)
      if (record) knowledge.duplicates.add(record, { type: item.type as 'sales' | 'expense' | 'contact', id: resultId, label: 'Ya importado en este lote' })
      if (item.type === 'contact') knowledge.contacts = st.contacts
      if (item.type === 'item') {
        const d = item.data as ImportCatalogData
        knowledge.itemsByName.set(comparableName(d.name), { id: resultId, label: d.name })
        if (d.sku) knowledge.itemsByName.set(`sku:${d.sku.toLowerCase()}`, { id: resultId, label: d.name })
      }
      result.imported++
    }
    catch (err) {
      const message = (err as { statusMessage?: string }).statusMessage ?? 'No se pudo importar'
      if (!(err as { statusCode?: number }).statusCode) console.error('[import] confirmar', item.id, err)
      result.failed.push({ id: item.id, message })
    }
  }
  const [left] = await db.select({ pending: sql<number>`count(*)` }).from(tables.importItems)
    .where(and(eq(tables.importItems.batchId, batchId), inArray(tables.importItems.status, ['ready', 'warning', 'error'])))
  const [dups] = await db.select({ n: sql<number>`count(*)` }).from(tables.importItems)
    .where(and(eq(tables.importItems.batchId, batchId), eq(tables.importItems.status, 'duplicate')))
  st.summary.duplicates = Number(dups?.n ?? 0)
  await db.update(tables.importBatches).set({
    summary: st.summary,
    created: {
      contacts: [...batch.created?.contacts ?? [], ...st.created.contacts],
      items: [...batch.created?.items ?? [], ...st.created.items],
    },
    ...(Number(left?.pending ?? 0) === 0 && !isBatchRunning(batchId) ? { status: 'done' as const, finishedAt: new Date() } : {}),
  }).where(eq(tables.importBatches.id, batchId))
  return result
}

// ─── Eliminar una importación con todo lo que creó ───────────────────────────

/** Con la lista vacía no coincide nada (inArray de una lista vacía no es SQL válido en todas las versiones) */
const among = (col: Column, ids: number[]) => (ids.length ? inArray(col, ids) : sql`false`)
const outside = (col: Column, ids: number[]) => (ids.length ? notInArray(col, ids) : sql`true`)
const nonNull = <T>(x: T | null | undefined): x is T => x != null

interface UndoPlan {
  summary: ImportUndoSummary
  sales: number[]
  keptSales: number[]
  expenses: number[]
  contacts: Array<{ id: number, logoPath: string | null }>
  items: Array<{ id: number, imagePath: string | null }>
  files: Array<{ id: number, path: string }>
  payments: number[]
  /** Movimientos conciliados con lo borrado, y pendientes cuya propuesta apunta a ello */
  bank: number[]
  resuggest: number[]
}

/** Qué se borra y qué se conserva. Contactos y productos solo si los creó esta importación y nada más los usa. */
async function planUndo(companyId: number, batch: typeof tables.importBatches.$inferSelect): Promise<UndoPlan> {
  const db = useDb()
  const { salesDocuments: sd, expenses: ex, files: f, bankTransactions: bt, contacts: ct, items: it, importItems: ii } = tables
  const done = await db.select({ type: ii.type, resultId: ii.resultId }).from(ii)
    .where(and(eq(ii.batchId, batch.id), eq(ii.status, 'imported'), isNotNull(ii.resultId)))
  const results = (type: ImportItemType) => [...new Set(done.filter(i => i.type === type).map(i => i.resultId!))]

  const [salesRows, expenseRows] = await Promise.all([
    db.select({ id: sd.id, contactId: sd.contactId, issueDate: sd.issueDate, fileId: sd.fileId }).from(sd)
      .where(and(eq(sd.companyId, companyId), eq(sd.imported, true), among(sd.id, results('sales')))),
    db.select({ id: ex.id, supplierId: ex.supplierId, issueDate: ex.issueDate, fileId: ex.fileId }).from(ex)
      .where(and(eq(ex.companyId, companyId), among(ex.id, results('expense')))),
  ])

  // Emitidas con registro VeriFactu o corregidas por una rectificativa que se queda: se conservan (y las que esas rectifican)
  const allSales = salesRows.map(s => s.id)
  const [signed, rectifiers] = await Promise.all([
    db.selectDistinct({ id: tables.verifactuRecords.salesDocumentId }).from(tables.verifactuRecords).where(among(tables.verifactuRecords.salesDocumentId, allSales)),
    db.select({ id: sd.id, rectifiesId: sd.rectifiesId }).from(sd).where(and(eq(sd.companyId, companyId), among(sd.rectifiesId, allSales))),
  ])
  const keep = new Set(signed.map(s => s.id))
  for (let changed = true; changed;) {
    changed = false
    for (const r of rectifiers) {
      if ((!allSales.includes(r.id) || keep.has(r.id)) && !keep.has(r.rectifiesId!)) {
        keep.add(r.rectifiesId!)
        changed = true
      }
    }
  }
  const sales = salesRows.filter(s => !keep.has(s.id))
  const S = sales.map(s => s.id)
  const E = expenseRows.map(e => e.id)

  const payments = await db.select({ id: tables.payments.id }).from(tables.payments)
    .where(and(eq(tables.payments.companyId, companyId), or(among(tables.payments.salesDocumentId, S), among(tables.payments.expenseId, E))))
  const P = payments.map(p => p.id)
  const [bank, suggested] = await Promise.all([
    db.select({ id: bt.id }).from(bt).where(and(eq(bt.companyId, companyId), or(among(bt.salesDocumentId, S), among(bt.expenseId, E), among(bt.paymentId, P)))),
    S.length || E.length
      ? db.select({ id: bt.id, suggestion: bt.suggestion }).from(bt).where(and(eq(bt.companyId, companyId), eq(bt.status, 'pending'), isNotNull(bt.suggestion)))
      : [],
  ])
  const gone: Record<string, Set<number>> = { invoice: new Set(S), expense: new Set(E), payment: new Set(P) }
  const resuggest = suggested.filter(s => s.suggestion?.id && gone[s.suggestion.kind]?.has(s.suggestion.id)).map(s => s.id)

  // Archivos del lote y los de cada documento borrado, salvo los de las emitidas que se conservan
  const fileRows = await db.select({ id: f.id, path: f.path, size: f.size, linkedType: f.linkedType, linkedId: f.linkedId }).from(f).where(and(eq(f.companyId, companyId), or(
    eq(f.batchId, batch.id),
    and(eq(f.linkedType, 'sales_document'), among(f.linkedId, S)),
    and(eq(f.linkedType, 'expense'), among(f.linkedId, E)),
    among(f.id, [...sales, ...expenseRows].map(d => d.fileId).filter(nonNull)),
  )))
  const keptFiles = new Set(salesRows.filter(s => keep.has(s.id)).map(s => s.fileId))
  const files = fileRows.filter(x => !keptFiles.has(x.id) && !(x.linkedType === 'sales_document' && keep.has(x.linkedId!)))

  // Creados por esta importación. Las anteriores a guardar la lista: los marcados como importados durante el lote.
  const until = new Date((batch.finishedAt ?? new Date()).getTime() + 60_000)
  const during = (d: Date) => d >= batch.createdAt && d <= until
  const trackedContacts = batch.created?.contacts ?? []
  const legacyWindow = !batch.created && !!batch.finishedAt && !!batch.summary?.contactsCreated
  const contactCandidates = [...new Set([...trackedContacts, ...sales.map(s => s.contactId), ...expenseRows.map(e => e.supplierId), ...results('contact')].filter(nonNull))]
  const contactRows = (await db.select({ id: ct.id, notes: ct.notes, createdAt: ct.createdAt, logoPath: ct.logoPath }).from(ct).where(and(eq(ct.companyId, companyId), or(
    among(ct.id, contactCandidates),
    // Sin lista guardada, aunque ya se hubiera borrado a mano la factura o el gasto que los usaba
    legacyWindow ? and(eq(ct.notes, IMPORTED_CONTACT_NOTE), gte(ct.createdAt, batch.createdAt), lte(ct.createdAt, until)) : undefined,
  ))))
    .filter(c => trackedContacts.includes(c.id) || (c.notes === IMPORTED_CONTACT_NOTE && during(c.createdAt)))
  const trackedItems = batch.created?.items
  const lineItems = await db.selectDistinct({ id: tables.salesDocumentLines.itemId }).from(tables.salesDocumentLines)
    .where(and(among(tables.salesDocumentLines.documentId, S), isNotNull(tables.salesDocumentLines.itemId)))
  const itemCandidates = trackedItems ?? [...new Set([...lineItems.map(l => l.id), ...results('item')].filter(nonNull))]
  const itemRows = (await db.select({ id: it.id, createdAt: it.createdAt, imagePath: it.imagePath }).from(it)
    .where(and(eq(it.companyId, companyId), among(it.id, itemCandidates))))
    .filter(i => trackedItems || (during(i.createdAt) && !i.imagePath))

  // Los que siguen en uso (otras facturas, gastos, recurrentes, importaciones o documentos) se conservan
  const C = contactRows.map(c => c.id)
  const I = itemRows.map(i => i.id)
  const [salesUse, expenseUse, importUse, fileUse, lineUse, recurrings] = await Promise.all([
    db.selectDistinct({ id: sd.contactId }).from(sd).where(and(eq(sd.companyId, companyId), among(sd.contactId, C), outside(sd.id, S))),
    db.selectDistinct({ id: ex.supplierId }).from(ex).where(and(eq(ex.companyId, companyId), among(ex.supplierId, C), outside(ex.id, E))),
    db.selectDistinct({ id: ii.contactId }).from(ii).where(and(eq(ii.companyId, companyId), among(ii.contactId, C), ne(ii.batchId, batch.id))),
    db.selectDistinct({ id: f.linkedId }).from(f).where(and(eq(f.companyId, companyId), eq(f.linkedType, 'contact'), among(f.linkedId, C))),
    db.selectDistinct({ id: tables.salesDocumentLines.itemId }).from(tables.salesDocumentLines)
      .where(and(among(tables.salesDocumentLines.itemId, I), outside(tables.salesDocumentLines.documentId, S))),
    C.length || I.length ? db.select({ template: tables.recurrings.template }).from(tables.recurrings).where(eq(tables.recurrings.companyId, companyId)) : [],
  ])
  const usedContacts = new Set([...salesUse, ...expenseUse, ...importUse, ...fileUse].map(u => u.id))
  const usedItems = new Set(lineUse.map(u => u.id))
  for (const r of recurrings) {
    if (r.template?.contactId) usedContacts.add(r.template.contactId)
    for (const l of r.template?.lines ?? []) if (l.itemId) usedItems.add(l.itemId)
  }
  const contacts = contactRows.filter(c => !usedContacts.has(c.id))
  const items = itemRows.filter(i => !usedItems.has(i.id))

  // Modelos ya presentados de los periodos afectados (trimestre, mes o año)
  const dates = [...sales, ...expenseRows].map(d => d.issueDate)
  const periods = new Set(dates.flatMap(d => [`${d.slice(0, 4)}:${Math.ceil(Number(d.slice(5, 7)) / 3)}T`, `${d.slice(0, 4)}:${d.slice(5, 7)}`, `${d.slice(0, 4)}:0A`]))
  const years = [...new Set(dates.map(d => Number(d.slice(0, 4))))]
  const [filings, [mails]] = await Promise.all([
    db.select({ model: tables.taxFilings.model, year: tables.taxFilings.year, period: tables.taxFilings.period }).from(tables.taxFilings)
      .where(and(eq(tables.taxFilings.companyId, companyId), inArray(tables.taxFilings.status, ['filed', 'paid']), among(tables.taxFilings.year, years))),
    db.select({ n: sql<number>`count(*)` }).from(tables.mailMessages).where(and(eq(tables.mailMessages.companyId, companyId), eq(tables.mailMessages.batchId, batch.id))),
  ])
  const filed = filings.filter(x => periods.has(`${x.year}:${x.period}`))
    .sort((a, b) => a.year - b.year || a.period.localeCompare(b.period) || a.model.localeCompare(b.model))
    .map(x => `${x.model} · ${x.period === '0A' ? x.year : `${x.period} ${x.year}`}`)

  return {
    summary: {
      invoices: S.length,
      expenses: E.length,
      contacts: contacts.length,
      items: items.length,
      files: files.length,
      bytes: files.reduce((s, x) => s + x.size, 0),
      bank: bank.length,
      // Si el lote se queda (emitidas que no se pueden borrar), sus correos siguen importados
      mails: keep.size ? 0 : Number(mails?.n ?? 0),
      kept: { invoices: keep.size, contacts: contactRows.length - contacts.length, items: itemRows.length - items.length },
      filed,
    },
    sales: S,
    keptSales: [...keep],
    expenses: E,
    contacts,
    items,
    files,
    payments: P,
    bank: bank.map(b => b.id),
    resuggest,
  }
}

export async function previewUndo(companyId: number, batchId: number) {
  return (await planUndo(companyId, await getBatch(companyId, batchId))).summary
}

/** Elimina la importación con lo que creó: facturas, gastos, cobros y pagos, contactos y productos nuevos y archivos */
export async function undoBatch(company: Company, batchId: number) {
  const batch = await getBatch(company.id, batchId)
  if (isBatchRunning(batchId)) throw createError({ statusCode: 409, statusMessage: 'Espera a que termine la lectura de los archivos' })
  const plan = await planUndo(company.id, batch)
  const { salesDocuments: sd, bankTransactions: bt, importItems: ii } = tables
  const ids = <T extends { id: number }>(rows: T[]) => rows.map(r => r.id)
  await useDb().transaction(async (tx) => {
    if (plan.bank.length) {
      await tx.update(bt).set({ status: 'pending', suggestion: null, paymentId: null, salesDocumentId: null, expenseId: null, ownsPayment: false, ignoreReason: null, matchedAt: null, matchedBy: null })
        .where(inArray(bt.id, plan.bank))
    }
    if (plan.payments.length) await tx.delete(tables.payments).where(inArray(tables.payments.id, plan.payments))
    if (plan.sales.length) {
      await tx.delete(tables.salesDocumentLines).where(inArray(tables.salesDocumentLines.documentId, plan.sales))
      await tx.delete(tables.sentEmails).where(inArray(tables.sentEmails.salesDocumentId, plan.sales))
      await tx.update(sd).set({ sourceId: null }).where(and(eq(sd.companyId, company.id), inArray(sd.sourceId, plan.sales)))
      await tx.delete(sd).where(inArray(sd.id, plan.sales))
    }
    if (plan.expenses.length) {
      await tx.delete(tables.expenseTaxLines).where(inArray(tables.expenseTaxLines.expenseId, plan.expenses))
      await tx.delete(tables.expenses).where(inArray(tables.expenses.id, plan.expenses))
    }
    if (plan.contacts.length) await tx.delete(tables.contacts).where(inArray(tables.contacts.id, ids(plan.contacts)))
    if (plan.items.length) await tx.delete(tables.items).where(inArray(tables.items.id, ids(plan.items)))
    if (plan.files.length) await tx.delete(tables.files).where(inArray(tables.files.id, ids(plan.files)))
    if (plan.keptSales.length) {
      // Queda el lote con las emitidas que no se pueden borrar
      await tx.delete(ii).where(and(eq(ii.batchId, batchId), or(ne(ii.type, 'sales'), isNull(ii.resultId), notInArray(ii.resultId, plan.keptSales))))
      const gone = { contacts: new Set(ids(plan.contacts)), items: new Set(ids(plan.items)) }
      await tx.update(tables.importBatches).set({
        status: 'done',
        summary: { invoices: plan.keptSales.length },
        created: { contacts: batch.created?.contacts?.filter(id => !gone.contacts.has(id)), items: batch.created?.items?.filter(id => !gone.items.has(id)) },
      }).where(eq(tables.importBatches.id, batchId))
    }
    else {
      await tx.update(tables.mailMessages).set({ status: 'new', batchId: null }).where(and(eq(tables.mailMessages.companyId, company.id), eq(tables.mailMessages.batchId, batchId)))
      await tx.delete(ii).where(eq(ii.batchId, batchId))
      await tx.delete(tables.importBatches).where(eq(tables.importBatches.id, batchId))
    }
  })
  for (const path of [...plan.files.map(x => x.path), ...plan.contacts.map(c => c.logoPath), ...plan.items.map(i => i.imagePath)]) await deleteStoredFile(path)
  await removeEmptyFolder(`${company.id}/imports/${batchId}`)
  // Los movimientos del banco que apuntaban a lo borrado vuelven a recibir propuesta
  const resuggest = [...plan.bank, ...plan.resuggest]
  if (resuggest.length) suggestMatches(company, resuggest).catch(err => console.error('[import] propuestas del banco', batchId, err))
  return plan.summary
}

// ─── Escaneo rápido de un documento ──────────────────────────────────────────

/** Lee una factura o ticket (foto, PDF o Word) y devuelve lo encontrado para revisarlo y guardarlo */
export async function readSingleDocument(company: Company, userId: number, file: { filename: string, data: Buffer, lastModified?: unknown }, direction: ImportDirection | 'auto'): Promise<ScanReading> {
  const name = safeFilename(file.filename.split(/[\/]/).pop() || 'documento')
  const kind = importKind(file.data, name)
  if (!kind || kind.family === 'zip' || kind.family === 'sheet') {
    throw createError({ statusCode: 415, statusMessage: 'Escanea una foto, un PDF o un Word. Para Excel, CSV o ZIP usa la importación por lotes' })
  }
  if (file.data.length > MAX_IMPORT_FILE_BYTES) throw createError({ statusCode: 413, statusMessage: 'El archivo supera 40 MB' })
  const db = useDb()
  const sha256 = createHash('sha256').update(file.data).digest('hex')
  const [same] = await db.select({ linkedType: tables.files.linkedType, linkedId: tables.files.linkedId }).from(tables.files)
    .where(and(eq(tables.files.companyId, company.id), eq(tables.files.sha256, sha256), isNotNull(tables.files.linkedId), inArray(tables.files.linkedType, ['sales_document', 'expense'])))
    .limit(1)
  const path = await saveCompanyFile(company.id, 'scans', file.data, kind.ext)
  const sourceDate = await resolveFileDate(file.data, kind.ext, { lastModified: file.lastModified })
  const [res] = await db.insert(tables.files).values({
    companyId: company.id, kind: 'scan', originalName: name, mime: kind.mime, size: file.data.length, path, sha256, sourceDate, aiStatus: 'processing', uploadedBy: userId,
  }).$returningId()
  const fileId = res!.id
  const [fileRow] = await db.select().from(tables.files).where(eq(tables.files.id, fileId))
  const k = await loadKnowledge(company, direction, null)
  try {
    const ex = await extractDocuments(aiPartsFor(kind, file.data, name), { ...k.ctx, path: name })
    await db.update(tables.files).set({ aiStatus: 'done', aiResult: { model: ex.model, ms: ex.ms, tokens: ex.tokens, documents: ex.documents } }).where(eq(tables.files.id, fileId))
    if (!ex.documents.length) throw new AiError('No se encontró ningún documento legible: prueba con una foto más nítida', 422)
    const items = documentsToItems(ex.documents, k, name, fileRow!)
    const first = items.find(i => i.type === 'sales' || i.type === 'expense') ?? items[0]!
    await completePostalCode(partyOf(first))
    const isInvoice = first.type === 'sales' || first.type === 'expense'
    const warnings = [...first.warnings]
    if (ex.documents.length > 1) warnings.unshift(`El archivo contiene ${ex.documents.length} documentos: para importarlos todos usa la importación por lotes`)
    const party = isInvoice ? (first.data as ImportInvoiceData).party : null
    const contactId = matchContact(k, party)
    const known = contactId ? k.contacts.find(c => c.id === contactId) : undefined
    const duplicate: ImportDuplicate | null = same?.linkedId
      ? { type: same.linkedType === 'sales_document' ? 'sales' : 'expense', id: same.linkedId, label: 'Este documento ya está registrado', certain: true }
      : findDuplicate(k, first.type, first.data)
    // Gasto ya anotado sin su factura o ticket (desde el banco, a mano…): se le puede adjuntar este
    if (!same?.linkedId && duplicate?.type === 'expense' && duplicate.id) {
      const [e] = await db.select({ fileId: tables.expenses.fileId }).from(tables.expenses).where(and(eq(tables.expenses.id, duplicate.id), eq(tables.expenses.companyId, company.id)))
      duplicate.attachable = !!e && !e.fileId
    }
    return {
      fileId,
      fileName: name,
      mime: kind.mime,
      direction: first.type === 'sales' ? 'issued' : 'received',
      type: first.type,
      data: isInvoice ? first.data as ImportInvoiceData : null,
      vault: isInvoice ? null : first.data as ImportVaultData,
      contact: contactId ? { id: contactId, name: known?.name ?? party?.name ?? '' } : null,
      warnings,
      confidence: first.confidence,
      duplicate,
      documents: ex.documents.length,
    }
  }
  catch (err) {
    const message = err instanceof AiError ? err.message : 'No se pudo leer el documento'
    await db.update(tables.files).set({ aiStatus: 'failed', aiError: message }).where(eq(tables.files.id, fileId))
    if (err instanceof AiError) throw createError({ statusCode: err.status, statusMessage: err.message })
    throw err
  }
}

/** Escaneo aún sin vincular (lo reclaman el gasto o la factura emitida al guardarse) */
export async function claimScanFile(companyId: number, fileId: number | null | undefined) {
  if (!fileId) return null
  const [file] = await useDb().select().from(tables.files).where(and(eq(tables.files.id, fileId), eq(tables.files.companyId, companyId)))
  if (!file || file.linkedId || (file.kind !== 'scan' && file.kind !== 'import')) throw createError({ statusCode: 400, statusMessage: 'El documento escaneado ya no está disponible' })
  return file
}

/** Guarda una factura emitida leída de un escaneo (importada: conserva su número y no genera VeriFactu) */
export async function importSingleInvoice(company: Company, userId: number, input: { data: ImportInvoiceData, contactId: number | null, fileId: number | null, allowDuplicate?: boolean }) {
  return withImportLock(company.id, () => importSingleInvoiceLocked(company, userId, input))
}

async function importSingleInvoiceLocked(company: Company, userId: number, input: { data: ImportInvoiceData, contactId: number | null, fileId: number | null, allowDuplicate?: boolean }) {
  const d = reconcileInvoiceLines(input.data)
  if (!d.issueDate || !d.taxLines.length) throw createError({ statusCode: 400, statusMessage: 'Falta la fecha o los importes' })
  const db = useDb()
  let duplicateParty: DuplicateParty | null = d.party
  if (input.contactId) {
    const [c] = await db.select().from(tables.contacts).where(and(eq(tables.contacts.id, input.contactId), eq(tables.contacts.companyId, company.id)))
    if (!c) throw createError({ statusCode: 400, statusMessage: 'Cliente no encontrado' })
    duplicateParty = c
  }
  const duplicate = await findSavedImportDuplicate(company.id, { type: 'sales', kind: d.docType, party: duplicateParty, number: d.number, issueDate: d.issueDate, total: d.total }, input.fileId, { certainOnly: !!input.allowDuplicate })
  if (duplicate) throw createError({ statusCode: 409, statusMessage: duplicate.label, data: { duplicate } })
  const file = await claimScanFile(company.id, input.fileId)
  const st = await commitState(company, userId, { createItems: true, markPaid: false }, {})
  const id = await commitSales(st, { data: d, contactId: input.contactId, status: 'ready' } as ItemRow, file)
  if (file) await db.update(tables.files).set({ linkedType: 'sales_document', linkedId: id }).where(eq(tables.files.id, file.id))
  return id
}

/** Revalidación al editar o guardar: comparte las reglas de la lectura inicial. */
export async function checkImportDuplicate(companyId: number, type: ImportItemType, data: ItemRow['data'], fileId?: number | null, batchId?: number, excludeItemId?: number) {
  const [company] = await useDb().select().from(tables.companies).where(eq(tables.companies.id, companyId))
  if (!company) throw createError({ statusCode: 404, statusMessage: 'Empresa no encontrada' })
  const k = await loadKnowledge(company, 'auto', null)
  if (batchId) {
    const others = await useDb().select().from(tables.importItems).where(and(eq(tables.importItems.companyId, companyId), eq(tables.importItems.batchId, batchId), ne(tables.importItems.id, excludeItemId ?? 0), inArray(tables.importItems.status, ['ready', 'warning', 'imported'])))
    for (const other of others) {
      const record = duplicateRecord(other.type, other.data)
      if (record) k.duplicates.add(record, { type: 'file', id: 0, label: 'Repetido en este lote' })
    }
  }
  return findDuplicate(k, type, data) ?? (fileId ? await duplicateImportedFile(companyId, fileId) : null)
}

async function duplicateImportedFile(companyId: number, fileId: number): Promise<ImportDuplicate | null> {
  const db = useDb()
  const [file] = await db.select().from(tables.files).where(and(eq(tables.files.companyId, companyId), eq(tables.files.id, fileId)))
  if (!file?.sha256 || !ownFile(file)) return null
  // Un archivo puede contener varias facturas: se comprueban sus registros por datos.
  if (((file.aiResult as { documents?: unknown[] } | null)?.documents?.length ?? 0) > 1) return null
  const [same] = await db.select().from(tables.files).where(and(eq(tables.files.companyId, companyId), eq(tables.files.sha256, file.sha256), ne(tables.files.id, fileId), isNotNull(tables.files.linkedId), inArray(tables.files.linkedType, ['sales_document', 'expense']))).limit(1)
  if (((same?.aiResult as { documents?: unknown[] } | null)?.documents?.length ?? 0) > 1) return null
  return same?.linkedId ? { type: same.linkedType === 'expense' ? 'expense' : 'sales', id: same.linkedId, label: 'Este archivo ya se importó', certain: true } : null
}

/** Duplicado ya guardado; `certainOnly` cuando el usuario confirmó que no lo es (solo frena lo seguro) */
export async function findSavedImportDuplicate(companyId: number, record: DuplicateRecord, fileId?: number | null, opts: { certainOnly?: boolean } = {}): Promise<ImportDuplicate | null> {
  const [company] = await useDb().select().from(tables.companies).where(eq(tables.companies.id, companyId))
  if (!company) throw createError({ statusCode: 404, statusMessage: 'Empresa no encontrada' })
  const k = await loadKnowledge(company, 'auto', null)
  const hit = k.duplicates.find(record, opts)
  return hit ? { ...hit.value, label: `${hit.value.label}. ${hit.reason}`, certain: hit.certain } : fileId ? duplicateImportedFile(companyId, fileId) : null
}
