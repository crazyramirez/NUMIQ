import type { H3Event } from 'h3'
import { z } from 'zod'

/** Email recortado y en minúsculas antes de validar el formato */
export const emailField = (message = 'Email no válido') => z.string().trim().toLowerCase().pipe(z.email(message))

/** Email opcional: cadena vacía = null */
export const optionalEmailField = () => z.union([z.literal('').transform(() => null), emailField()]).nullish().transform(v => v ?? null)

/** Lee y valida el cuerpo; el primer error se devuelve en castellano, con el campo afectado */
export async function readInput<T extends z.ZodType>(event: H3Event, schema: T): Promise<z.infer<T>> {
  const result = schema.safeParse(await readBody(event).catch(() => ({})))
  if (!result.success) {
    const issue = result.error.issues[0]!
    throw createError({
      statusCode: 400,
      statusMessage: issue.message,
      data: { field: issue.path.join('.'), issues: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
    })
  }
  return result.data
}

export function readQueryInput<T extends z.ZodType>(event: H3Event, schema: T): z.infer<T> {
  const result = schema.safeParse(getQuery(event))
  if (!result.success) throw createError({ statusCode: 400, statusMessage: result.error.issues[0]!.message })
  return result.data
}
