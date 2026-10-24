export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const input = await readInput(event, itemInputSchema)
  await assertItemCategory(company.id, input.categoryId)
  const [res] = await useDb().insert(tables.items).values({ ...input, companyId: company.id }).$returningId()
  await audit(event, { companyId: company.id, userId: user.id, action: 'item.create', entity: 'item', entityId: res!.id })
  return { id: res!.id }
})
