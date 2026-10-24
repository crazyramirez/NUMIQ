/** Clave pública para suscribirse a los avisos */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  return { publicKey: vapidKeys().publicKey }
})
