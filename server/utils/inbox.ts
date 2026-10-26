import { and, eq, inArray } from 'drizzle-orm'
import { ImapFlow } from 'imapflow'
import type { MessageStructureObject } from 'imapflow'
import type { MailAttachment } from '../db/schema'

/**
 * Facturas que llegan por correo (IMAP). Cada empresa tiene su dirección de recepción con alias de
 * Gmail (cuenta+lumbre1@gmail.com): ve solo lo que se envía ahí. El dueño del buzón puede además
 * buscar facturas en todo su correo.
 */

type Company = typeof tables.companies.$inferSelect

/** Alias de recepción de la empresa: misma cuenta, con +etiqueta */
export function companyAlias(company: Pick<Company, 'id' | 'tradeName' | 'legalName'>) {
  const user = mailConfig().user
  if (!user.includes('@')) return null
  const [local, domain] = user.split('@')
  const slug = (company.tradeName || company.legalName).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '').slice(0, 14)
  return `${local}+${slug || 'empresa'}${company.id}@${domain}`
}

/**
 * Quién puede ver el buzón entero: el titular de la cuenta de correo (mismo email de usuario)
 * o los usuarios indicados en NUXT_MAIL_INBOX_OWNERS, siempre como dueños o administradores y con el
 * email confirmado (si no, bastaría con registrarse con ese email).
 */
export function canReadWholeInbox(user: { email: string, emailVerifiedAt?: Date | string | null }, role: string) {
  if (role !== 'owner' && role !== 'admin') return false
  if (isServerAdmin(user)) return true
  const owners = String(useRuntimeConfig().mail.inboxOwners || process.env.NUXT_MAIL_INBOX_OWNERS || '')
    .split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
  return !!user.emailVerifiedAt && owners.includes(user.email.toLowerCase())
}

const IMPORTABLE = /^(application\/(pdf|xml|zip|x-zip-compressed|msword|vnd\.ms-excel|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|vnd\.oasis\.opendocument\.(text|spreadsheet)|octet-stream)|image\/(jpeg|png|webp)|text\/(xml|csv|plain))$/
const IMPORTABLE_EXT = /\.(pdf|xml|xsig|zip|docx?|xlsx?|od[ts]|csv|jpe?g|png|webp)$/i

/** Adjuntos que pueden ser facturas (sin logos de firmas ni imágenes en línea) */
function attachmentsOf(node: MessageStructureObject | undefined, out: MailAttachment[] = []) {
  if (!node) return out
  if (node.childNodes?.length) {
    for (const child of node.childNodes) attachmentsOf(child, out)
    return out
  }
  const filename = node.dispositionParameters?.filename ?? node.parameters?.name ?? ''
  const type = node.type.toLowerCase()
  if (!filename || !node.part) return out
  if (!IMPORTABLE.test(type) && !IMPORTABLE_EXT.test(filename)) return out
  if (type === 'application/octet-stream' && !IMPORTABLE_EXT.test(filename)) return out
  const size = node.size ?? 0
  // Imágenes pequeñas en línea: logos y firmas
  if (type.startsWith('image/') && (node.disposition !== 'attachment' || size < 12_000)) return out
  out.push({ part: node.part, filename: filename.slice(0, 200), size, mime: type })
  return out
}

async function withInbox<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const c = mailConfig()
  if (!c.user || !c.password) throw createError({ statusCode: 503, statusMessage: 'El correo no está configurado: añade GOOGLE_APP_EMAIL y GOOGLE_APP_PASSWORD' })
  const client = new ImapFlow({ host: c.imapHost, port: c.imapPort, secure: true, auth: { user: c.user, pass: c.password }, logger: false, connectionTimeout: 20_000 })
  client.on('error', err => console.error('[inbox]', err.message))
  try {
    await client.connect()
  }
  catch (err) {
    throw createError({ statusCode: 502, statusMessage: `No se pudo conectar al buzón: ${(err as Error).message}` })
  }
  const lock = await client.getMailboxLock('INBOX')
  try {
    return await fn(client)
  }
  finally {
    lock.release()
    await client.logout().catch(() => {})
  }
}

const addressList = (list?: Array<{ address?: string }>) => (list ?? []).map(a => (a.address ?? '').toLowerCase())

export interface SyncResult {
  scanned: number
  added: number
}

/** Busca correos con adjuntos de los últimos días y los guarda en la bandeja de la empresa */
export async function syncInbox(company: Company, wholeInbox: boolean, days = 120): Promise<SyncResult> {
  const alias = companyAlias(company)
  if (!alias) throw createError({ statusCode: 503, statusMessage: 'El correo no está configurado' })
  const db = useDb()
  const result = await withInbox(async (client) => {
    const gmail = client.capabilities.has('X-GM-EXT-1')
    const since = new Date(Date.now() - days * 86_400_000)
    const query = gmail
      ? { gmraw: wholeInbox ? `has:attachment newer_than:${days}d` : `(to:${alias} OR deliveredto:${alias}) newer_than:${days}d` }
      : { since, ...(wholeInbox ? {} : { to: alias }) }
    const found = await client.search(query, { uid: true })
    const uids = (Array.isArray(found) ? found : []).slice(-300)
    if (!uids.length) return { scanned: 0, rows: [] as Array<typeof tables.mailMessages.$inferInsert> }
    const uidValidity = String(client.mailbox && typeof client.mailbox === 'object' ? client.mailbox.uidValidity : '')
    const rows: Array<typeof tables.mailMessages.$inferInsert> = []
    for await (const msg of client.fetch(uids, { uid: true, envelope: true, bodyStructure: true, internalDate: true }, { uid: true })) {
      const attachments = attachmentsOf(msg.bodyStructure)
      if (!attachments.length) continue
      const env = msg.envelope
      const recipients = [...addressList(env?.to), ...addressList(env?.cc)]
      const from = env?.from?.[0]
      const date = env?.date ? new Date(env.date) : msg.internalDate ? new Date(msg.internalDate) : null
      rows.push({
        companyId: company.id,
        mailbox: 'INBOX',
        uidValidity,
        uid: msg.uid,
        messageId: (env?.messageId || `uid-${uidValidity}-${msg.uid}`).slice(0, 255),
        fromName: from?.name?.slice(0, 200) || null,
        fromAddress: from?.address?.slice(0, 191) || null,
        subject: env?.subject?.slice(0, 255) || null,
        date: date && !Number.isNaN(date.getTime()) ? date : null,
        attachments,
        addressed: recipients.includes(alias.toLowerCase()),
      })
    }
    return { scanned: uids.length, rows }
  })
  let added = 0
  for (const row of result.rows) {
    const r = await db.insert(tables.mailMessages).values(row)
      .onDuplicateKeyUpdate({ set: { uid: row.uid, uidValidity: row.uidValidity, addressed: row.addressed } })
    // affectedRows: 1 = nuevo, 2 = actualizado
    if (r[0].affectedRows === 1) added++
  }
  const settings = { ...(company.settings ?? {}), mailSyncAt: new Date().toISOString() }
  await db.update(tables.companies).set({ settings }).where(eq(tables.companies.id, company.id))
  return { scanned: result.scanned, added }
}

/** Descarga los adjuntos de los correos elegidos y los lee con IA en una importación */
export async function importMessages(company: Company, userId: number, ids: number[]) {
  const db = useDb()
  const messages = await db.select().from(tables.mailMessages)
    .where(and(eq(tables.mailMessages.companyId, company.id), inArray(tables.mailMessages.id, ids)))
  if (!messages.length) throw createError({ statusCode: 404, statusMessage: 'No se encontraron los correos' })
  const batchId = await createBatch(company.id, userId, {
    source: 'email',
    name: messages.length === 1 ? (messages[0]!.subject || 'Correo') : `${messages.length} correos`,
    direction: 'auto',
    options: { createItems: true, markPaid: false },
  })
  const skipped: Array<{ name: string, reason: string }> = []
  await withInbox(async (client) => {
    for (const m of messages) {
      const from = (m.fromName || m.fromAddress || 'remitente').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60)
      for (const a of m.attachments ?? []) {
        try {
          const dl = await client.download(String(m.uid), a.part, { uid: true })
          if (!dl || !('content' in dl) || !dl.content) throw new Error('no encontrado')
          const chunks: Buffer[] = []
          for await (const chunk of dl.content) chunks.push(Buffer.from(chunk as Uint8Array))
          const r = await addBatchFile(company.id, userId, batchId, { filename: a.filename, data: Buffer.concat(chunks), sourcePath: `Correo/${from}/${a.filename}` })
          skipped.push(...r.skipped)
        }
        catch (err) {
          skipped.push({ name: a.filename, reason: `No se pudo descargar (${(err as Error).message})` })
        }
      }
    }
  })
  await db.update(tables.mailMessages).set({ status: 'imported', batchId }).where(inArray(tables.mailMessages.id, messages.map(m => m.id)))
  const batch = await getBatch(company.id, batchId)
  if (batch.totalFiles) void startBatch(company.id, batchId)
  return { batchId, files: batch.totalFiles, skipped }
}
