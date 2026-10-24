import { chownSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Datos de conexión para clone:export / clone:import. En el servidor las variables del panel de
 * Plesk no llegan a la consola: se leen del .env de la carpeta de la app (las del entorno mandan).
 * Sin datos de la base se para, en vez de intentar el MariaDB local de desarrollo (127.0.0.1:3308).
 */
export function loadCloneEnv() {
  const file = resolve(process.cwd(), '.env')
  if (existsSync(file)) process.loadEnvFile(file)
  const e = process.env
  if (e.NUXT_DATABASE_URL || e.DB_HOST || e.DB_SOCKET || e.NUXT_DATABASE_HOST || e.NUXT_DATABASE_SOCKET) return
  console.error('❌ Faltan los datos de la base de datos.')
  console.error(`   Crea ${file} con los mismos valores que el panel Node.js:`)
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
