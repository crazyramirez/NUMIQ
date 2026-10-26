import { eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  password: z.string().max(200),
  confirm: z.string().max(40),
})

/** Elimina la cuenta y todos sus datos. Pide la contraseña y escribir ELIMINAR: no se puede deshacer */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const input = await readInput(event, schema)
  rateLimit(`account-delete:${user.id}`, 5, 15 * 60_000)
  if (input.confirm.trim().toUpperCase() !== 'ELIMINAR') {
    throw createError({ statusCode: 400, statusMessage: 'Escribe ELIMINAR para confirmar', data: { field: 'confirm' } })
  }
  const [row] = await useDb().select({ passwordHash: tables.users.passwordHash }).from(tables.users).where(eq(tables.users.id, user.id))
  if (!row?.passwordHash || !input.password || !(await verifyPassword(row.passwordHash, input.password))) {
    throw createError({ statusCode: 400, statusMessage: 'La contraseña no es correcta', data: { field: 'password' } })
  }

  const plan = await deleteAccount(user.id)
  await clearUserSession(event)
  // Sin datos personales: la cuenta ya no existe
  await audit(event, { action: 'user.delete', data: { removed: plan.remove.length, left: plan.leave.length } })

  const names = (list: Array<{ name: string }>) => list.map(c => c.name).join(', ')
  try {
    await sendAccountEmail(user.email, {
      subject: 'Tu cuenta se ha eliminado · NUMIQ',
      title: `Hasta pronto, ${user.name.split(' ')[0]}`,
      lines: [
        'Hemos eliminado tu cuenta de NUMIQ y todos sus datos, como pediste.',
        ...(plan.remove.length ? [`Empresas borradas con todo su contenido: ${names(plan.remove)}.`] : []),
        ...(plan.leave.length ? [`Has salido de ${names(plan.leave)}, que siguen con su equipo.`] : []),
      ],
      footer: 'Si no lo has pedido tú, responde a este correo cuanto antes.',
    })
  }
  catch (err) {
    console.error('[cuenta] correo de cuenta eliminada', err)
  }
  return { ok: true }
})
