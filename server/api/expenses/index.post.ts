import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { company, user, role } = await requireCompany(event)
  const input = await readInput(event, expenseInputSchema)
  const id = await saveExpense(company.id, user.id, input)
  // Con la aprobación activada, lo que registra un miembro espera el visto bueno
  if (initialApproval(company, role) === 'pending') {
    const e = tables.expenses
    await useDb().update(e).set({ approval: 'pending' }).where(eq(e.id, id))
    const [row] = await useDb().select({ total: e.total, supplier: e.supplier, description: e.description }).from(e).where(eq(e.id, id))
    void notifyCompany(company.id, {
      title: `${user.name.split(' ')[0]} ha registrado un gasto`,
      body: `${row?.supplier?.name ?? row?.description ?? 'Gasto'} · ${eurText(row?.total ?? 0)}: apruébalo o recházalo`,
      url: '/gastos?aprobacion=pending&anio=todos',
      tag: 'approvals',
    })
  }
  await audit(event, { companyId: company.id, userId: user.id, action: 'expense.create', entity: 'expense', entityId: id })
  return { id }
})
