import { z } from 'zod'

/** Añade un calendario externo: se lee al momento para comprobar que la dirección funciona */
const schema = z.object({
  name: z.string().trim().min(1, 'Ponle un nombre').max(80),
  url: z.string().trim().min(8, 'Pega la dirección del calendario').max(1000, 'La dirección es demasiado larga'),
  color: z.string().refine(isCalendarColor, 'Color no válido').default('sky'),
})

export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'advisor')
  const input = await readInput(event, schema)
  const url = normalizeFeedUrl(input.url)
  let events
  try {
    events = parseIcs(await fetchIcs(url), shiftDays(madridToday(), -190), shiftDays(madridToday(), 550))
  }
  catch (err) {
    const message = (err as Error).name === 'TimeoutError' ? 'El calendario tarda demasiado en responder' : (err as Error).message
    throw createError({ statusCode: 400, statusMessage: message || 'No se pudo leer ese calendario', data: { field: 'url' } })
  }
  const [res] = await useDb().insert(tables.calendarFeeds).values({
    companyId: company.id, userId: user.id, name: input.name, url, color: input.color, cache: events, lastSyncAt: new Date(),
  }).$returningId()
  return { id: res!.id, count: events.length }
})
