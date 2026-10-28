import { eq, inArray, sql } from 'drizzle-orm'
import type { MemberRole } from '../db/schema'
import type { Db } from './db'

/**
 * Eliminar la cuenta. Se borran el usuario y las empresas de las que es el único propietario, con
 * todos sus datos y archivos. De las demás solo sale: lo que hizo en ellas se queda, sin su nombre.
 * Las tablas se descubren en la base de datos (columnas company_id, *user_id y *_by), así que una
 * tabla nueva queda cubierta sola; solo las tablas hijas sin company_id van en HIJAS, al final.
 */

type Company = typeof tables.companies.$inferSelect
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type Column = { t: string, c: string, nullable: boolean }

export interface DeletionCompany {
  id: number
  name: string
  role: MemberRole
}

export interface CompanyToRemove extends DeletionCompany {
  /** Quienes pierden el acceso al borrarse */
  others: Array<{ name: string, role: MemberRole }>
  counts: { documents: number, expenses: number, contacts: number, bank: number, files: number }
  lastBackup: string | null
}

/** Qué pasará con cada empresa del usuario si elimina la cuenta */
export async function accountDeletionPlan(userId: number) {
  const db = useDb()
  const m = tables.companyMembers
  const mine = await db.select({ company: tables.companies, role: m.role })
    .from(m)
    .innerJoin(tables.companies, eq(tables.companies.id, m.companyId))
    .where(eq(m.userId, userId))
    .orderBy(tables.companies.legalName)
  const remove: CompanyToRemove[] = []
  const leave: DeletionCompany[] = []
  if (!mine.length) return { remove, leave }
  const everyone = await db.select({ companyId: m.companyId, userId: m.userId, role: m.role, name: tables.users.name })
    .from(m)
    .innerJoin(tables.users, eq(tables.users.id, m.userId))
    .where(inArray(m.companyId, mine.map(x => x.company.id)))
  for (const { company, role } of mine) {
    const name = company.tradeName || company.legalName
    const others = everyone.filter(x => x.companyId === company.id && x.userId !== userId)
    // Con otro propietario la empresa sigue: solo se sale de ella
    if (role !== 'owner' || others.some(x => x.role === 'owner')) {
      leave.push({ id: company.id, name, role })
      continue
    }
    const { documents, expenses, contacts, bank, files, last } = await backupPreview(company)
    remove.push({ id: company.id, name, role, others: others.map(x => ({ name: x.name, role: x.role })), counts: { documents, expenses, contacts, bank, files }, lastBackup: last?.at ?? null })
  }
  return { remove, leave }
}

/** Borra la cuenta y todo lo suyo, en una sola transacción; después, los archivos de las empresas borradas */
export async function deleteAccount(userId: number) {
  const plan = await accountDeletionPlan(userId)
  await useDb().transaction(async (tx) => {
    const columns = await referenceColumns(tx)
    for (const c of plan.remove) await purgeCompany(tx, c.id, columns)
    await purgeUser(tx, userId, columns)
  })
  for (const c of plan.remove) await deleteCompanyFolder(c.id)
  return plan
}

/** Qué se pierde al eliminar una sola empresa: sus datos y quién deja de tener acceso */
export async function companyDeletionPlan(company: Company, userId: number) {
  const m = tables.companyMembers
  const members = await useDb().select({ userId: m.userId, role: m.role, name: tables.users.name })
    .from(m)
    .innerJoin(tables.users, eq(tables.users.id, m.userId))
    .where(eq(m.companyId, company.id))
  const { documents, expenses, contacts, bank, files, last } = await backupPreview(company)
  return {
    id: company.id,
    name: company.tradeName || company.legalName,
    others: members.filter(x => x.userId !== userId).map(x => ({ name: x.name, role: x.role })),
    counts: { documents, expenses, contacts, bank, files },
    lastBackup: last?.at ?? null,
  } satisfies Omit<CompanyToRemove, 'role'>
}

/**
 * Borra una empresa con todos sus datos y archivos, sin tocar las demás empresas de nadie. Quien la
 * tenía abierta pasa a otra de las suyas (o al asistente de bienvenida si no le queda ninguna)
 */
export async function deleteCompany(companyId: number) {
  await useDb().transaction(async (tx) => {
    await purgeCompany(tx, companyId, await referenceColumns(tx))
  })
  await deleteCompanyFolder(companyId)
}

/** Columnas enteras que apuntan a una empresa o a un usuario, en todas las tablas */
async function referenceColumns(tx: Tx): Promise<Column[]> {
  const [rows] = await tx.execute(sql`
    SELECT table_name AS t, column_name AS c, is_nullable AS n FROM information_schema.columns
    WHERE table_schema = DATABASE() AND data_type = 'int'
      AND (column_name = 'company_id' OR column_name LIKE '%user\\_id' OR column_name LIKE '%\\_by')`) as unknown as [Array<{ t: string, c: string, n: string }>]
  return rows.map(r => ({ t: r.t, c: r.c, nullable: r.n === 'YES' }))
}

async function purgeCompany(tx: Tx, companyId: number, columns: Column[]) {
  for (const [child, fk, parent, parentKey] of HIJAS) {
    await tx.execute(sql`DELETE FROM ${sql.identifier(child)} WHERE ${sql.identifier(fk)} IN (SELECT id FROM ${sql.identifier(parent)} WHERE ${sql.identifier(parentKey)} = ${companyId})`)
  }
  for (const { t } of columns.filter(x => x.c === 'company_id')) {
    // El consumo de IA es lo que cobró OpenAI a cada clave: se conserva (sale como «Empresa eliminada»)
    if (t === 'ai_usage') continue
    await tx.execute(sql`DELETE FROM ${sql.identifier(t)} WHERE company_id = ${companyId}`)
  }
  await tx.execute(sql`DELETE FROM companies WHERE id = ${companyId}`)
  // Quien la tenía abierta pasa a otra de sus empresas (o al asistente de bienvenida si no tiene más)
  await tx.execute(sql`UPDATE users u SET current_company_id = (SELECT MIN(m.company_id) FROM company_members m WHERE m.user_id = u.id) WHERE u.current_company_id = ${companyId}`)
}

async function purgeUser(tx: Tx, userId: number, columns: Column[]) {
  for (const [child, fk, parent, parentKey] of HIJAS) {
    if (parentKey !== 'user_id') continue
    await tx.execute(sql`DELETE FROM ${sql.identifier(child)} WHERE ${sql.identifier(fk)} IN (SELECT id FROM ${sql.identifier(parent)} WHERE user_id = ${userId})`)
  }
  for (const { t, c, nullable } of columns.filter(x => x.c !== 'company_id')) {
    // Obligatoria = dato suyo (llaves, avisos, conversaciones, membresías): fuera.
    // Opcional = autoría en una empresa que sigue (creó la factura, subió el archivo): queda sin nombre
    if (nullable) await tx.execute(sql`UPDATE ${sql.identifier(t)} SET ${sql.identifier(c)} = NULL WHERE ${sql.identifier(c)} = ${userId}`)
    else await tx.execute(sql`DELETE FROM ${sql.identifier(t)} WHERE ${sql.identifier(c)} = ${userId}`)
  }
  await tx.execute(sql`DELETE FROM users WHERE id = ${userId}`)
}

/** Tablas hijas sin company_id ni user_id: [hija, columna, madre, columna de la madre por la que se borra] */
const HIJAS = Object.freeze([
  ['sales_document_lines', 'document_id', 'sales_documents', 'company_id'],
  ['expense_tax_lines', 'expense_id', 'expenses', 'company_id'],
  ['series_counters', 'series_id', 'series', 'company_id'],
  ['ai_messages', 'conversation_id', 'ai_conversations', 'company_id'],
  ['ai_messages', 'conversation_id', 'ai_conversations', 'user_id'],
] as const)
