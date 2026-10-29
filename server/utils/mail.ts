import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import type Mail from 'nodemailer/lib/mailer'

/**
 * Correo de la app. Gmail: verificación en 2 pasos + contraseña de aplicación
 * (https://myaccount.google.com/apppasswords) en GOOGLE_APP_EMAIL y GOOGLE_APP_PASSWORD.
 * La misma cuenta sirve para recibir por IMAP (bandeja de facturas por email).
 */
export function mailConfig() {
  const c = useRuntimeConfig().mail
  const e = process.env
  const user = c.user || e.GOOGLE_APP_EMAIL || ''
  return {
    smtpHost: c.smtpHost,
    smtpPort: Number(c.smtpPort),
    imapHost: c.imapHost,
    imapPort: Number(c.imapPort),
    user,
    // Google muestra la contraseña de aplicación en grupos de 4 con espacios
    password: (c.password || e.GOOGLE_APP_PASSWORD || '').replace(/\s/g, ''),
    from: c.from || (user ? `NUMIQ <${user}>` : ''),
  }
}

export const mailEnabled = () => {
  const c = mailConfig()
  return !!(c.user && c.password)
}

let _transport: { key: string, transport: Transporter } | undefined

function transport() {
  const c = mailConfig()
  const key = `${c.smtpHost}:${c.smtpPort}:${c.user}:${c.password}`
  if (_transport?.key !== key) {
    _transport = {
      key,
      transport: nodemailer.createTransport({
        host: c.smtpHost,
        port: c.smtpPort,
        secure: c.smtpPort === 465,
        auth: { user: c.user, pass: c.password },
      }),
    }
  }
  return _transport.transport
}

export interface OutgoingMail {
  to: string
  cc?: string
  subject: string
  text: string
  html: string
  /** Nombre que ve el cliente como remitente (la empresa) */
  fromName?: string
  replyTo?: string
  attachments?: Mail.Attachment[]
}

/** Dominios reservados (RFC 2606): direcciones de prueba que nunca se entregan */
export const isTestAddress = (email: string) => /@(example\.(com|org|net)|[^@]+\.(test|invalid|localhost|example))$/i.test(email.trim())

/**
 * Modo pruebas: con NUXT_MAIL_ONLY_TO (emails o @dominios separados por comas) solo salen los correos
 * dirigidos a esas direcciones; el resto se omite. Evita escribir a clientes reales con datos de demo.
 */
function allowedRecipient(email: string) {
  if (isTestAddress(email)) return false
  const only = (process.env.NUXT_MAIL_ONLY_TO ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (!only.length) return true
  const e = email.trim().toLowerCase()
  return only.some(o => (o.startsWith('@') ? e.endsWith(o) : e === o))
}

export async function sendMail(m: OutgoingMail) {
  const c = mailConfig()
  if (!c.user || !c.password) throw createError({ statusCode: 503, statusMessage: 'El envío de correo no está configurado (GOOGLE_APP_EMAIL y GOOGLE_APP_PASSWORD)' })
  const split = (s?: string) => (s ?? '').split(',').map(x => x.trim()).filter(Boolean)
  const to = split(m.to).filter(allowedRecipient)
  const cc = split(m.cc).filter(allowedRecipient)
  if (!to.length) {
    console.info(`[correo] "${m.subject}" a ${m.to} omitido (dirección de pruebas o fuera de NUXT_MAIL_ONLY_TO)`)
    return { messageId: null, skipped: true }
  }
  m = { ...m, to: to.join(', '), cc: cc.length ? cc.join(', ') : undefined }
  const from = m.fromName ? `${m.fromName.replace(/["<>]/g, '')} <${c.user}>` : c.from
  return transport().sendMail({ from, to: m.to, cc: m.cc, replyTo: m.replyTo, subject: m.subject, text: m.text, html: m.html, attachments: m.attachments })
}

/** Comprueba usuario y contraseña contra el servidor SMTP sin enviar nada */
export async function verifyMail() {
  if (!mailEnabled()) return { ok: false, error: 'Sin configurar' }
  try {
    await transport().verify()
    return { ok: true }
  }
  catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`)

/** Firma al pie del correo: texto de varias líneas e imagen opcional (va como adjunto en línea, CID) */
export interface MailSignature {
  text: string
  image: { content: Buffer, mime: string, filename: string, width: number, height: number } | null
  /** Imagen a la izquierda del texto (si no, debajo) */
  imageLeft: boolean
}

export const SIGNATURE_CID = 'firma@numiq'

/** Adjunto en línea de la imagen de la firma, para añadirlo al correo */
export const signatureAttachment = (s: MailSignature | null | undefined): Mail.Attachment[] =>
  s?.image ? [{ filename: s.image.filename, content: s.image.content, contentType: s.image.mime, cid: SIGNATURE_CID, contentDisposition: 'inline' }] : []

/** Enlaza webs, emails y teléfonos de la firma (texto ya escapado) */
function linkify(html: string, accent: string) {
  const a = (href: string, label: string) => `<a href="${href}" style="color:${accent};text-decoration:none">${label}</a>`
  return html
    .replace(/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, m => a(`mailto:${m}`, m))
    .replace(/(^|[\s(])((https?:\/\/|www\.)[^\s<]+[^\s<.,;)])/g, (_, pre: string, url: string) => `${pre}${a(url.startsWith('http') ? url : `https://${url}`, url)}`)
    .replace(/(^|[\s:])(\+?\d[\d ]{7,}\d)(?=$|[\s<])/gm, (_, pre: string, tel: string) => `${pre}${a(`tel:${tel.replace(/\s/g, '')}`, tel)}`)
}

function signatureHtml(s: MailSignature, accent: string) {
  const text = s.text
    ? `<p style="margin:0;font-size:14px;line-height:1.55;color:#3f4654">${linkify(escapeHtml(s.text), accent).replace(/\n/g, '<br>')}</p>`
    : ''
  const img = s.image
    ? `<img src="cid:${SIGNATURE_CID}" width="${s.image.width}" height="${s.image.height}" alt="" style="display:block;border:0;width:${s.image.width}px;height:${s.image.height}px">`
    : ''
  if (img && text && s.imageLeft) {
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 0"><tr><td valign="middle" style="padding-right:16px">${img}</td><td valign="middle" style="padding-left:16px;border-left:2px solid ${accent}">${text}</td></tr></table>`
  }
  return `<div style="margin:28px 0 0">${text}${img ? `<div style="margin-top:${text ? 14 : 0}px">${img}</div>` : ''}</div>`
}

/** Plantilla sobria y compatible con clientes de correo (tablas e estilos en línea) */
export function mailLayout(o: { brand: string, accent?: string | null, title: string, lines: string[], details?: Array<[string, string]>, action?: { label: string, url: string } | null, signature?: MailSignature | null, footer: string }) {
  const accent = o.accent || '#4f46e5'
  const details = o.details ?? []
  const text = [o.title, '', ...o.lines, ...(details.length ? ['', ...details.map(([k, v]) => `${k}: ${v}`)] : []), ...(o.action ? ['', `${o.action.label}: ${o.action.url}`] : []), ...(o.signature?.text ? ['', '--', o.signature.text] : []), '', o.footer].join('\n')
  const pad = (i: number) => `${i ? 4 : 14}px 16px ${i === details.length - 1 ? 14 : 4}px`
  const detailsHtml = details.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 4px;background:#f6f7f9;border-radius:10px">${details.map(([k, v], i) => `<tr><td style="padding:${pad(i)};font-size:13px;color:#6b7280">${escapeHtml(k)}</td><td align="right" style="padding:${pad(i)};font-size:14px;font-weight:600;color:#11141b">${escapeHtml(v)}</td></tr>`).join('')}</table>`
    : ''
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f5f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#11141b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;border:1px solid #e5e7ec;border-top:4px solid ${accent}">
<tr><td style="padding:32px">
<p style="margin:0 0 24px;font-size:15px;font-weight:700;letter-spacing:.02em;color:${accent}">${escapeHtml(o.brand)}</p>
<h1 style="margin:0 0 16px;font-size:21px;line-height:1.3">${escapeHtml(o.title)}</h1>
${o.lines.map(l => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#3f4654">${escapeHtml(l).replace(/\n/g, '<br>')}</p>`).join('\n')}
${detailsHtml}
${o.action ? `<p style="margin:24px 0"><a href="${escapeHtml(o.action.url)}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:9px">${escapeHtml(o.action.label)}</a></p>` : ''}
${o.signature ? signatureHtml(o.signature, accent) : ''}
<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #eef0f3;font-size:12px;color:#8a919e">${escapeHtml(o.footer)}</p>
</td></tr></table></td></tr></table></body></html>`
  return { text, html }
}
