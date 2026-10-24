import type { H3Event } from 'h3'

/**
 * Llaves de acceso (WebAuthn). El origen que se verifica sale de la petición: detrás del proxy de
 * Plesk llega como http aunque el navegador esté en https. Si la URL pública (NUXT_SITE_URL) es del
 * mismo dominio, se toma su protocolo para que la firma del dispositivo cuadre.
 */
export function alignPasskeyOrigin(event: H3Event) {
  const site = String(useRuntimeConfig().siteUrl || '')
  if (!site) return
  try {
    const url = new URL(site)
    const host = String(getRequestHeader(event, 'host') ?? '').split(':')[0]
    if (host && host === url.hostname) event.node.req.headers['x-forwarded-proto'] = url.protocol.replace(':', '')
  }
  catch {
    // URL pública mal escrita: se usa la de la petición
  }
}

const CHALLENGE_TTL = 5 * 60_000

/** Reto de un intento de registro o acceso: un solo uso y 5 minutos de vida */
export async function storePasskeyChallenge(challenge: string, attemptId: string) {
  await useStorage().setItem(`webauthn:${attemptId}`, { challenge, at: Date.now() })
}

export async function takePasskeyChallenge(attemptId: string) {
  const key = `webauthn:${attemptId}`
  const item = await useStorage().getItem<{ challenge: string, at: number }>(key)
  await useStorage().removeItem(key)
  if (!item || Date.now() - item.at > CHALLENGE_TTL) throw createError({ statusCode: 400, statusMessage: 'El intento ha caducado: vuelve a probar' })
  return item.challenge
}

/** «iPhone», «Mac», «Android»… a partir del navegador, para reconocer cada llave en Ajustes */
export function deviceName(event: H3Event) {
  const ua = String(getRequestHeader(event, 'user-agent') ?? '')
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android'
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Linux/.test(ua)) return 'Linux'
  return 'Dispositivo'
}
