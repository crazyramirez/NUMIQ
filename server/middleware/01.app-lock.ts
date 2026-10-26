/** Con NUMIQ bloqueada solo se puede entrar, salir, desbloquear y abrir los enlaces públicos */
const OPEN_PREFIXES = ['/api/_auth/', '/api/auth/', '/api/public/']
const OPEN = new Set(['/api/passkeys/authenticate', '/api/lock/unlock', '/api/lock/password'])

/** Sesión bloqueada (huella, Face ID o PIN pendiente): ningún dato sale del servidor hasta desbloquear */
export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0]!
  if (!path.startsWith('/api/') || OPEN.has(path) || OPEN_PREFIXES.some(p => path.startsWith(p))) return
  // Estado del bloqueo (la app lo pregunta al arrancar y al volver)
  if (path === '/api/lock' && event.method === 'POST') return
  if ((await lockStatus(event))?.locked) throw lockedError()
})
