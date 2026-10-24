/** ¿Está configurada la IA? Nunca devuelve la clave */
export default defineEventHandler(async (event) => {
  await requireCompany(event, 'advisor')
  return { configured: !!useRuntimeConfig(event).openaiApiKey }
})
