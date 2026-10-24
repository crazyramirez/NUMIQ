import { and, desc, eq, or } from 'drizzle-orm'
import { z } from 'zod'

const query = z.object({ status: z.enum(['new', 'imported', 'ignored', 'all']).default('new') })

/** Bandeja de facturas por correo de la empresa */
export default defineEventHandler(async (event) => {
  const { company, user, role } = await requireCompany(event)
  const { status } = readQueryInput(event, query)
  const configured = mailEnabled()
  const whole = configured && canReadWholeInbox(user, role)
  const m = tables.mailMessages
  const rows = configured
    ? await useDb().select({
        id: m.id, fromName: m.fromName, fromAddress: m.fromAddress, subject: m.subject, date: m.date,
        attachments: m.attachments, addressed: m.addressed, status: m.status, batchId: m.batchId,
      }).from(m)
        .where(and(
          eq(m.companyId, company.id),
          status === 'all' ? undefined : eq(m.status, status),
          // Sin acceso al buzón entero solo se ve lo enviado al alias de la empresa
          whole ? undefined : or(eq(m.addressed, true)),
        ))
        .orderBy(desc(m.date)).limit(300)
    : []
  const settings = company.settings as { mailSyncAt?: string } | null
  return {
    configured,
    alias: configured ? companyAlias(company) : null,
    account: configured ? mailConfig().user.replace(/^(.{2}).*(@.*)$/, '$1•••$2') : null,
    wholeInbox: whole,
    lastSync: settings?.mailSyncAt ?? null,
    messages: rows,
  }
})
