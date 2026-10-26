/**
 * Señal de vida con «Siempre»: la app a la vista y en uso. Si deja de llegar (móvil en el bolsillo, otra
 * app, el ordenador sin tocar), el servidor bloquea la sesión por su cuenta. Con la sesión ya bloqueada
 * no llega aquí: el middleware responde 423
 */
export default defineEventHandler(async (event) => {
  const status = await requireLockStatus(event)
  if (status.bound && status.mode === 'always') await updateSessionLock(event, { seen: Date.now() })
  return { ok: true }
})
