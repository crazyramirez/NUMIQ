import { randomBytes } from 'node:crypto'

/** Empieza la conexión con Google Calendar: pantalla de permiso de Google (solo calendarios creados por NUMIQ) */
export default defineEventHandler(async (event) => {
  await requireCompany(event, 'advisor')
  const cfg = googleConfig()
  if (!cfg) return sendRedirect(event, '/calendario?conectar=error&motivo=google')
  const state = randomBytes(24).toString('base64url')
  const site = siteUrl(event)
  setCookie(event, 'numiq-gcal', state, { httpOnly: true, sameSite: 'lax', secure: site.startsWith('https://'), maxAge: 600, path: '/api/calendar/google' })
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: `${site}/api/calendar/google/callback`,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return sendRedirect(event, `https://accounts.google.com/o/oauth2/v2/auth?${q}`)
})
