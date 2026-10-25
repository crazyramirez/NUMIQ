import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

/** Qué se publica en la suscripción */
const schema = z.object({
  layers: z.array(z.enum(['income', 'expense', 'tax', 'quote', 'recurring', 'event', 'holiday'])).max(10),
})

export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'advisor')
  const { layers } = await readInput(event, schema)
  const link = await calendarLink(company.id, user.id)
  const unique = [...new Set(layers)]
  await useDb().update(tables.calendarLinks).set({ layers: unique }).where(and(eq(tables.calendarLinks.id, link.id), eq(tables.calendarLinks.userId, user.id)))
  return calendarLinkDto(event, { ...link, layers: unique }, company.tradeName || company.legalName)
})
