export default defineEventHandler(async (event) => {
  if (!event.path.startsWith('/api/')) return
  // La sesión vive en una cookie cifrada: no necesita base de datos
  if (event.path.startsWith('/api/_auth/')) return
  try {
    await ensureDbReady()
  }
  catch (err) {
    throw createError({ statusCode: 503, statusMessage: `Base de datos no disponible: ${(err as Error).message}` })
  }
})
