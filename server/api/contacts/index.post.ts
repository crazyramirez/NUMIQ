export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const input = await readInput(event, contactInputSchema)
  const [res] = await useDb().insert(tables.contacts).values({ ...input, companyId: company.id }).$returningId()
  await audit(event, { companyId: company.id, userId: user.id, action: 'contact.create', entity: 'contact', entityId: res!.id })
  return { id: res!.id }
})
