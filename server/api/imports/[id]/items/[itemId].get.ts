import { and, eq, inArray } from 'drizzle-orm'
import type { ImportInvoiceData, ImportVaultData } from '../../../../../shared/types/import'

/** Un registro completo para revisarlo junto al documento original */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const id = idParam(event)
  const itemId = idParam(event, 'itemId')
  const db = useDb()
  const [item] = await db.select().from(tables.importItems)
    .where(and(eq(tables.importItems.id, itemId), eq(tables.importItems.batchId, id), eq(tables.importItems.companyId, company.id)))
  if (!item) throw createError({ statusCode: 404, statusMessage: 'Registro no encontrado' })
  if (item.status === 'error' && (item.type === 'sales' || item.type === 'expense') && item.data) {
    const inv = item.data as ImportInvoiceData
    if (inv.issueDate && inv.taxLines?.length && (item.warnings ?? []).some(w => w.includes('Los NIF de ambas partes son distintos'))) {
      item.status = 'warning'
      await db.update(tables.importItems).set({ status: 'warning' }).where(eq(tables.importItems.id, item.id))
    }
  }
  const [file] = item.fileId
    ? await db.select({ id: tables.files.id, name: tables.files.originalName, path: tables.files.sourcePath, mime: tables.files.mime, size: tables.files.size }).from(tables.files).where(eq(tables.files.id, item.fileId))
    : []
  const [contact] = item.contactId
    ? await db.select({ id: tables.contacts.id, name: tables.contacts.name, nif: tables.contacts.nif }).from(tables.contacts).where(eq(tables.contacts.id, item.contactId))
    : []

  // Facturas emitidas del lote a las que se puede vincular un pedido o albarán, y lo ya vinculado a una factura
  const vault = item.type === 'vault' && item.data && isLinkableDoc(item.data as ImportVaultData)
  const others = vault || item.type === 'sales'
    ? await db.select({ id: tables.importItems.id, type: tables.importItems.type, status: tables.importItems.status, data: tables.importItems.data, fileId: tables.importItems.fileId })
        .from(tables.importItems).where(and(eq(tables.importItems.batchId, id), inArray(tables.importItems.type, vault ? ['sales'] : ['vault', 'sales'])))
    : []
  const isQuote = (d: ImportInvoiceData) => d.docType === 'quote' || d.docType === 'proforma'
  const linkOptions = vault
    ? others.filter(o => o.data && o.status !== 'excluded' && !isQuote(o.data as ImportInvoiceData)).map((o) => {
        const d = o.data as ImportInvoiceData
        return { id: o.id, label: [d.number ?? 'Sin número', d.party?.name, d.total != null ? eurText(d.total) : null].filter(Boolean).join(' · ') }
      })
    : []
  // Lo que va con esta factura: pedidos, albaranes… (se adjuntan) y su presupuesto emitido (queda facturado)
  const linked = item.type === 'sales'
    ? others.filter(o => o.id !== item.id && o.status !== 'excluded' && (o.data as ImportVaultData | ImportInvoiceData | null)?.link?.itemId === item.id).map((o) => {
        const d = o.data as ImportVaultData | ImportInvoiceData
        const number = o.type === 'sales' ? (d as ImportInvoiceData).number : (d as ImportVaultData).ref?.number
        return { id: o.id, title: [docTypeLabel(d.docType), number].filter(Boolean).join(' '), reason: d.link?.reason ?? (d.link?.manual ? 'Vinculado a mano' : null), sameFile: !!o.fileId && o.fileId === item.fileId }
      })
    : []
  return { ...item, file: file ?? null, contact: contact ?? null, linkable: !!vault, linkOptions, linked }
})
