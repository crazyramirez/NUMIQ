import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { company, user, role } = await requireCompany(event)
  const id = idParam(event)
  const input = await readInput(event, expenseInputSchema)
  await saveExpense(company.id, user.id, input, id)
  // Un miembro que corrige un gasto rechazado lo vuelve a mandar a aprobar
  if (initialApproval(company, role) === 'pending') {
    await useDb().update(tables.expenses).set({ approval: 'pending', rejectReason: null })
      .where(and(eq(tables.expenses.id, id), eq(tables.expenses.companyId, company.id), eq(tables.expenses.approval, 'rejected')))
  }
  await audit(event, { companyId: company.id, userId: user.id, action: 'expense.update', entity: 'expense', entityId: id })
  return { id }
})
