import { eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = companyInputSchema.extend({
  /** Rellenar con datos de ejemplo para explorar la app */
  demo: z.boolean().default(false),
})

/** Alta de empresa (onboarding o añadir otra): queda como empresa activa */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { demo, ...input } = await readInput(event, schema)
  const db = useDb()

  const companyId = await db.transaction(async (tx) => {
    const [res] = await tx.insert(tables.companies).values(input).$returningId()
    const companyId = res!.id
    await tx.insert(tables.companyMembers).values({ companyId, userId: user.id, role: 'owner' })
    await seedCompanyDefaults(tx, companyId)
    await tx.update(tables.users).set({ currentCompanyId: companyId }).where(eq(tables.users.id, user.id))
    return companyId
  })

  if (demo) await seedDemoData(companyId, user.id)
  await audit(event, { companyId, userId: user.id, action: 'company.create', data: { demo } })
  return { id: companyId }
})
