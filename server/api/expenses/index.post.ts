export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const input = await readInput(event, expenseInputSchema)
  const id = await saveExpense(company.id, user.id, input)
  await audit(event, { companyId: company.id, userId: user.id, action: 'expense.create', entity: 'expense', entityId: id })
  return { id }
})
