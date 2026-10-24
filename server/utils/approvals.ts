import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

type Company = typeof tables.companies.$inferSelect

/**
 * Aprobación de gastos del equipo (sociedades con empleados): lo que registra un miembro queda
 * pendiente hasta que un dueño o administrador lo aprueba. Pendientes y rechazados no cuentan en
 * impuestos, informes, libros ni «pendiente de pago» hasta su aprobación.
 */
export const approvalSettingsSchema = z.object({ enabled: z.boolean() })

export function approvalSettings(company: Pick<Company, 'settings'>) {
  return { enabled: !!(company.settings as { approvals?: { enabled?: boolean } } | null)?.approvals?.enabled }
}

/** Estado con el que nace un gasto según quién lo registra */
export function initialApproval(company: Pick<Company, 'settings'>, role: string): 'approved' | 'pending' {
  return approvalSettings(company).enabled && role === 'member' ? 'pending' : 'approved'
}

/** Condición para sumas fiscales: solo gastos aprobados */
export const approvedExpense = () => eq(tables.expenses.approval, 'approved')

/** Aprueba o rechaza gastos pendientes y avisa a quien los registró */
export async function decideExpenses(companyId: number, userId: number, ids: number[], decision: 'approve' | 'reject', reason?: string | null) {
  const db = useDb()
  const e = tables.expenses
  const rows = await db.select({ id: e.id, createdBy: e.createdBy, total: e.total, description: e.description, supplier: e.supplier })
    .from(e).where(and(eq(e.companyId, companyId), inArray(e.id, ids), inArray(e.approval, ['pending', 'rejected'])))
  if (!rows.length) return { done: 0 }
  await db.update(e).set(decision === 'approve'
    ? { approval: 'approved', approvedBy: userId, approvedAt: new Date(), rejectReason: null }
    : { approval: 'rejected', approvedBy: userId, approvedAt: new Date(), rejectReason: reason?.trim() || null })
    .where(and(eq(e.companyId, companyId), inArray(e.id, rows.map(r => r.id))))
  // Aviso a cada autor (agrupado: un aviso por persona)
  const byAuthor = new Map<number, typeof rows>()
  for (const r of rows) if (r.createdBy && r.createdBy !== userId) byAuthor.set(r.createdBy, [...(byAuthor.get(r.createdBy) ?? []), r])
  for (const [author, list] of byAuthor) {
    const one = list.length === 1 ? list[0]! : null
    const what = one ? `${one.supplier?.name ?? one.description ?? 'Gasto'} · ${eurText(one.total)}` : `${list.length} gastos`
    void sendPush([author], {
      title: decision === 'approve' ? `Aprobado: ${what}` : `Rechazado: ${what}`,
      body: decision === 'approve' ? 'Ya cuenta en la contabilidad.' : reason?.trim() || 'Revísalo y corrígelo.',
      url: one ? `/gastos?ver=${one.id}` : '/gastos?aprobacion=rejected',
      tag: `approval-${one?.id ?? 'batch'}`,
    }).catch(() => {})
  }
  return { done: rows.length }
}
