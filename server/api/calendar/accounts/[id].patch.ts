import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

/** Qué se escribe en el calendario conectado, o pausar */
const schema = z.object({
  layers: z.array(z.enum(SYNC_LAYERS)).max(10).optional(),
  active: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'advisor')
  const input = await readInput(event, schema)
  const where = and(eq(tables.calendarAccounts.id, idParam(event)), eq(tables.calendarAccounts.companyId, company.id), eq(tables.calendarAccounts.userId, user.id))
  const db = useDb()
  const [account] = await db.select().from(tables.calendarAccounts).where(where)
  if (!account) throw createError({ statusCode: 404, statusMessage: 'Calendario no encontrado' })
  const set: Partial<typeof account> = {}
  if (input.layers) set.layers = [...new Set(input.layers)]
  if (input.active !== undefined) set.active = input.active
  if (Object.keys(set).length) await db.update(tables.calendarAccounts).set(set).where(where)
  // Lo que se quitó desaparece y lo que se añadió aparece ya
  const result = (input.active ?? account.active) ? await syncAccount(account.id) : null
  const [fresh] = await db.select().from(tables.calendarAccounts).where(where)
  return { account: accountDto(fresh!), result }
})
