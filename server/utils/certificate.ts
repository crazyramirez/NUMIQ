import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'
import { createSecureContext } from 'node:tls'
import { desc, eq } from 'drizzle-orm'
import forge from 'node-forge'

/**
 * Certificado digital de la empresa (FNMT u otro prestador) para firmar los envíos a la AEAT.
 * Se guarda cifrado con AES-256-GCM; la clave sale de NUXT_CERT_SECRET (o de la de sesión).
 * Nunca se devuelve al navegador. Se conservan clave y certificado en PEM: así funcionan también
 * los .p12 antiguos con cifrado RC2 que OpenSSL 3 ya no abre.
 */

let _key: Buffer | undefined

function sealKey() {
  if (_key) return _key
  const c = useRuntimeConfig()
  const secret = String(c.certSecret || process.env.NUXT_CERT_SECRET || c.session?.password || '')
  if (secret.length < 32) throw createError({ statusCode: 503, statusMessage: 'Falta NUXT_CERT_SECRET (32+ caracteres) para custodiar certificados' })
  _key = scryptSync(secret, 'numiq-certificados-v1', 32)
  return _key
}

/** [versión 1][iv 12][tag 16][datos cifrados] */
export function sealSecret(data: Buffer) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', sealKey(), iv)
  const enc = Buffer.concat([cipher.update(data), cipher.final()])
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), enc])
}

export function openSecret(blob: Buffer) {
  if (blob[0] !== 1) throw new Error('Formato de custodia desconocido')
  const decipher = createDecipheriv('aes-256-gcm', sealKey(), blob.subarray(1, 13))
  decipher.setAuthTag(blob.subarray(13, 29))
  return Buffer.concat([decipher.update(blob.subarray(29)), decipher.final()])
}

export interface CertificateInfo {
  holderName: string
  holderNif: string | null
  representativeName: string | null
  representativeNif: string | null
  kind: 'persona' | 'representante' | 'sello' | 'otro'
  issuer: string | null
  serial: string
  fingerprint: string
  validFrom: Date
  validTo: Date
}

const attr = (c: forge.pki.Certificate, oid: string) => {
  const a = c.subject.attributes.find(x => x.type === oid)
  return a ? String(a.value) : null
}

/** "IDCES-12345678Z" / "VATES-B12345678" / "12345678Z" → NIF */
const nifFrom = (v: string | null) => {
  if (!v) return null
  const m = v.toUpperCase().match(/([A-Z]\d{7}[0-9A-J]|\d{8}[A-Z]|[XYZ]\d{7}[A-Z])$/)
  return m ? m[1]! : null
}

/** Datos del certificado y de su titular a partir del PKCS#12 */
function describe(cert: forge.pki.Certificate): CertificateInfo {
  const cn = attr(cert, '2.5.4.3') ?? ''
  const serialNumber = attr(cert, '2.5.4.5')
  const orgId = attr(cert, '2.5.4.97')
  const org = attr(cert, '2.5.4.10')
  const given = attr(cert, '2.5.4.42')
  const surname = attr(cert, '2.5.4.4')
  const personName = given || surname ? [given, surname].filter(Boolean).join(' ') : cn.replace(/\s*-\s*[A-Z0-9]{9}\s*$/i, '').replace(/^[A-Z0-9]{9}\s+/i, '').replace(/\s*\(R:.*\)$/, '').trim()
  const personNif = nifFrom(serialNumber) ?? nifFrom(cn.match(/\b([A-Z0-9]{9})\b/i)?.[1] ?? null)
  const entityNif = nifFrom(orgId) ?? nifFrom(cn.match(/\(R:\s*([A-Z0-9]{9})\)/i)?.[1] ?? null)
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()
  const base = {
    issuer: cert.issuer.attributes.find(x => x.type === '2.5.4.3')?.value?.toString() ?? cert.issuer.attributes.find(x => x.type === '2.5.4.10')?.value?.toString() ?? null,
    serial: cert.serialNumber.toUpperCase(),
    fingerprint: createHash('sha256').update(Buffer.from(der, 'binary')).digest('hex').toUpperCase().replace(/(..)(?!$)/g, '$1:'),
    validFrom: cert.validity.notBefore,
    validTo: cert.validity.notAfter,
  }
  if (entityNif && personNif) return { ...base, kind: 'representante', holderName: org || cn, holderNif: entityNif, representativeName: personName, representativeNif: personNif }
  if (entityNif) return { ...base, kind: 'sello', holderName: org || cn, holderNif: entityNif, representativeName: null, representativeNif: null }
  if (personNif) return { ...base, kind: 'persona', holderName: personName || cn, holderNif: personNif, representativeName: null, representativeNif: null }
  return { ...base, kind: 'otro', holderName: org || cn || 'Certificado', holderNif: null, representativeName: null, representativeNif: null }
}

/** Abre el .p12/.pfx: comprueba la contraseña y extrae clave, certificado y cadena */
export function readPkcs12(data: Buffer, password: string) {
  let p12: forge.pkcs12.Pkcs12Pfx
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(data.toString('binary'))), false, password)
  }
  catch (err) {
    const msg = (err as Error).message ?? ''
    if (/mac|password|invalid/i.test(msg)) throw createError({ statusCode: 400, statusMessage: 'La contraseña del certificado no es correcta' })
    throw createError({ statusCode: 415, statusMessage: 'El archivo no es un certificado .p12 o .pfx válido' })
  }
  // OID de las bolsas PKCS#12: clave cifrada, clave en claro y certificado
  const SHROUDED = '1.2.840.113549.1.12.10.1.2'
  const KEY = '1.2.840.113549.1.12.10.1.1'
  const CERT = '1.2.840.113549.1.12.10.1.3'
  const bags = (type: string): forge.pkcs12.Bag[] => p12.getBags({ bagType: type })[type] ?? []
  const key = [...bags(SHROUDED), ...bags(KEY)].find(b => b.key)?.key as forge.pki.rsa.PrivateKey | undefined
  if (!key) throw createError({ statusCode: 400, statusMessage: 'El archivo no contiene la clave privada: expórtalo "con clave privada"' })
  const certs = bags(CERT).map(b => b.cert).filter((c): c is forge.pki.Certificate => !!c)
  // El certificado del titular es el que corresponde a la clave privada
  const own = certs.find(c => (c.publicKey as forge.pki.rsa.PublicKey).n?.equals(key.n))
  if (!own) throw createError({ statusCode: 400, statusMessage: 'No se encontró el certificado que corresponde a la clave privada' })
  const chain = [own, ...certs.filter(c => c !== own)]
  const keyPem = forge.pki.privateKeyToPem(key)
  const certPem = chain.map(c => forge.pki.certificateToPem(c)).join('')
  // Node debe poder usarlo para la conexión TLS con la AEAT
  try {
    createSecureContext({ key: keyPem, cert: certPem })
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Este certificado no se puede usar para conectar con la AEAT' })
  }
  return { info: describe(own), keyPem, certPem }
}

/** Certificado vigente de la empresa (sin secretos) */
export async function currentCertificate(companyId: number) {
  const [cert] = await useDb().select().from(tables.certificates).where(eq(tables.certificates.companyId, companyId)).orderBy(desc(tables.certificates.id)).limit(1)
  return cert ?? null
}

/** Clave y certificado para la conexión TLS con la AEAT */
export async function certificateTls(companyId: number) {
  const cert = await currentCertificate(companyId)
  if (!cert) throw createError({ statusCode: 409, statusMessage: 'Sube tu certificado digital en Ajustes → Certificado digital' })
  if (cert.validTo < new Date()) throw createError({ statusCode: 409, statusMessage: 'Tu certificado digital ha caducado: sube uno vigente' })
  const { keyPem, certPem } = JSON.parse(openSecret(await readStoredFile(cert.path)).toString('utf8')) as { keyPem: string, certPem: string }
  return { key: keyPem, cert: certPem, info: cert }
}
