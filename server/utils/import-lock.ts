import { createHash } from 'node:crypto'
import mysql from 'mysql2/promise'

/** Serializa la comprobación y escritura de importaciones, incluso entre procesos. */
export async function withImportLock<T>(companyId: number, work: () => Promise<T>): Promise<T> {
  const target = dbTarget()
  // Conexión dedicada: los procesos esperando no agotan el pool usado para importar.
  const connection = await mysql.createConnection(target)
  const key = `numiq:import:${createHash('sha256').update(`${target.database}:${companyId}`).digest('hex').slice(0, 40)}`
  let acquired = false
  try {
    const [rows] = await connection.query<mysql.RowDataPacket[]>('SELECT GET_LOCK(?, 30) AS acquired', [key])
    acquired = Number(rows[0]?.acquired) === 1
    if (!acquired) throw createError({ statusCode: 409, statusMessage: 'Hay otra importación guardándose. Vuelve a intentarlo en unos segundos' })
    return await work()
  }
  finally {
    try {
      if (acquired) await connection.query('SELECT RELEASE_LOCK(?)', [key])
    }
    finally {
      await connection.end()
    }
  }
}
