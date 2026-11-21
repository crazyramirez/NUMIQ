#!/usr/bin/env node
/**
 * Prueba de humo de NUMIQ de escritorio, sin Electron: arranca el MySQL embebido y el servidor
 * compilado (desktop/.server) en una carpeta temporal y recorre la API como lo haría la app:
 * registro, empresa con datos de ejemplo, todas las pantallas (GET), modelos de impuestos, PDF,
 * copia de seguridad, clonación y restauración, correo y contraseña sin correo.
 *
 *   node scripts/smoke.mjs                 → todo y borra la carpeta temporal
 *   node scripts/smoke.mjs --keep          → deja la base de datos y el servidor en marcha (Ctrl+C)
 *   node scripts/smoke.mjs --clone=x.zip   → además restaura una clonación (p. ej. de la web)
 *
 * Sale con código 1 si algo falla (lo usa el flujo de GitHub Actions en Windows, macOS y Linux).
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freePort, startDatabase } from '../src/database.mjs'
import { serverEnv } from '../src/server-env.mjs'

const DESKTOP = join(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = join(DESKTOP, '..')
const SERVER_DIR = join(DESKTOP, '.server')
const MYSQL_DIR = join(DESKTOP, 'vendor', 'mysql', `${process.platform}-${process.arch}`)
const keep = process.argv.includes('--keep')
const cloneArg = process.argv.find(a => a.startsWith('--clone='))?.slice(8)

if (!existsSync(join(SERVER_DIR, 'server', 'index.mjs'))) {
  console.error('Falta la compilación: npm run app')
  process.exit(1)
}

const dir = mkdtempSync(join(tmpdir(), 'numiq-smoke-'))
const dataDir = join(dir, 'data')
const config = { sessionPassword: randomBytes(32).toString('hex'), certSecret: randomBytes(32).toString('hex'), dbPassword: randomBytes(18).toString('base64url') }
const windowToken = randomBytes(32).toString('hex')

let failures = 0
const ok = (msg) => console.log(`  ✔ ${msg}`)
const bad = (msg) => {
  failures++
  console.log(`  ✘ ${msg}`)
}

console.log(`• Carpeta temporal: ${dir}`)
const t0 = Date.now()
const db = await startDatabase({ basedir: MYSQL_DIR, datadir: join(dataDir, 'mysql'), port: await freePort(0), password: config.dbPassword, logFile: join(dir, 'mysql.log'), onStatus: s => console.log(`  · ${s}`) })
ok(`MySQL en marcha en ${Date.now() - t0} ms (puerto ${db.port})`)
{
  // Lo que necesita la app del motor: expresiones regulares (ICU), JSON y utf8mb4
  const mysql = (await import('mysql2/promise')).default
  const c = await mysql.createConnection(db.url)
  try {
    const [[row]] = await c.query('SELECT REGEXP_REPLACE(\'ES12-34\', \'[^0-9]\', \'\') AS digits, \'Factura 7\' REGEXP \'[0-9]+\' AS hit, JSON_EXTRACT(\'{"a":1}\', \'$.a\') AS j, CHAR_LENGTH(\'ñ€😀\') AS len')
    row.digits === '1234' && Number(row.hit) === 1 && Number(row.j) === 1 && Number(row.len) === 3 ? ok('REGEXP (ICU), JSON y utf8mb4 en la base de datos') : bad(`Funciones SQL: ${JSON.stringify(row)}`)
  }
  catch (err) {
    bad(`Funciones SQL: ${err.message}`)
  }
  await c.end()
}

const port = await freePort(0)
const base = `http://127.0.0.1:${port}`
const serverOut = []
const server = spawn(process.execPath, [join(SERVER_DIR, 'server', 'index.mjs')], {
  cwd: dataDir,
  env: serverEnv({ port, dbUrl: db.url, dataDir, serverDir: SERVER_DIR, config, windowToken }),
  stdio: ['ignore', 'pipe', 'pipe'],
})
server.stdout.on('data', d => serverOut.push(d.toString()))
server.stderr.on('data', d => serverOut.push(d.toString()))

let cookie = ''
async function call(method, path, body, opts = {}) {
  const headers = { ...(cookie ? { cookie } : {}), ...(opts.headers ?? {}) }
  let payload
  if (body instanceof FormData) payload = body
  else if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(`${base}${path}`, { method, headers, body: payload, redirect: 'manual' })
  const set = res.headers.getSetCookie?.() ?? []
  for (const c of set) {
    const [pair] = c.split(';')
    if (pair.startsWith('numiq-session=')) cookie = pair
  }
  const type = res.headers.get('content-type') ?? ''
  const data = type.includes('json') ? await res.json().catch(() => null) : Buffer.from(await res.arrayBuffer())
  return { status: res.status, type, data }
}

async function finish() {
  server.kill()
  await new Promise(r => server.once('exit', r))
  await db.stop()
  if (!keep) rmSync(dir, { recursive: true, force: true })
}

try {
  // Arranque y migraciones: /api/me responde 401 (sin sesión) cuando la base de datos está lista
  const until = Date.now() + 180_000
  let ready = false
  while (Date.now() < until && !ready) {
    if (server.exitCode !== null) break
    const r = await fetch(`${base}/api/me`).catch(() => null)
    if (r && r.status < 500) ready = true
    else if (r?.status === 503) throw new Error(`Base de datos no lista: ${await r.text()}`)
    else await new Promise(res => setTimeout(res, 300))
  }
  if (!ready) throw new Error('El servidor no arrancó')
  ok(`Servidor y migraciones en ${Date.now() - t0} ms`)

  const home = await call('GET', '/')
  if (home.status === 200 && /desktop:true/.test(home.data.toString())) ok('La app se sirve en modo escritorio')
  else bad(`Página principal: ${home.status}`)

  const email = 'escritorio@numiq.test'
  let r = await call('POST', '/api/auth/register', { name: 'Prueba Escritorio', email, password: 'clave-de-prueba-1' })
  r.status === 200 && cookie ? ok('Registro y sesión') : bad(`Registro: ${r.status} ${JSON.stringify(r.data)}`)

  r = await call('POST', '/api/companies', { kind: 'autonomo', legalName: 'Estudio de Prueba', nif: '12345678Z', taxRegime: 'directa_simplificada', vatRegime: 'general', defaultIrpfRate: 15, defaultVatRate: 21, demo: true })
  r.status === 200 ? ok('Empresa con datos de ejemplo') : bad(`Empresa: ${r.status} ${JSON.stringify(r.data)}`)

  r = await call('GET', '/api/me')
  r.data?.company?.id && r.data.user.emailVerifiedAt ? ok('Cuenta local confirmada y empresa activa') : bad(`Me: ${JSON.stringify(r.data)}`)

  await sweep('ejemplo')

  r = await call('GET', '/api/backup')
  r.data?.canClone ? ok('Copia completa disponible (dueño del equipo)') : bad(`Backup: ${JSON.stringify(r.data)?.slice(0, 200)}`)
  r = await call('GET', '/api/backup/download')
  r.status === 200 && r.type.includes('zip') ? ok(`Copia de la empresa (${(r.data.length / 1024).toFixed(0)} KB)`) : bad(`Copia: ${r.status}`)
  const clone = await call('GET', '/api/backup/clone')
  clone.status === 200 && clone.type.includes('zip') ? ok(`Clonación completa (${(clone.data.length / 1024).toFixed(0)} KB)`) : bad(`Clonación: ${clone.status} ${clone.data?.toString?.().slice(0, 200)}`)
  if (clone.status === 200) await restore(clone.data, 'de la propia clonación')
  r = await call('GET', '/api/sales?kind=invoice&limit=5')
  r.status === 200 ? ok('Datos intactos tras restaurar') : bad(`Tras restaurar: ${r.status}`)

  // Correo: se guarda cifrado en settings.json y no se devuelve la contraseña
  r = await call('PUT', '/api/desktop/mail', { user: 'pruebas@numiq.test', password: 'abcd efgh ijkl mnop', smtpHost: '127.0.0.1', smtpPort: 9, fromName: 'Prueba' })
  r.status === 200 && r.data.configured && r.data.check?.ok === false ? ok('Cuenta de correo guardada (y la prueba de conexión avisa)') : bad(`Correo: ${r.status} ${JSON.stringify(r.data)}`)
  const settings = existsSync(join(dataDir, 'settings.json')) ? readFileSync(join(dataDir, 'settings.json'), 'utf8') : ''
  settings && !settings.includes('abcdefghijklmnop') ? ok('Contraseña del correo cifrada en disco') : bad('La contraseña del correo no se guardó cifrada')
  r = await call('GET', '/api/desktop/mail')
  r.data?.hasPassword && !JSON.stringify(r.data).includes('abcd') ? ok('La contraseña nunca vuelve a la ventana') : bad(`Mail GET: ${JSON.stringify(r.data)}`)
  r = await call('PUT', '/api/desktop/mail', { user: '' })
  r.data?.configured === false ? ok('Cuenta de correo quitada') : bad(`Quitar correo: ${JSON.stringify(r.data)}`)

  // ¿Olvidaste la contraseña? sin correo: solo con el secreto de la ventana
  cookie = ''
  r = await call('POST', '/api/desktop/reset', { email })
  r.status === 403 ? ok('Sin el secreto de la ventana no se puede cambiar la contraseña') : bad(`Reset sin secreto: ${r.status}`)
  await localLogin(email, 'otra-clave-2') ? ok('Contraseña nueva elegida sin correo y entrada con ella') : bad('Contraseña sin correo')

  // Datos de otra instalación (la web con MariaDB): se restauran y se recorre todo con ellos
  if (cloneArg) {
    await restore(readFileSync(cloneArg), `de ${cloneArg}`)
    const mysql = (await import('mysql2/promise')).default
    const c = await mysql.createConnection(db.url)
    const [[owner]] = await c.query('SELECT u.email FROM users u JOIN company_members m ON m.user_id = u.id AND m.role = \'owner\' ORDER BY u.id LIMIT 1')
    const [[counts]] = await c.query('SELECT (SELECT COUNT(*) FROM users) users, (SELECT COUNT(*) FROM companies) companies, (SELECT COUNT(*) FROM sales_documents) sales, (SELECT COUNT(*) FROM expenses) expenses')
    await c.end()
    ok(`Copia restaurada: ${counts.users} usuarios, ${counts.companies} empresas, ${counts.sales} documentos de venta, ${counts.expenses} gastos`)
    cookie = ''
    if (owner && await localLogin(owner.email, 'clave-restaurada-3')) {
      ok('Entrada en una cuenta restaurada')
      await sweep('restaurados')
    }
    else bad('No se pudo entrar en la cuenta restaurada')
  }
}
catch (err) {
  bad(err.stack || err.message)
}

async function restore(zip, label) {
  const form = new FormData()
  form.append('file', new Blob([zip], { type: 'application/zip' }), 'clon.zip')
  const res = await call('POST', '/api/backup/restore', form)
  res.status === 200 ? ok(`Restauración ${label}`) : bad(`Restauración ${label}: ${res.status} ${JSON.stringify(res.data)?.slice(0, 300)}`)
}

/** Contraseña nueva por la vía del escritorio (secreto de la ventana) y entrada con ella */
async function localLogin(address, password) {
  let res = await call('POST', '/api/desktop/reset', { email: address }, { headers: { 'x-numiq-desktop': windowToken } })
  if (!res.data?.token) return false
  res = await call('POST', '/api/auth/reset', { token: res.data.token, password })
  if (res.status !== 200) return false
  cookie = ''
  res = await call('POST', '/api/auth/login', { email: address, password })
  return res.status === 200
}

/** Todas las pantallas (GET), modelos de impuestos, informes y PDF con los datos que haya */
async function sweep(label) {
  // Cada GET sin parámetros de ruta de server/api (lista sacada del código)
  const apiDir = join(ROOT, 'server', 'api')
  if (existsSync(apiDir)) {
    const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
    const SKIP = /^\/api\/(public|_auth|passkeys|mail\/inbox|inbox|backup\/(clone|download)|verifactu|certificate|lock|ai\/status-key)/
    const routes = walk(apiDir)
      .filter(f => f.endsWith('.get.ts') && !relative(apiDir, f).includes('['))
      .map(f => `/api/${relative(apiDir, f).split(sep).join('/').replace(/(\/index)?\.get\.ts$/, '')}`)
      .filter(p => !SKIP.test(p))
    const broken = []
    for (const p of routes) {
      const res = await call('GET', p)
      if (res.status >= 500) broken.push(`${p} → ${res.status} ${JSON.stringify(res.data)?.slice(0, 200)}`)
    }
    broken.length ? bad(`[${label}] ${broken.length} de ${routes.length} pantallas fallan:\n      ${broken.join('\n      ')}`) : ok(`[${label}] ${routes.length} consultas de la API sin errores`)
  }

  // Modelos de impuestos del año en curso (y anuales del anterior)
  const year = new Date().getFullYear()
  const models = [...['303', '130', '111', '115'].flatMap(m => [1, 2, 3, 4].map(q => `model=${m}&year=${year}&quarter=${q}`)), ...['390', '190', '180', '347'].map(m => `model=${m}&year=${year - 1}`)]
  const taxFail = []
  for (const q of models) {
    const res = await call('GET', `/api/taxes/draft?${q}`)
    if (res.status !== 200) taxFail.push(`${q} → ${res.status} ${JSON.stringify(res.data)?.slice(0, 160)}`)
  }
  taxFail.length ? bad(`[${label}] Modelos:\n      ${taxFail.join('\n      ')}`) : ok(`[${label}] ${models.length} borradores de modelos de Hacienda`)

  const repFail = []
  for (const q of [`year=${year}`, `year=${year}&quarter=1`, `year=${year - 1}`]) {
    const res = await call('GET', `/api/reports/summary?${q}`)
    if (res.status !== 200) repFail.push(`${q} → ${res.status}`)
  }
  repFail.length ? bad(`[${label}] Informes: ${repFail.join(', ')}`) : ok(`[${label}] Informes`)

  const r = await call('GET', '/api/sales?kind=invoice&limit=5')
  const list = r.data?.items ?? r.data?.rows ?? r.data ?? []
  const pdfs = []
  for (const inv of list.slice(0, 3)) {
    const pdf = await call('GET', `/api/sales/${inv.id}/pdf`)
    if (pdf.status !== 200 || pdf.data.subarray?.(0, 4).toString() !== '%PDF') pdfs.push(`${inv.id} → ${pdf.status}`)
  }
  if (!list.length) bad(`[${label}] Sin facturas: ${JSON.stringify(r.data)?.slice(0, 200)}`)
  else pdfs.length ? bad(`[${label}] PDF: ${pdfs.join(', ')}`) : ok(`[${label}] PDF de ${Math.min(3, list.length)} facturas`)
}

const errors = serverOut.join('').split('\n').filter(l => /\[error\]|Error:|ER_/.test(l) && !/omitido/.test(l))
if (errors.length) console.log(`\n• Errores en el registro del servidor:\n  ${errors.slice(0, 30).join('\n  ')}`)
if (failures) console.log(`\n${failures} comprobación(es) fallida(s). Salida del servidor:\n${serverOut.join('').slice(-4000)}`)
else console.log(`\n✔ NUMIQ de escritorio funciona (${((Date.now() - t0) / 1000).toFixed(1)} s)`)

if (keep && !failures) {
  console.log(`\nEn marcha: ${base}  (Ctrl+C para parar)`)
  process.on('SIGINT', async () => {
    await finish()
    process.exit(0)
  })
}
else {
  await finish()
  process.exit(failures ? 1 : 0)
}
