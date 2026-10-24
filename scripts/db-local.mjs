#!/usr/bin/env node
/**
 * MySQL local para desarrollo: MariaDB portable dentro del proyecto (sin MAMP ni instalaciones).
 *
 *   npm run dev        → lo arranca en segundo plano si no está en marcha y luego Nuxt
 *   npm run db:local   → lo arranca en primer plano (Ctrl+C para parar)
 *   npm run db:stop    → lo detiene
 *
 * Binarios en .data/mariadb y datos en .data/mysql (fuera de git).
 * Solo escucha en 127.0.0.1:3308, usuario root sin contraseña (solo accesible desde tu PC).
 * En producción (Plesk) no se usa: allí NUXT_DATABASE_URL apunta al MySQL del servidor.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, openSync, readdirSync, rmSync } from 'node:fs'
import net from 'node:net'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const ROOT = process.cwd()
const DIR = join(ROOT, '.data')
const BIN_DIR = join(DIR, 'mariadb')
const DATA = join(DIR, 'mysql')
const PORT = 3308
const SERIES = '11.4'
const win = process.platform === 'win32'
const args = new Set(process.argv.slice(2))

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1')
    s.once('connect', () => {
      s.destroy()
      resolve(true)
    })
    s.once('error', () => resolve(false))
  })
}

function findFile(dir, name) {
  if (!existsSync(dir)) return null
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      const f = findFile(p, name)
      if (f) return f
    }
    else if (e.name === name) return p
  }
  return null
}

const exe = name => findFile(BIN_DIR, win ? `${name}.exe` : name)

/** ¿La app está configurada para usar este MySQL local? */
function usesLocalDb() {
  try {
    process.loadEnvFile(join(ROOT, '.env'))
  }
  catch {
    // sin .env
  }
  const host = process.env.NUXT_DATABASE_HOST || process.env.DB_HOST
  if (host) return ['127.0.0.1', 'localhost'].includes(host) && Number(process.env.NUXT_DATABASE_PORT || process.env.DB_PORT || 3306) === PORT
  const url = process.env.NUXT_DATABASE_URL
  if (!url) return true
  try {
    const u = new URL(url)
    return ['127.0.0.1', 'localhost'].includes(u.hostname) && Number(u.port || 3306) === PORT
  }
  catch {
    return false
  }
}

async function install() {
  if (!win) {
    console.error('El MySQL portable automático es solo para Windows. En Linux/macOS instala MariaDB o MySQL\n(p. ej. `sudo apt install mariadb-server` o `brew install mariadb`) y apunta NUXT_DATABASE_URL a él.')
    process.exit(1)
  }
  const list = await (await fetch(`https://downloads.mariadb.org/rest-api/mariadb/${SERIES}/`)).json()
  const version = Object.keys(list.releases)[0]
  const url = `https://archive.mariadb.org/mariadb-${version}/winx64-packages/mariadb-${version}-winx64.zip`
  console.log(`• Descargando MariaDB ${version} (una sola vez, ~90 MB)…`)
  mkdirSync(BIN_DIR, { recursive: true })
  const zip = join(DIR, 'mariadb.zip')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(zip))
  const systemTar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  const r = spawnSync(existsSync(systemTar) ? systemTar : 'tar', ['-xf', zip, '-C', BIN_DIR], { stdio: 'inherit' })
  rmSync(zip, { force: true })
  if (r.status !== 0) throw new Error('No se pudo descomprimir MariaDB')
}

function initData() {
  if (existsSync(join(DATA, 'mysql'))) return
  console.log('• Creando la base de datos local…')
  mkdirSync(DATA, { recursive: true })
  const r = spawnSync(exe('mariadb-install-db'), [`--datadir=${DATA}`, `--port=${PORT}`, '--password='], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error('mariadb-install-db falló')
}

const serverArgs = () => [
  '--no-defaults',
  `--datadir=${DATA}`,
  `--port=${PORT}`,
  '--bind-address=127.0.0.1',
  '--character-set-server=utf8mb4',
  '--collation-server=utf8mb4_unicode_ci',
  '--skip-name-resolve',
]

async function waitForPort(ms) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (await portOpen(PORT)) return true
    await new Promise(r => setTimeout(r, 300))
  }
  return false
}

if (args.has('--stop')) {
  const admin = exe('mariadb-admin')
  if (!admin || !(await portOpen(PORT))) {
    console.log('MySQL local no está en marcha')
    process.exit(0)
  }
  spawnSync(admin, ['-u', 'root', '-h', '127.0.0.1', `-P${PORT}`, 'shutdown'], { stdio: 'inherit' })
  console.log('MySQL local detenido')
  process.exit(0)
}

if (args.has('--ensure') && !usesLocalDb()) process.exit(0)

if (await portOpen(PORT)) {
  console.log(`✔ MySQL local en marcha (127.0.0.1:${PORT})`)
  process.exit(0)
}

if (!exe('mysqld')) await install()
initData()

if (args.has('--ensure')) {
  // Segundo plano: sigue vivo aunque se cierre `nuxt dev`
  const log = openSync(join(DIR, 'mysql.log'), 'a')
  const child = spawn(exe('mysqld'), serverArgs(), { detached: true, stdio: ['ignore', log, log], windowsHide: true })
  child.unref()
  if (!(await waitForPort(30_000))) {
    console.error('MySQL local no arrancó. Mira .data/mysql.log')
    process.exit(1)
  }
  console.log(`✔ MySQL local arrancado (127.0.0.1:${PORT}). Para pararlo: npm run db:stop`)
  process.exit(0)
}

console.log(`MySQL local en 127.0.0.1:${PORT} — Ctrl+C para parar`)
const child = spawn(exe('mysqld'), [...serverArgs(), '--console'], { stdio: 'inherit' })
process.on('SIGINT', () => child.kill('SIGINT'))
child.on('exit', code => process.exit(code ?? 0))
