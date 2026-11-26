import { and, desc, eq, isNotNull, isNull, ne } from 'drizzle-orm'

/**
 * Correos que se sugieren al escribir un destinatario: los de los contactos y los que ya se han usado
 * al enviar (Para y CC), con el nombre del contacto si se conoce. Los más usados primero.
 */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const db = useDb()
  const c = tables.contacts
  const s = tables.sentEmails

  const [contacts, sent] = await Promise.all([
    db.select({ name: c.name, tradeName: c.tradeName, email: c.email }).from(c)
      .where(and(eq(c.companyId, company.id), isNull(c.archivedAt), isNotNull(c.email), ne(c.email, '')))
      .limit(5000),
    db.select({ to: s.to, cc: s.cc }).from(s)
      .where(and(eq(s.companyId, company.id), eq(s.status, 'sent')))
      .orderBy(desc(s.createdAt))
      .limit(500),
  ])

  const by = new Map<string, { email: string, name: string | null, uses: number }>()
  const add = (raw: string, name: string | null, uses: number) => {
    const email = raw.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return
    const r = by.get(email)
    if (r) {
      r.uses += uses
      r.name ??= name
    }
    else by.set(email, { email, name, uses })
  }
  for (const r of contacts) {
    for (const e of (r.email ?? '').split(/[,;\s]+/)) add(e, r.tradeName || r.name, 0)
  }
  for (const r of sent) {
    for (const e of `${r.to},${r.cc ?? ''}`.split(/[,;\s]+/)) if (e) add(e, null, 1)
  }

  return [...by.values()].sort((a, b) => b.uses - a.uses || (a.name ?? a.email).localeCompare(b.name ?? b.email, 'es'))
})
