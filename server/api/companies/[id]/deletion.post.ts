import { eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  password: z.string().max(200),
  confirm: z.string().max(40),
})

/**
 * Elimina una empresa con todos sus datos y archivos. Solo el propietario, con su contraseña y
 * escribiendo ELIMINAR. Sus otras empresas y su cuenta siguen igual.
 */
export default defineEventHandler(async (event) => {
  const id = z.coerce.number().int().positive().parse(getRouterParam(event, 'id'))
  const { user, company } = await requireCompany(event, 'owner', id)
  const input = await readInput(event, schema)
  rateLimit(`company-delete:${user.id}`, 5, 15 * 60_000)
  if (input.confirm.trim().toUpperCase() !== 'ELIMINAR') {
    throw createError({ statusCode: 400, statusMessage: 'Escribe ELIMINAR para confirmar', data: { field: 'confirm' } })
  }
  const [row] = await useDb().select({ passwordHash: tables.users.passwordHash }).from(tables.users).where(eq(tables.users.id, user.id))
  if (!row?.passwordHash || !input.password || !(await verifyPassword(row.passwordHash, input.password))) {
    throw createError({ statusCode: 400, statusMessage: 'La contraseña no es correcta', data: { field: 'password' } })
  }

  const plan = await companyDeletionPlan(company, user.id)
  await deleteCompany(company.id)
  // Su registro de auditoría se ha ido con ella: este queda sin empresa
  await audit(event, { userId: user.id, action: 'company.delete', data: { id: company.id, name: plan.name, nif: company.nif, others: plan.others.length } })

  try {
    await sendAccountEmail(user.email, {
      subject: `${plan.name} se ha eliminado · NUMIQ`,
      title: 'Empresa eliminada',
      lines: [
        `Hemos eliminado ${plan.name} (${company.nif}) de NUMIQ con todas sus facturas, gastos, contactos, movimientos y documentos, como pediste.`,
        ...(plan.others.length ? [`Han perdido el acceso: ${plan.others.map(o => o.name).join(', ')}.`] : []),
        'Tu cuenta y tus otras empresas siguen igual.',
      ],
      footer: 'Si no lo has pedido tú, responde a este correo cuanto antes.',
    })
  }
  catch (err) {
    console.error('[empresa] correo de empresa eliminada', err)
  }

  const [me] = await useDb().select({ currentCompanyId: tables.users.currentCompanyId }).from(tables.users).where(eq(tables.users.id, user.id))
  return { ok: true, currentCompanyId: me?.currentCompanyId ?? null }
})
