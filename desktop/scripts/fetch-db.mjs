#!/usr/bin/env node
/**
 * Descarga el MySQL 8.4 LTS oficial (Oracle) del sistema de destino y deja solo lo que necesita
 * la app de escritorio para funcionar: el servidor (mysqld), sus librerías y la carpeta share.
 *
 *   node scripts/fetch-db.mjs                       → sistema y arquitectura actuales
 *   node scripts/fetch-db.mjs --platform=darwin --arch=arm64
 *
 * Resultado en desktop/vendor/mysql/<platform>-<arch>/ (fuera de git). Las descargas se guardan
 * en desktop/.cache para no repetirlas. MariaDB no publica binarios de macOS: por eso el escritorio
 * usa MySQL en los tres sistemas (la app es compatible con los dos).
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

export const MYSQL_VERSION = '8.4.11'

const HERE = dirname(fileURLToPath(import.meta.url))
const DESKTOP = join(HERE, '..')
const CACHE = join(DESKTOP, '.cache')

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1]
const platform = arg('platform') || process.platform
const arch = arg('arch') || process.arch

const PACKAGES = {
  'win32-x64': `mysql-${MYSQL_VERSION}-winx64.zip`,
  'darwin-arm64': `mysql-${MYSQL_VERSION}-macos15-arm64.tar.gz`,
  'darwin-x64': `mysql-${MYSQL_VERSION}-macos15-x86_64.tar.gz`,
  'linux-x64': `mysql-${MYSQL_VERSION}-linux-glibc2.28-x86_64-minimal.tar.xz`,
}

const target = `${platform}-${arch}`
const file = PACKAGES[target]
if (!file) {
  console.error(`Sistema no soportado para la base de datos embebida: ${target}. Soportados: ${Object.keys(PACKAGES).join(', ')}`)
  process.exit(1)
}

const OUT = join(DESKTOP, 'vendor', 'mysql', target)
const MARK = join(OUT, '.version')
const exeName = platform === 'win32' ? 'mysqld.exe' : 'mysqld'

if (existsSync(join(OUT, 'bin', exeName)) && existsSync(MARK)) {
  console.log(`✔ MySQL ${MYSQL_VERSION} (${target}) ya está en ${relative(process.cwd(), OUT)}`)
  process.exit(0)
}

async function download(url, to) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`)
  const total = Number(res.headers.get('content-length') || 0)
  let done = 0
  let last = 0
  const body = Readable.fromWeb(res.body)
  body.on('data', (chunk) => {
    done += chunk.length
    if (total && process.stdout.isTTY && Date.now() - last > 500) {
      last = Date.now()
      process.stdout.write(`\r  ${(done / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`)
    }
  })
  await pipeline(body, createWriteStream(`${to}.part`))
  if (process.stdout.isTTY) process.stdout.write('\n')
  renameSync(`${to}.part`, to)
}

function tar() {
  if (process.platform !== 'win32') return 'tar'
  const system = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  return existsSync(system) ? system : 'tar'
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/** Lo que se queda: el servidor, sus librerías compartidas y share (mensajes de error, juegos de caracteres) */
function keep(rel) {
  const parts = rel.split(sep)
  const name = parts.at(-1)
  // Mensajes de error solo en inglés (cada idioma trae su errmsg.sys)
  if (parts[0] === 'share') return !(name === 'errmsg.sys' && parts[1] !== 'english')
  if (parts[0] === 'bin') return name === exeName || (/\.dll$/i.test(name) && !/-debug\.dll$/i.test(name))
  if (parts[0] === 'lib') {
    if (parts.includes('plugin') || parts.includes('debug') || parts.includes('mecab')) return false
    // Datos ICU (lib/private/icudt*): sin ellos fallan las consultas con REGEXP (banco, asistente)
    if (parts[1] === 'private' && parts.some(p => /^icudt/.test(p))) return true
    return /\.(so(\.\d+)*|dylib)$/.test(name) || /\.so\.\d/.test(name)
  }
  return name === 'LICENSE' || name === 'README'
}

const archive = join(CACHE, file)
mkdirSync(CACHE, { recursive: true })
if (!existsSync(archive)) {
  const url = `https://cdn.mysql.com/archives/mysql-8.4/${file}`
  console.log(`• Descargando ${file}…`)
  await download(url, archive)
}

const tmp = join(CACHE, `extract-${target}`)
rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp, { recursive: true })
console.log('• Descomprimiendo…')
const r = spawnSync(tar(), ['-xf', archive, '-C', tmp], { stdio: 'inherit' })
if (r.status !== 0) throw new Error('No se pudo descomprimir el paquete de MySQL')

const root = readdirSync(tmp).map(n => join(tmp, n)).find(p => statSync(p).isDirectory())
if (!root) throw new Error('Paquete de MySQL vacío')

rmSync(OUT, { recursive: true, force: true })
let bytes = 0
for (const f of walk(root)) {
  const rel = relative(root, f)
  if (!keep(rel)) continue
  const to = join(OUT, rel)
  mkdirSync(dirname(to), { recursive: true })
  renameSync(f, to)
  bytes += statSync(to).size
}
rmSync(tmp, { recursive: true, force: true })

if (!existsSync(join(OUT, 'bin', exeName))) throw new Error(`No se encontró ${exeName} en el paquete`)

// Linux: mysqld enlaza libaio y libnuma, que no todas las distribuciones traen (Ubuntu 24.04 renombró
// libaio a libaio.so.1t64). Se copian las del sistema de compilación junto a mysqld (LD_LIBRARY_PATH)
if (platform === 'linux' && process.platform === 'linux') {
  const ldd = spawnSync('ldd', [join(OUT, 'bin', exeName)], { encoding: 'utf8' }).stdout ?? ''
  const libDir = join(OUT, 'lib')
  mkdirSync(libDir, { recursive: true })
  const search = ['/lib/x86_64-linux-gnu', '/usr/lib/x86_64-linux-gnu', '/usr/lib64', '/lib64', '/usr/lib']
  for (const [want, alternatives] of [['libaio.so.1', ['libaio.so.1', 'libaio.so.1t64']], ['libnuma.so.1', ['libnuma.so.1']]]) {
    const found = search.flatMap(d => alternatives.map(a => join(d, a))).find(p => existsSync(p))
    if (!found) {
      console.warn(`  ! ${want} no está en este sistema (instala libaio1/libaio1t64 y libnuma1): el paquete dependerá del sistema de destino`)
      continue
    }
    copyFileSync(realpathSync(found), join(libDir, want))
    console.log(`  · ${want} incluida (${found})`)
  }
  const missing = ldd.split('\n').filter(l => l.includes('not found')).map(l => l.trim().split(' ')[0]).filter(l => !existsSync(join(libDir, l)))
  if (missing.length) console.warn(`  ! mysqld necesita además: ${missing.join(', ')}`)
}
writeFileSync(MARK, `${MYSQL_VERSION} ${target}\n`)
console.log(`✔ MySQL ${MYSQL_VERSION} (${target}) listo: ${(bytes / 1e6).toFixed(0)} MB en ${relative(process.cwd(), OUT)}`)
