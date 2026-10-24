import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { and, eq, inArray } from 'drizzle-orm'
import webpush from 'web-push'

/**
 * Avisos al móvil o al ordenador (Web Push). Las claves VAPID salen del .env si están
 * (NUXT_VAPID_PUBLIC_KEY / NUXT_VAPID_PRIVATE_KEY); si no, se crean una vez y se guardan junto a
 * las subidas, así funciona sin configurar nada.
 */
export interface PushPayload {
  title: string
  body?: string
  /** Pantalla que abre al tocar el aviso */
  url?: string
  /** Avisos con la misma etiqueta se sustituyen en lugar de amontonarse */
  tag?: string
}

let keys: { publicKey: string, privateKey: string } | null = null

export function vapidKeys() {
  if (keys) return keys
  const env = { publicKey: process.env.NUXT_VAPID_PUBLIC_KEY ?? '', privateKey: process.env.NUXT_VAPID_PRIVATE_KEY ?? '' }
  if (env.publicKey && env.privateKey) {
    keys = env
  }
  else {
    const file = resolve(uploadsRoot(), '..', 'vapid.json')
    if (existsSync(file)) {
      keys = JSON.parse(readFileSync(file, 'utf8'))
    }
    else {
      keys = webpush.generateVAPIDKeys()
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(keys), { mode: 0o600 })
    }
  }
  const contact = mailConfig().user.includes('@') ? `mailto:${mailConfig().user}` : 'mailto:avisos@numiq.app'
  webpush.setVapidDetails(contact, keys!.publicKey, keys!.privateKey)
  return keys!
}

/** Envía un aviso a todos los dispositivos de esos usuarios; borra las suscripciones caducadas */
export async function sendPush(userIds: number[], payload: PushPayload) {
  const ids = [...new Set(userIds)]
  if (!ids.length) return { sent: 0 }
  vapidKeys()
  const db = useDb()
  const subs = await db.select().from(tables.pushSubscriptions).where(inArray(tables.pushSubscriptions.userId, ids))
  let sent = 0
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 60 * 60 * 24 })
      sent++
      await db.update(tables.pushSubscriptions).set({ lastSentAt: new Date() }).where(eq(tables.pushSubscriptions.id, s.id))
    }
    catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      // 404/410: el navegador ya no tiene esta suscripción (permiso retirado, app desinstalada)
      if (status === 404 || status === 410) await db.delete(tables.pushSubscriptions).where(eq(tables.pushSubscriptions.id, s.id))
      else console.warn('[push]', status ?? (err as Error).message)
    }
  }))
  return { sent }
}

/** Aviso a los responsables de una empresa (dueños y administradores; opcionalmente a quien lo creó) */
export async function notifyCompany(companyId: number, payload: PushPayload, opts: { alsoUserId?: number | null } = {}) {
  try {
    const admins = await useDb().select({ userId: tables.companyMembers.userId }).from(tables.companyMembers)
      .where(and(eq(tables.companyMembers.companyId, companyId), inArray(tables.companyMembers.role, ['owner', 'admin'])))
    const ids = admins.map(a => a.userId)
    if (opts.alsoUserId) ids.push(opts.alsoUserId)
    return await sendPush(ids, payload)
  }
  catch (err) {
    // Un aviso que no sale nunca rompe lo que lo provocó
    console.warn('[push] empresa', companyId, (err as Error).message)
    return { sent: 0 }
  }
}
