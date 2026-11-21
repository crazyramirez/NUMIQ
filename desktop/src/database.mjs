/**
 * Base de datos de la app de escritorio: un MySQL 8.4 propio que solo escucha en 127.0.0.1,
 * con los datos en la carpeta del usuario y una contraseña de root aleatoria (ningún otro programa
 * del equipo puede leerla sin ella).
 *
 * Primer arranque: se inicializa la carpeta de datos, se fija la contraseña y se crea la base `numiq`.
 * Cierre: SHUTDOWN ordenado (InnoDB no necesita recuperarse al volver a abrir).
 */
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { join } from 'node:path'
import mysql from 'mysql2/promise'

export const DB_NAME = 'numiq'

/** Mismos modos que MariaDB por defecto (la app se desarrolla con MariaDB): sin ONLY_FULL_GROUP_BY */
const SQL_MODE = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'

const sleep = ms => new Promise(r => setTimeout(r, ms))

export function portOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.connect(port, host)
    s.once('connect', () => {
      s.destroy()
      resolve(true)
    })
    s.once('error', () => resolve(false))
  })
}

/** Un puerto libre: el preferido si está libre, si no uno que asigne el sistema */
export function freePort(preferred) {
  const tryPort = p => new Promise((resolve) => {
    const srv = net.createServer()
    srv.unref()
    srv.once('error', () => resolve(null))
    srv.listen(p, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
  return (async () => (preferred ? await tryPort(preferred) : null) ?? await tryPort(0))()
}

async function connect({ port, password, database, timeout = 5000 }) {
  return mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password, database, connectTimeout: timeout })
}

async function canConnect(port, password) {
  try {
    const c = await connect({ port, password, timeout: 3000 })
    await c.end()
    return true
  }
  catch {
    return false
  }
}

/**
 * Arranca (o reutiliza) el MySQL de la app.
 * @param {object} o
 * @param {string} o.basedir   carpeta con bin/mysqld y share/
 * @param {string} o.datadir   carpeta de datos (se crea en el primer arranque)
 * @param {number} o.port
 * @param {string} o.password  contraseña de root (la genera quien llama y la guarda)
 * @param {string} o.logFile
 * @param {(line: string) => void} [o.onStatus]
 */
export async function startDatabase(o) {
  const status = o.onStatus ?? (() => {})
  const exe = join(o.basedir, 'bin', process.platform === 'win32' ? 'mysqld.exe' : 'mysqld')
  if (!existsSync(exe)) throw new Error(`No se encuentra el servidor de base de datos (${exe})`)

  // Un MySQL nuestro que siguió vivo (la app se cerró de golpe): se reutiliza
  if (await portOpen(o.port)) {
    if (await canConnect(o.port, o.password)) return handle(o, null)
    const err = new Error(`El puerto ${o.port} está ocupado por otro programa`)
    err.code = 'PORT_IN_USE'
    throw err
  }

  const marker = join(o.datadir, '..', '.numiq-db-init')
  // Inicialización a medias (corte de luz, cierre durante el primer arranque): se repite desde cero.
  // Solo se borra la carpeta si la marca existe: nunca datos de un arranque completo
  if (existsSync(marker) && existsSync(o.datadir)) rmSync(o.datadir, { recursive: true, force: true })
  const firstRun = !existsSync(join(o.datadir, 'mysql.ibd')) && !existsSync(join(o.datadir, 'mysql'))
  if (firstRun) {
    if (existsSync(o.datadir) && readdirSync(o.datadir).length) {
      throw new Error(`La carpeta de datos ${o.datadir} no está vacía y no es una base de datos de NUMIQ`)
    }
    status('Preparando la base de datos (solo la primera vez)…')
    mkdirSync(join(o.datadir, '..'), { recursive: true })
    writeFileSync(marker, new Date().toISOString())
    const r = spawnSync(exe, [
      '--no-defaults',
      '--initialize-insecure',
      `--basedir=${o.basedir}`,
      `--datadir=${o.datadir}`,
      `--log-error=${o.logFile}`,
    ], { windowsHide: true, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`No se pudo crear la base de datos (código ${r.status}). Registro: ${o.logFile}`)
  }

  status('Abriendo la base de datos…')
  const args = [
    '--no-defaults',
    `--basedir=${o.basedir}`,
    `--datadir=${o.datadir}`,
    `--port=${o.port}`,
    '--bind-address=127.0.0.1',
    '--mysqlx=OFF',
    `--log-error=${o.logFile}`,
    `--pid-file=${join(o.datadir, '..', 'mysqld.pid')}`,
    '--character-set-server=utf8mb4',
    '--collation-server=utf8mb4_unicode_ci',
    `--sql-mode=${SQL_MODE}`,
    '--default-time-zone=+00:00',
    // Equipo de escritorio: poca memoria y sin registros que crecen sin parar
    '--disable-log-bin',
    '--performance-schema=OFF',
    '--innodb-buffer-pool-size=64M',
    '--max-connections=40',
    '--max-allowed-packet=256M',
  ]
  if (process.platform !== 'win32') args.push(`--socket=${join(o.datadir, '..', 'mysql.sock')}`)
  if (process.platform === 'linux') args.push('--innodb-use-native-aio=0')

  const out = openSync(o.logFile, 'a')
  const child = spawn(exe, args, {
    stdio: ['ignore', out, out],
    windowsHide: true,
    env: {
      ...process.env,
      // Linux: librerías que acompañan a mysqld (libaio, libnuma) en <basedir>/lib
      ...(process.platform === 'linux' ? { LD_LIBRARY_PATH: [join(o.basedir, 'lib'), join(o.basedir, 'lib', 'private'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } : {}),
    },
  })
  closeSync(out)
  let exited = null
  child.once('exit', (code) => {
    exited = code ?? -1
  })

  const until = Date.now() + (firstRun ? 180_000 : 90_000)
  while (Date.now() < until) {
    if (exited !== null) throw new Error(`La base de datos se cerró al arrancar (código ${exited}). Registro: ${o.logFile}`)
    if (await portOpen(o.port)) break
    await sleep(250)
  }
  if (!(await portOpen(o.port))) {
    child.kill()
    throw new Error(`La base de datos no respondió a tiempo. Registro: ${o.logFile}`)
  }

  if (firstRun) {
    const c = await connect({ port: o.port, password: '' })
    try {
      await c.query('ALTER USER \'root\'@\'localhost\' IDENTIFIED BY ?', [o.password])
      await c.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    }
    finally {
      await c.end().catch(() => {})
    }
    rmSync(marker, { force: true })
  }
  else if (!(await canConnect(o.port, o.password))) {
    child.kill()
    throw new Error('La contraseña de la base de datos no coincide con la guardada en la configuración de la app')
  }

  return handle(o, child)
}

function handle(o, child) {
  return {
    port: o.port,
    url: `mysql://root:${encodeURIComponent(o.password)}@127.0.0.1:${o.port}/${DB_NAME}`,
    /** Cierre ordenado; si no responde en 20 s, se fuerza */
    async stop() {
      try {
        const c = await connect({ port: o.port, password: o.password, timeout: 3000 })
        await c.query('SHUTDOWN').catch(() => {})
        await c.end().catch(() => {})
      }
      catch {
        // ya cerrado
      }
      const until = Date.now() + 20_000
      while (Date.now() < until && await portOpen(o.port)) await sleep(200)
      if (child && child.exitCode === null) {
        await new Promise((resolve) => {
          const t = setTimeout(() => {
            child.kill('SIGKILL')
            resolve()
          }, 8000)
          child.once('exit', () => {
            clearTimeout(t)
            resolve()
          })
        })
      }
    },
  }
}

/** Copia la salida de un proceso a un archivo de registro (rotado a 5 MB) */
export function logStream(file) {
  return createWriteStream(file, { flags: 'a' })
}
