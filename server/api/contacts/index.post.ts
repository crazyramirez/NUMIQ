import { eq } from 'drizzle-orm'
import { z } from 'zod'

const flagsSchema = z.object({
  /** Es otro contacto aunque se parezca a uno existente (no vale con el mismo NIF) */
  allowDuplicate: z.boolean().optional(),
  /** Ya existe: usar esa ficha, con este papel de cliente o proveedor y lo que le falte */
  useExisting: z.boolean().optional(),
})

/** Crea un cliente o proveedor sin duplicar: si ya existe, 409 con la ficha existente o se reutiliza */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const input = await readInput(event, contactInputSchema)
  const flags = await readInput(event, flagsSchema)
  const duplicate = await findContactDuplicate(company.id, input)
  if (duplicate && (duplicate.certain || !flags.allowDuplicate)) {
    if (!flags.useExisting) throw createError({ statusCode: 409, statusMessage: duplicate.label, data: { duplicate } })
    const roles = { ...(input.isClient ? { isClient: true } : {}), ...(input.isSupplier ? { isSupplier: true } : {}) }
    if (Object.keys(roles).length) await useDb().update(tables.contacts).set(roles).where(eq(tables.contacts.id, duplicate.id))
    await fillContactGaps(company.id, duplicate.id, input)
    await audit(event, { companyId: company.id, userId: user.id, action: 'contact.reuse', entity: 'contact', entityId: duplicate.id })
    return { id: duplicate.id, existing: true }
  }
  const [res] = await useDb().insert(tables.contacts).values({ ...input, companyId: company.id }).$returningId()
  await audit(event, { companyId: company.id, userId: user.id, action: 'contact.create', entity: 'contact', entityId: res!.id })
  return { id: res!.id, existing: false }
})
