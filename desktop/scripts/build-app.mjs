#!/usr/bin/env node
/**
 * Compila NUMIQ (Nuxt) para la app de escritorio en desktop/.server: el mismo código que la web,
 * con su servidor Nitro y las migraciones. La versión de la app de escritorio sigue a la de la web.
 *
 *   node scripts/build-app.mjs
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DESKTOP = join(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = join(DESKTOP, '..')
const OUT = join(DESKTOP, '.server')

// Versión: la del package.json de la web (sube con cada publicación)
const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const pkgFile = join(DESKTOP, 'package.json')
const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
if (pkg.version !== rootPkg.version) {
  pkg.version = rootPkg.version
  writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`)
  console.log(`• Versión de escritorio → ${rootPkg.version}`)
}

if (!existsSync(join(ROOT, 'node_modules', 'nuxt'))) {
  console.log('• Instalando dependencias de NUMIQ…')
  const r = spawnSync('npm', ['ci'], { cwd: ROOT, stdio: 'inherit', shell: true })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

console.log('• Compilando NUMIQ…')
rmSync(OUT, { recursive: true, force: true })
const env = { ...process.env, NITRO_OUTPUT_DIR: OUT, NODE_ENV: 'production' }
// Ninguna URL pública del .env de desarrollo en la compilación (og:url, og:image)
delete env.NUXT_SITE_URL
env.NUXT_SITE_URL = ''
const r = spawnSync('npx', ['nuxt', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true, env })
if (r.status !== 0) process.exit(r.status ?? 1)

for (const p of ['server/index.mjs', 'server/app.mjs', 'server/migrations/meta/_journal.json', 'public']) {
  if (!existsSync(join(OUT, p))) {
    console.error(`Falta ${p} en la compilación`)
    process.exit(1)
  }
}
console.log(`✔ NUMIQ ${rootPkg.version} compilado en desktop/.server`)
