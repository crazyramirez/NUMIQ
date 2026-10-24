import { and, count, desc, eq, inArray, or } from 'drizzle-orm'

type Company = typeof tables.companies.$inferSelect

/**
 * Bandeja de entrada: todo lo que ha llegado y espera una decisión. Correos con facturas
 * adjuntas, importaciones leídas por la IA sin confirmar y gastos que la IA dejó por revisar.
 */
export async function inboxFeed(company: Company, user: { email: string }, role: string) {
  const db = useDb()
  const configured = mailEnabled()
  const whole = configured && canReadWholeInbox(user, role)
  const m = tables.mailMessages
  const b = tables.importBatches
  const e = tables.expenses

  const [messages, batches, [unreviewed]] = await Promise.all([
    configured
      ? db.select({
          id: m.id, fromName: m.fromName, fromAddress: m.fromAddress, subject: m.subject, date: m.date, attachments: m.attachments,
        }).from(m)
          .where(and(eq(m.companyId, company.id), eq(m.status, 'new'), whole ? undefined : or(eq(m.addressed, true))))
          .orderBy(desc(m.date)).limit(100)
      : [],
    db.select({ id: b.id, name: b.name, source: b.source, status: b.status, totalFiles: b.totalFiles, processedFiles: b.processedFiles, createdAt: b.createdAt })
      .from(b).where(and(eq(b.companyId, company.id), inArray(b.status, ['uploading', 'processing', 'review'])))
      .orderBy(desc(b.id)).limit(20),
    db.select({ n: count() }).from(e).where(and(eq(e.companyId, company.id), eq(e.reviewed, false))),
  ])

  const settings = company.settings as { mailSyncAt?: string } | null
  return {
    mail: {
      configured,
      wholeInbox: whole,
      lastSync: settings?.mailSyncAt ?? null,
      messages,
    },
    imports: batches.map(x => ({ ...x, running: isBatchRunning(x.id) })),
    unreviewedExpenses: Number(unreviewed?.n ?? 0),
  }
}

/** Cuántas cosas esperan en la bandeja (para el contador del menú y la tarea de «Hoy») */
export async function inboxCount(company: Company, user: { email: string }, role: string) {
  const db = useDb()
  const whole = mailEnabled() && canReadWholeInbox(user, role)
  const m = tables.mailMessages
  const [[mail], [imports], [expenses]] = await Promise.all([
    mailEnabled()
      ? db.select({ n: count() }).from(m).where(and(eq(m.companyId, company.id), eq(m.status, 'new'), whole ? undefined : or(eq(m.addressed, true))))
      : Promise.resolve([{ n: 0 }]),
    db.select({ n: count() }).from(tables.importBatches).where(and(eq(tables.importBatches.companyId, company.id), eq(tables.importBatches.status, 'review'))),
    db.select({ n: count() }).from(tables.expenses).where(and(eq(tables.expenses.companyId, company.id), eq(tables.expenses.reviewed, false))),
  ])
  const n = (x?: { n: number | string }) => Number(x?.n ?? 0)
  return { mail: n(mail), imports: n(imports), expenses: n(expenses), total: n(mail) + n(imports) + n(expenses) }
}
