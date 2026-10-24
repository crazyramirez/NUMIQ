/** Aviso de prueba a los dispositivos del usuario */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  rateLimit(`push-test:${user.id}`, 5, 10 * 60_000, 'Ya has enviado varias pruebas: espera un poco')
  const r = await sendPush([user.id], { title: 'NUMIQ', body: 'Así te avisaremos cuando un cliente abra tu factura o se acerque un plazo.', url: '/', tag: 'test' })
  if (!r.sent) throw createError({ statusCode: 404, statusMessage: 'No hay ningún dispositivo con los avisos activados' })
  return r
})
