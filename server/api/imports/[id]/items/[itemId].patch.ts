import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { ImportInvoiceData, ImportVaultData } from '../../../../../shared/types/import'

const schema = z.object({
  type: z.enum(['sales', 'expense', 'contact', 'item', 'vault']).optional(),
  /** Excluir o volver a comprobar antes de incluir. Los duplicados no se fuerzan. */
  include: z.boolean().optional(),
  contactId: z.number().int().positive().nullable().optional(),
  data: z.unknown().optional(),
  /** Documento que acompaña a una factura emitida del lote (null = no vincular: va al archivo) */
  link: z.object({ itemId: z.number().int().positive().nullable() }).optional(),
})

function parseData(type: string, data: unknown) {
  const s = type === 'sales' || type === 'expense' ? importInvoiceSchema : type === 'contact' ? importContactSchema : type === 'item' ? importCatalogSchema : importVaultSchema
  const r = s.safeParse(data)
  if (!r.success) {
    const issue = r.error.issues[0]!
    throw createError({ statusCode: 400, statusMessage: issue.message, data: { field: `data.${issue.path.join('.')}` } })
  }
  return r.data
}

const isInvoice = (t: string) => t === 'sales' || t === 'expense'

/** Corrige un registro antes de importarlo: datos, emitida/recibida, contacto o exclusión */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event)
  const id = idParam(event)
  const itemId = idParam(event, 'itemId')
  const input = await readInput(event, schema)
  const db = useDb()
  const [item] = await db.select().from(tables.importItems)
    .where(and(eq(tables.importItems.id, itemId), eq(tables.importItems.batchId, id), eq(tables.importItems.companyId, company.id)))
  if (!item) throw createError({ statusCode: 404, statusMessage: 'Registro no encontrado' })
  if (item.status === 'imported') throw createError({ statusCode: 409, statusMessage: 'Este registro ya está importado' })

  const type = input.type ?? item.type
  if (input.type && input.type !== item.type && !(isInvoice(input.type) && isInvoice(item.type)) && input.data === undefined) {
    throw createError({ statusCode: 400, statusMessage: 'Indica los datos del nuevo tipo' })
  }
  const parsed = input.data !== undefined ? parseData(type, input.data) : item.data
  let data = parsed && input.data !== undefined && isInvoice(type) ? reconcileInvoiceLines(parsed as ImportInvoiceData) : parsed
  if (data && isInvoice(type)) {
    const invoice = data as ImportInvoiceData
    if (invoice.dateFallback && invoice.dateFallback.date !== invoice.issueDate) invoice.dateFallback = null
  }
  if (!data) throw createError({ statusCode: 409, statusMessage: 'Este archivo ya se importó antes' })
  if (input.link && type !== 'vault') throw createError({ statusCode: 400, statusMessage: 'Solo un documento que no es factura se puede vincular a una' })
  if (input.link?.itemId) {
    const [target] = await db.select({ type: tables.importItems.type }).from(tables.importItems)
      .where(and(eq(tables.importItems.id, input.link.itemId), eq(tables.importItems.batchId, id), eq(tables.importItems.companyId, company.id)))
    if (target?.type !== 'sales') throw createError({ statusCode: 400, statusMessage: 'Elige una factura emitida de esta importación' })
  }
  if (type === 'vault' && item.type === 'vault') {
    // Lo leído del documento no se edita; el vínculo, solo si se indica (y entonces queda fijado a mano)
    const old = item.data as ImportVaultData
    const merged: ImportVaultData = {
      ...(data as ImportVaultData),
      ref: old.ref ?? null,
      link: input.link ? { itemId: input.link.itemId, reason: null, manual: true } : old.link ?? null,
    }
    data = merged
  }
  if (input.contactId) {
    const [c] = await db.select({ id: tables.contacts.id }).from(tables.contacts).where(and(eq(tables.contacts.id, input.contactId), eq(tables.contacts.companyId, company.id)))
    if (!c) throw createError({ statusCode: 400, statusMessage: 'Contacto no encontrado' })
  }

  let warnings = item.warnings ?? []
  let blocking = item.status === 'error'
  if (isInvoice(type) && data) {
    const inv = data as ImportInvoiceData
    if (input.data !== undefined || input.type !== undefined || input.link !== undefined) {
      ({ warnings, blocking } = invoiceWarnings(inv, type === 'sales' ? 'issued' : 'received'))
    }
    else {
      blocking = !inv.issueDate || !inv.taxLines?.length
    }
  }
  else if (input.data !== undefined || input.type !== undefined || input.link !== undefined) {
    warnings = []
    blocking = false
  }
  const include = input.include ?? item.status !== 'excluded'
  const duplicate = await checkImportDuplicate(company.id, type, data, item.fileId, id, itemId)
  const status = !include ? 'excluded' as const : duplicate ? 'duplicate' as const : blocking ? 'error' as const : warnings.length ? 'warning' as const : 'ready' as const

  await db.update(tables.importItems).set({
    type,
    data,
    status,
    duplicate,
    warnings,
    ...(input.contactId !== undefined ? { contactId: input.contactId } : {}),
    // Cambiar de emitida a recibida: el contacto emparejado deja de valer
    ...(input.type && input.type !== item.type && input.contactId === undefined ? { contactId: null } : {}),
  }).where(eq(tables.importItems.id, itemId))
  return { ok: true, status, warnings, duplicate }
})
