import { eq } from 'drizzle-orm'

/** Usuario, sus empresas y la activa: lo que necesita la app al arrancar */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const companies = await useDb()
    .select({
      id: tables.companies.id,
      legalName: tables.companies.legalName,
      tradeName: tables.companies.tradeName,
      nif: tables.companies.nif,
      kind: tables.companies.kind,
      logoPath: tables.companies.logoPath,
      brandColor: tables.companies.brandColor,
      verifactuEnabled: tables.companies.verifactuEnabled,
      role: tables.companyMembers.role,
      settings: tables.companies.settings,
    })
    .from(tables.companyMembers)
    .innerJoin(tables.companies, eq(tables.companies.id, tables.companyMembers.companyId))
    .where(eq(tables.companyMembers.userId, user.id))
    .orderBy(tables.companies.legalName)

  // Los ajustes no salen; solo lo que el gestor puede subir a cada empresa
  const list = companies.map(({ settings, ...c }) => ({ ...c, advisorAccess: c.role === 'advisor' ? advisorAccess({ settings }) : null }))
  const current = list.find(c => c.id === user.currentCompanyId) ?? null
  return { user, companies: list, company: current }
})
