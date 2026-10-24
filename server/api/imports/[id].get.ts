import { asc, eq } from 'drizzle-orm'
import type { ImportCatalogData, ImportContactData, ImportInvoiceData, ImportVaultData } from '../../../shared/types/import'

/** Progreso de la lectura y lo encontrado (resumen ligero de cada registro) */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const id = idParam(event)
  let batch = await getBatch(company.id, id)
  // Servidor reiniciado a mitad de lectura: se retoma
  if (batch.status === 'processing' && !isBatchRunning(id)) {
    void startBatch(company.id, id)
    batch = await getBatch(company.id, id)
  }
  const db = useDb()
  const f = tables.files
  const [files, items] = await Promise.all([
    db.select({ id: f.id, name: f.originalName, path: f.sourcePath, size: f.size, mime: f.mime, aiStatus: f.aiStatus, aiError: f.aiError })
      .from(f).where(eq(f.batchId, id)).orderBy(asc(f.id)),
    db.select().from(tables.importItems).where(eq(tables.importItems.batchId, id)).orderBy(asc(tables.importItems.fileId), asc(tables.importItems.position)),
  ])
  const fileName = new Map(files.map(x => [x.id, x.path || x.name]))
  const counts = { ready: 0, warning: 0, duplicate: 0, error: 0, imported: 0, excluded: 0 }
  for (const it of items) {
    if (it.status === 'error' && (it.type === 'sales' || it.type === 'expense') && it.data) {
      const inv = it.data as ImportInvoiceData
      if (inv.issueDate && inv.taxLines?.length && (it.warnings ?? []).some(w => w.includes('Los NIF de ambas partes son distintos'))) {
        it.status = 'warning'
        await db.update(tables.importItems).set({ status: 'warning' }).where(eq(tables.importItems.id, it.id))
      }
    }
    counts[it.status]++
  }
  // Pedidos, albaranes y presupuestos que van con una factura emitida del lote
  const isQuote = (d: ImportInvoiceData) => d.docType === 'quote' || d.docType === 'proforma'
  const invoiceById = new Map(items.filter(it => it.type === 'sales' && it.data && !isQuote(it.data as ImportInvoiceData)).map(it => [it.id, it]))
  const linkedCount = new Map<number, number>()
  for (const it of items) {
    const to = (it.type === 'vault' || it.type === 'sales') && it.status !== 'excluded' ? (it.data as ImportVaultData | ImportInvoiceData | null)?.link?.itemId : null
    if (to && invoiceById.has(to)) linkedCount.set(to, (linkedCount.get(to) ?? 0) + 1)
  }

  return {
    batch: { ...batch, running: isBatchRunning(id) },
    files: files.map(x => ({ ...x, path: x.path || x.name })),
    counts,
    items: items.map((it) => {
      const base = {
        id: it.id,
        fileId: it.fileId,
        file: it.fileId ? fileName.get(it.fileId) ?? null : null,
        type: it.type,
        status: it.status,
        confidence: it.confidence,
        warnings: it.warnings ?? [],
        duplicate: it.duplicate?.label ?? null,
        duplicateRef: it.duplicate && it.duplicate.id ? { type: it.duplicate.type, id: it.duplicate.id } : null,
        resultId: it.resultId,
        contactId: it.contactId,
      }
      if (!it.data) return { ...base, title: 'Archivo ya importado', subtitle: null, date: null, amount: null }
      if (it.type === 'sales' || it.type === 'expense') {
        const d = it.data as ImportInvoiceData
        // Presupuesto emitido cuya factura está en el lote: se muestra colgando de ella
        const to = it.type === 'sales' && isQuote(d) && d.link?.itemId ? invoiceById.get(d.link.itemId) : undefined
        const toNumber = to ? (to.data as ImportInvoiceData).number ?? 'sin número' : null
        const subtitle = to ? `${d.number ? `${d.number} · ` : ''}Facturado en ${toNumber} · ${d.link?.reason ?? 'Vinculado a mano'}` : [d.number, d.party?.nif].filter(Boolean).join(' · ') || null
        return { ...base, title: d.party?.name ?? (it.type === 'sales' ? 'Sin cliente' : 'Sin proveedor'), subtitle, date: d.issueDate, amount: d.total, docType: d.docType, newContact: !it.contactId && !!d.party, linked: linkedCount.get(it.id) ?? 0, linkedTo: to?.id ?? null }
      }
      if (it.type === 'contact') {
        const d = it.data as ImportContactData
        return { ...base, title: d.party.name, subtitle: [d.party.nif, d.party.city].filter(Boolean).join(' · ') || null, date: null, amount: null, role: d.isClient && d.isSupplier ? 'both' : d.isClient ? 'client' : 'supplier' }
      }
      if (it.type === 'item') {
        const d = it.data as ImportCatalogData
        return { ...base, title: d.name, subtitle: d.sku, date: null, amount: d.unitPrice }
      }
      const d = it.data as ImportVaultData
      const to = d.link?.itemId ? invoiceById.get(d.link.itemId) : undefined
      if (to) {
        const inv = to.data as ImportInvoiceData
        const subtitle = to.status === 'excluded'
          ? `La factura ${inv.number ?? 'sin número'} está excluida: irá al archivo`
          : `Con la factura ${inv.number ?? 'sin número'} · ${d.link?.reason ?? 'Vinculado a mano'}`
        return { ...base, title: [docTypeLabel(d.docType), d.ref?.number].filter(Boolean).join(' '), subtitle, date: d.ref?.issueDate ?? null, amount: d.ref?.total ?? null, folder: d.folder, docType: d.docType, linkedTo: to.id }
      }
      // Nóminas, extractos y modelos se reconocen mejor por su resumen que por un número de justificante
      const named = d.ref && !['other', 'payroll', 'bank_statement', 'tax_form'].includes(d.docType) && d.ref.number
      return { ...base, title: named ? `${docTypeLabel(d.docType)} ${d.ref!.number}` : d.summary ?? 'Documento', subtitle: [d.ref?.parties[0]?.name, `${d.quarter}T ${d.year} · ${d.folder}`].filter(Boolean).join(' · '), date: d.ref?.issueDate ?? null, amount: d.ref?.total ?? null, folder: d.folder, docType: d.docType, linkedTo: null }
    }),
  }
})
