#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildFullClone } from '../server/utils/clone.ts'
import { loadCloneEnv } from './clone-env.mjs'

loadCloneEnv()

console.log('• Conectando a la base de datos y preparando clonación completa…')
try {
  const { zip, filename, stats } = await buildFullClone()
  const outPath = resolve(process.cwd(), process.argv[2] || filename)
  writeFileSync(outPath, zip)

  console.log('════════════════════════════════════════════════════════════════════')
  console.log(' ✔ CLONACIÓN COMPLETA GENERADA CON ÉXITO')
  console.log('════════════════════════════════════════════════════════════════════')
  console.log(`• Archivo generado : ${outPath}`)
  console.log(`• Tamaño           : ${(zip.length / 1024 / 1024).toFixed(2)} MB`)
  console.log(`• Tablas volcadas  : ${stats.tablesCount} tablas (${stats.rowsCount} registros)`)
  console.log(`• Archivos uploads : ${stats.filesCount} archivos`)
  console.log('')
  console.log('PARA RESTAURAR EN UN NUEVO SERVIDOR:')
  console.log(`  1. Copia ${filename} al nuevo servidor`)
  console.log(`  2. Ejecuta en el nuevo servidor:`)
  console.log(`     npm run clone:import ${filename}`)
  console.log('════════════════════════════════════════════════════════════════════')
  process.exit(0)
}
catch (err) {
  console.error('❌ Error al generar la clonación:', err)
  process.exit(1)
}
