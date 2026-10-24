#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { restoreFullClone } from '../server/utils/clone.ts'
import { dbTarget } from '../server/utils/db.ts'
import { fixUploadsOwner, loadCloneEnv, uploadsDir } from './clone-env.mjs'

loadCloneEnv()

const fileArg = process.argv[2]
if (!fileArg) {
  console.error('Uso: npm run clone:import <archivo-clon.zip>')
  console.error('Ejemplo: npm run clone:import numiq-clon-completo-2026-10-24.zip')
  process.exit(1)
}

const filePath = resolve(process.cwd(), fileArg)
if (!existsSync(filePath)) {
  console.error(`❌ El archivo no existe: ${filePath}`)
  process.exit(1)
}

const target = dbTarget()
console.log(`• Leyendo archivo de clonación: ${filePath}…`)
console.log(`• Base de datos destino: ${target.user}@${target.socketPath ?? `${target.host}:${target.port}`}/${target.database}`)
console.log(`• Carpeta de archivos  : ${uploadsDir()}`)
try {
  const data = readFileSync(filePath)
  console.log(`• Restaurando base de datos y archivos en el servidor…`)
  const result = await restoreFullClone(data)
  const owner = fixUploadsOwner()
  if (owner) console.log(`• Archivos devueltos al usuario del dominio (uid ${owner.uid})`)

  console.log('════════════════════════════════════════════════════════════════════')
  console.log(' ✔ CLONACIÓN RESTAURADA CON ÉXITO')
  console.log('════════════════════════════════════════════════════════════════════')
  console.log(`• Tablas restauradas : ${result.tablesRestored}`)
  console.log(`• Archivos en uploads: ${result.filesRestored}`)
  console.log('Todos los datos, usuarios, contraseñas, documentos y archivos han')
  console.log('sido clonados idénticamente en este servidor.')
  console.log('════════════════════════════════════════════════════════════════════')
  process.exit(0)
}
catch (err) {
  fixUploadsOwner()
  console.error('❌ Error al restaurar el clon:', err)
  process.exit(1)
}
