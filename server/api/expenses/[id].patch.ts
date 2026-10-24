export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const input = await readInput(event, expenseInputSchema)
  await saveExpense(company.id, user.id, input, id)
  await audit(event, { companyId: company.id, userId: user.id, action: 'expense.update', entity: 'expense', entityId: id })
  return { id }
})
