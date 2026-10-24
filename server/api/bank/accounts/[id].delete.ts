import { and, eq } from 'drizzle-orm'

/** Quita una cuenta y sus movimientos importados. Los cobros y pagos registrados se conservan. */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  const id = idParam(event)
  const db = useDb()
  const a = tables.bankAccounts
  const [account] = await db.select().from(a).where(and(eq(a.id, id), eq(a.companyId, company.id)))
  if (!account) throw createError({ statusCode: 404, statusMessage: 'Cuenta no encontrada' })
  await db.delete(tables.bankTransactions).where(and(eq(tables.bankTransactions.accountId, id), eq(tables.bankTransactions.companyId, company.id)))
  await db.update(tables.payments).set({ bankAccountId: null }).where(and(eq(tables.payments.bankAccountId, id), eq(tables.payments.companyId, company.id)))
  await db.delete(a).where(eq(a.id, id))
  await audit(event, { companyId: company.id, userId: user.id, action: 'bank.account.delete', entity: 'bank_account', entityId: id, data: { name: account.name } })
  return { ok: true }
})
