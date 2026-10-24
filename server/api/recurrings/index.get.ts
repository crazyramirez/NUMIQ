import { desc, eq, inArray } from 'drizzle-orm'

/** Recurrentes de la empresa con su importe, próximas fechas y último documento generado */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const db = useDb()
  const rows = await db.select().from(tables.recurrings).where(eq(tables.recurrings.companyId, company.id)).orderBy(desc(tables.recurrings.active), tables.recurrings.nextDate)
  const contactIds = [...new Set(rows.map(r => r.template?.contactId).filter((x): x is number => !!x))]
  const categoryIds = [...new Set(rows.map(r => r.template?.categoryId).filter((x): x is number => !!x))]
  const [contacts, categories, docs] = await Promise.all([
    contactIds.length ? db.select({ id: tables.contacts.id, name: tables.contacts.name, email: tables.contacts.email }).from(tables.contacts).where(inArray(tables.contacts.id, contactIds)) : [],
    categoryIds.length ? db.select({ id: tables.categories.id, name: tables.categories.name, icon: tables.categories.icon, color: tables.categories.color }).from(tables.categories).where(inArray(tables.categories.id, categoryIds)) : [],
    lastGenerated(company.id, rows.map(r => r.id)),
  ])
  const contactById = new Map(contacts.map(c => [c.id, c]))
  const categoryById = new Map(categories.map(c => [c.id, c]))
  return rows.map((r) => {
    const t = templateOf(r)
    const last = docs.get(r.id) ?? null
    return {
      id: r.id,
      kind: r.kind,
      name: r.name,
      frequency: r.frequency,
      interval: r.interval,
      startDate: r.startDate ?? r.nextDate,
      nextDate: r.nextDate,
      endDate: r.endDate,
      autoIssue: r.autoIssue,
      autoSend: r.autoSend,
      active: r.active,
      status: recurringStatus(r),
      lastRunAt: r.lastRunAt,
      runCount: r.runCount,
      lastError: r.lastError,
      base: t.base ?? 0,
      total: t.total ?? 0,
      contact: t.contactId ? contactById.get(t.contactId) ?? null : null,
      category: t.categoryId ? categoryById.get(t.categoryId) ?? null : null,
      paid: !!t.paid,
      lastDocument: last,
    }
  })
})
