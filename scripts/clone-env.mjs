import { spawnSync } from 'node:child_process'
import { chownSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Node de Plesk: la consola SSH suele traer el del sistema (p. ej. 18), demasiado antiguo */
const PLESK_NODE_BINS = [24, 25, 22].map(v => `/opt/plesk/node/${v}/bin`)

/** Con un Node anterior al 22 se relanza el mismo comando con el Node de Plesk, si lo hay */
function ensureNode() {
  if (Number(process.versions.node.split('.')[0]) >= 22) return
  const bin = PLESK_NODE_BINS.find(dir => existsSync(join(dir, 'npx')))
  if (!bin || process.env.NUMIQ_NODE_REEXEC) {
    console.error(`❌ Node ${process.versions.node} es demasiado antiguo: NUMIQ necesita Node 22.22 o superior.`)
    console.error('   En Plesk: export PATH=/opt/plesk/node/24/bin:$PATH y repite el comando.')
    process.exit(1)
  }
  console.log(`• Node ${process.versions.node} en la consola: se usa el de Plesk (${bin}/node)`)
  const r = spawnSync(join(bin, 'npx'), ['--yes', 'tsx', ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, NUMIQ_NODE_REEXEC: '1' },
  })
  if (r.error) console.error(`❌ No se pudo lanzar ${bin}/npx: ${r.error.message}`)
  process.exit(r.status ?? 1)
}

/**
 * Datos de conexión para clone:export / clone:import. En el servidor las variables del panel de
 * Plesk no llegan a la consola: se leen del .env de la carpeta de la app (las del entorno mandan).
 * Sin datos de la base se para, en vez de intentar el MariaDB local de desarrollo (127.0.0.1:3308).
 */
export function loadCloneEnv() {
  ensureNode()
  const file = resolve(process.cwd(), '.env')
  if (existsSync(file)) process.loadEnvFile(file)
  const e = process.env
  if (e.NUXT_DATABASE_URL || e.DB_HOST || e.DB_SOCKET || e.NUXT_DATABASE_HOST || e.NUXT_DATABASE_SOCKET) return
  console.error('❌ Faltan los datos de la base de datos.')
  console.error(`   Crea ${file} con los datos de la base:`)
  console.error('     DB_HOST=localhost')
  console.error('     DB_PORT=3306')
  console.error('     DB_USER=usuario_de_la_base')
  console.error('     DB_PASSWORD=\'contraseña_de_la_base\'')
  console.error('     DB_NAME=nombre_de_la_base')
  console.error('   y NUXT_UPLOADS_DIR si en el panel apunta a otra carpeta.')
  process.exit(1)
}

/** Carpeta de archivos subidos, igual que la resuelve la app */
export const uploadsDir = () => resolve(process.cwd(), process.env.NUXT_UPLOADS_DIR || 'storage/uploads')

/**
 * Ejecutado como root, los archivos restaurados serían de root y la app (usuario del dominio)
 * no podría guardar nada nuevo en esas carpetas: se devuelven al dueño de la carpeta de la app.
 */
export function fixUploadsOwner() {
  if (process.getuid?.() !== 0) return null
  const { uid, gid } = statSync(process.cwd())
  if (uid === 0) return null
  const walk = (p) => {
    chownSync(p, uid, gid)
    if (statSync(p).isDirectory()) for (const name of readdirSync(p)) walk(join(p, name))
  }
  const dir = uploadsDir()
  if (existsSync(dir)) walk(dir)
  return { uid, gid }
}
