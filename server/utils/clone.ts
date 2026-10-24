import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize, relative, resolve } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import mysql from 'mysql2/promise'
import { dbTarget } from './db'

export interface CloneStats {
  tablesCount: number
  rowsCount: number
  filesCount: number
  filesBytes: number
  createdAt: string
}

function escapeSqlValue(val: unknown): string {
  if (val === null || val === undefined) return 'NULL'
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL'
  if (typeof val === 'boolean') return val ? '1' : '0'
  if (val instanceof Date) return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`
  if (Buffer.isBuffer(val) || val instanceof Uint8Array) {
    return `X'${Buffer.from(val).toString('hex')}'`
  }
  if (typeof val === 'object') {
    return escapeSqlString(JSON.stringify(val))
  }
  return escapeSqlString(String(val))
}

function escapeSqlString(str: string): string {
  return `'${str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\0/g, '\\0')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\x1a/g, '\\Z')}'`
}

/** Genera un volcado SQL completo de todas las tablas y sus datos */
export async function dumpDatabaseSql(): Promise<{ sql: string, tablesCount: number, rowsCount: number }> {
  const target = dbTarget()
  const conn = await mysql.createConnection({
    socketPath: target.socketPath,
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
    database: target.database,
    charset: 'utf8mb4',
    timezone: 'Z',
  })

  try {
    const parts: string[] = [
      '-- NUMIQ Full Database Clone Dump',
      `-- Generated at: ${new Date().toISOString()}`,
      `-- Database: ${target.database}`,
      'SET NAMES utf8mb4;',
      'SET FOREIGN_KEY_CHECKS = 0;',
      'SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";',
      'SET time_zone = "+00:00";',
      '',
    ]

    const [tableRows] = await conn.query<any[]>('SHOW FULL TABLES WHERE Table_type = "BASE TABLE"')
    const tableNames: string[] = tableRows.map(r => Object.values(r)[0] as string)
    let totalRows = 0

    for (const table of tableNames) {
      parts.push(`-- Table structure for \`${table}\``)
      parts.push(`DROP TABLE IF EXISTS \`${table}\`;`)

      const [createResult] = await conn.query<any[]>(`SHOW CREATE TABLE \`${table}\``)
      const createSql: string = createResult[0]?.['Create Table'] ?? ''
      parts.push(`${createSql};`, '')

      const [rows] = await conn.query<any[]>(`SELECT * FROM \`${table}\``)
      if (rows && rows.length > 0) {
        totalRows += rows.length
        parts.push(`-- Dumping data for table \`${table}\` (${rows.length} rows)`)

        // Inserciones en bloques de 150 filas para no superar max_allowed_packet
        const chunkSize = 150
        for (let i = 0; i < rows.length; i += chunkSize) {
          const chunk = rows.slice(i, i + chunkSize)
          const valueClauses = chunk.map(row => {
            const values = Object.values(row).map(escapeSqlValue)
            return `(${values.join(', ')})`
          })
          parts.push(`INSERT INTO \`${table}\` VALUES\n${valueClauses.join(',\n')};`)
        }
        parts.push('')
      }
    }

    parts.push('SET FOREIGN_KEY_CHECKS = 1;', '')
    return {
      sql: parts.join('\n'),
      tablesCount: tableNames.length,
      rowsCount: totalRows,
    }
  }
  finally {
    await conn.end().catch(() => {})
  }
}

/** Crea un paquete ZIP de clonación completo: database.sql + todos los uploads */
export async function buildFullClone(): Promise<{ zip: Buffer, filename: string, stats: CloneStats }> {
  const { sql, tablesCount, rowsCount } = await dumpDatabaseSql()
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}

  // 1. Archivo SQL con la base de datos completa
  const sqlBytes = Buffer.from(sql, 'utf8')
  entries['database.sql'] = [sqlBytes, { level: 6 }]

  // 2. Archivos físicos de storage/uploads (recorriendo subcarpetas)
  const uploadsDir = resolve(process.cwd(), process.env.NUXT_UPLOADS_DIR || 'storage/uploads')
  let filesCount = 0
  let filesBytes = 0

  if (existsSync(uploadsDir)) {
    const collectRecursively = (dir: string, baseDir: string): Array<{ fullPath: string, relPath: string }> => {
      const results: Array<{ fullPath: string, relPath: string }> = []
      try {
        const dirEntries = readdirSync(dir, { withFileTypes: true })
        for (const entry of dirEntries) {
          const fullPath = join(dir, entry.name)
          if (entry.isDirectory()) {
            results.push(...collectRecursively(fullPath, baseDir))
          }
          else if (entry.isFile()) {
            const relPath = relative(baseDir, fullPath).replace(/\\/g, '/')
            results.push({ fullPath, relPath })
          }
        }
      }
      catch (e) {
        console.warn(`[clone] Error leyendo directorio ${dir}:`, e)
      }
      return results
    }

    const allFiles = collectRecursively(uploadsDir, uploadsDir)
    for (const item of allFiles) {
      try {
        const fileData = readFileSync(item.fullPath)
        entries[`uploads/${item.relPath}`] = [fileData, { level: 0 }]
        filesCount++
        filesBytes += fileData.length
      }
      catch (err) {
        console.warn(`[clone] No se pudo leer archivo ${item.relPath}:`, err)
      }
    }
  }

  // 3. Manifiesto
  const manifest = {
    app: 'NUMIQ',
    version: '1.0.0',
    type: 'full_server_clone',
    createdAt: new Date().toISOString(),
    tablesCount,
    rowsCount,
    filesCount,
    filesBytes,
  }
  entries['manifest.json'] = [Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), { level: 6 }]

  // 4. Instrucciones Léeme
  const instructions = [
    '═══════════════════════════════════════════════════════════════',
    ' CLON COMPLETO DE NUMIQ (BASE DE DATOS + ARCHIVOS)',
    '═══════════════════════════════════════════════════════════════',
    `Generado el: ${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}`,
    `Tablas en la BD: ${tablesCount} (total ${rowsCount} registros)`,
    `Archivos físicos en uploads: ${filesCount} (${(filesBytes / 1024 / 1024).toFixed(2)} MB)`,
    '',
    'CÓMO RESTAURAR EN UN NUEVO SERVIDOR:',
    '',
    'Opción A (Desde la web):',
    '  1. En el nuevo servidor, entra en Ajustes > Copia de seguridad > Clonar.',
    '  2. Sube este archivo .zip en "Restaurar clon en este servidor".',
    '',
    'Opción B (Por terminal / línea de comandos):',
    '  1. Copia este archivo al nuevo servidor en la raíz del proyecto.',
    '  2. Ejecuta: node scripts/clone-import.mjs <nombre-de-este-archivo.zip>',
    '',
    'Opción C (Manual por MySQL):',
    '  1. Extrae database.sql e impórtalo en tu MySQL: mysql -u usuario -p base_de_datos < database.sql',
    '  2. Extrae la carpeta uploads/ dentro de storage/uploads/',
  ].join('\r\n')
  entries['LEEME-INSTRUCCIONES.txt'] = [Buffer.from(instructions, 'utf8'), { level: 6 }]

  const zip = Buffer.from(zipSync(entries))
  const stamp = new Date().toISOString().slice(0, 10)
  const filename = `numiq-clon-completo-${stamp}.zip`

  return {
    zip,
    filename,
    stats: {
      tablesCount,
      rowsCount,
      filesCount,
      filesBytes,
      createdAt: manifest.createdAt,
    },
  }
}

/** Restaura un paquete ZIP de clonación completa en el servidor actual */
export async function restoreFullClone(zipData: Buffer | Uint8Array): Promise<{ ok: boolean, tablesRestored: number, filesRestored: number }> {
  const unzipped = unzipSync(zipData instanceof Uint8Array ? zipData : new Uint8Array(zipData))

  const sqlEntry = unzipped['database.sql']
  if (!sqlEntry) {
    throw new Error('El archivo ZIP no contiene "database.sql". Asegúrate de subir un archivo de clonación válido de NUMIQ.')
  }

  // 1. Restaurar archivos de storage/uploads (preservando subcarpetas)
  const uploadsDir = resolve(process.cwd(), process.env.NUXT_UPLOADS_DIR || 'storage/uploads')
  mkdirSync(uploadsDir, { recursive: true })
  let filesRestored = 0

  for (const [pathInZip, u8] of Object.entries(unzipped)) {
    if (pathInZip.startsWith('uploads/') && !pathInZip.endsWith('/')) {
      const relInside = pathInZip.replace(/^uploads\//, '')
      if (relInside && !relInside.includes('..')) {
        const targetPath = normalize(join(uploadsDir, relInside))
        if (targetPath.startsWith(uploadsDir)) {
          mkdirSync(dirname(targetPath), { recursive: true })
          writeFileSync(targetPath, Buffer.from(u8))
          filesRestored++
        }
      }
    }
  }

  // 2. Restaurar base de datos
  const sqlScript = strFromU8(sqlEntry)
  const target = dbTarget()
  const conn = await mysql.createConnection({
    socketPath: target.socketPath,
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
    database: target.database,
    multipleStatements: true,
    charset: 'utf8mb4',
    timezone: 'Z',
  })

  let tablesRestored = 0
  try {
    await conn.query(sqlScript)
    const [tables] = await conn.query<any[]>('SHOW FULL TABLES WHERE Table_type = "BASE TABLE"')
    tablesRestored = tables.length
  }
  finally {
    await conn.end().catch(() => {})
  }

  return {
    ok: true,
    tablesRestored,
    filesRestored,
  }
}
