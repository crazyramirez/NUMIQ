import { eq } from 'drizzle-orm'
import { z } from 'zod'

type Company = typeof tables.companies.$inferSelect

/** Plantillas de página de la empresa (condiciones generales, garantías…), en companies.settings.pageTemplates */
export function pageTemplatesOf(company: Pick<Company, 'settings'>): PageTemplate[] {
  const list = (company.settings as { pageTemplates?: unknown } | null)?.pageTemplates
  return Array.isArray(list) ? list as PageTemplate[] : []
}

export const pageTemplateInput = z.object({
  /** Con id: se sobrescribe esa plantilla */
  id: z.string().regex(/^[a-z0-9]{4,16}$/).optional(),
  name: z.string().trim().min(1, 'Ponle un nombre a la plantilla').max(80, 'Máximo 80 caracteres'),
  page: docPageSchema,
})

export async function savePageTemplates(company: Company, list: PageTemplate[]) {
  const settings = { ...(company.settings ?? {}), pageTemplates: list }
  await useDb().update(tables.companies).set({ settings }).where(eq(tables.companies.id, company.id))
  return list
}
