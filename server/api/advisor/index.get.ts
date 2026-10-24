import { desc, eq } from 'drizzle-orm'

/** Datos del gestor y envíos anteriores */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const p = tables.advisorPacks
  const packs = await useDb().select({
    id: p.id, label: p.label, periodFrom: p.periodFrom, periodTo: p.periodTo, contents: p.contents, size: p.size,
    expiresAt: p.expiresAt, downloads: p.downloads, sentTo: p.sentTo, sentAt: p.sentAt, emailStatus: p.emailStatus, emailError: p.emailError, createdAt: p.createdAt, path: p.path,
  }).from(p).where(eq(p.companyId, company.id)).orderBy(desc(p.id)).limit(30)
  return {
    advisor: advisorOf(company),
    mail: mailEnabled(),
    packs: packs.map(({ path, ...x }) => ({ ...x, available: !!path })),
  }
})
