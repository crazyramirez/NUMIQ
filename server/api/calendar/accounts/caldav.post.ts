import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

/**
 * Conecta iCloud (Apple ID + contraseña de aplicación) u otro servidor CalDAV: busca la cuenta,
 * crea el calendario «NUMIQ · Empresa» y hace la primera sincronización.
 */
const schema = z.object({
  preset: z.enum(['icloud', 'caldav']),
  server: z.string().trim().max(500).nullish(),
  username: z.string().trim().min(1, 'Escribe tu usuario o Apple ID').max(200),
  password: z.string().min(1, 'Escribe la contraseña de aplicación').max(200),
  layers: z.array(z.enum(SYNC_LAYERS)).max(10).nullish(),
})

export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'advisor')
  const input = await readInput(event, schema)
  const server = input.preset === 'icloud' ? ICLOUD_CALDAV : (input.server ?? '')
  if (!server) throw createError({ statusCode: 400, statusMessage: 'Escribe la dirección del servidor CalDAV', data: { field: 'server' } })
  // iCloud da las contraseñas de aplicación con guiones; espacios pegados de más no cuentan
  const creds = { username: input.username, password: input.password.trim() }
  let found
  try {
    found = await caldavDiscover(server, creds, `NUMIQ · ${company.tradeName || company.legalName}`)
  }
  catch (err) {
    const e = err as Error
    const message = e.name === 'TimeoutError' ? 'El servidor tarda demasiado en responder' : e.message
    throw createError({ statusCode: 400, statusMessage: message || 'No se pudo conectar con ese calendario', data: { field: /contraseña/i.test(message) ? 'password' : 'server' } })
  }
  const db = useDb()
  const where = and(eq(tables.calendarAccounts.companyId, company.id), eq(tables.calendarAccounts.userId, user.id), eq(tables.calendarAccounts.provider, 'caldav'))
  const [old] = await db.select().from(tables.calendarAccounts).where(where)
  if (old) await disconnectAccount(old)
  await db.insert(tables.calendarAccounts).values({
    companyId: company.id,
    userId: user.id,
    provider: 'caldav',
    label: `${input.preset === 'icloud' ? 'iCloud' : new URL(found.calendarRef).hostname} · ${input.username}`,
    server,
    calendarRef: found.calendarRef,
    ownsCalendar: found.owns,
    secret: sealJson(creds),
    layers: input.layers?.length ? [...new Set(input.layers)] : [...DEFAULT_SYNC_LAYERS],
  })
  const [account] = await db.select().from(tables.calendarAccounts).where(where)
  await audit(event, { companyId: company.id, userId: user.id, action: 'calendar.connect', entity: 'calendar_account', entityId: account!.id, data: { provider: 'caldav', preset: input.preset } })
  const result = await syncAccount(account!.id)
  const [fresh] = await db.select().from(tables.calendarAccounts).where(where)
  return { account: accountDto(fresh!), result }
})
