import type { H3Event } from 'h3'
import { z } from 'zod'

type Company = typeof tables.companies.$inferSelect

/**
 * Lo que el gestor puede subir a la empresa que lo invita (Ajustes → Equipo). Por lo demás solo consulta:
 * nunca crea, cambia ni borra facturas, gastos, contactos ni ajustes.
 * - payroll: nóminas en el archivo
 * - taxes: modelos presentados (registrar la presentación y su justificante) y el archivo de impuestos
 * - bank: extractos del banco (importar movimientos y archivarlos)
 * - archive: el resto del archivo (contratos, seguros, otros…)
 */
export const advisorAccessSchema = z.object({
  payroll: z.boolean(),
  taxes: z.boolean(),
  bank: z.boolean(),
  archive: z.boolean(),
})

export type AdvisorAccess = z.infer<typeof advisorAccessSchema>
export type AdvisorAccessKey = keyof AdvisorAccess

/** Lo habitual: el gestor lleva las nóminas y presenta los impuestos */
const DEFAULT_ACCESS: AdvisorAccess = { payroll: true, taxes: true, bank: false, archive: false }

export function advisorAccess(company: Pick<Company, 'settings'>): AdvisorAccess {
  const saved = (company.settings as { advisorAccess?: Partial<AdvisorAccess> } | null)?.advisorAccess
  return { ...DEFAULT_ACCESS, ...saved }
}

/** Permiso que hace falta para subir a una carpeta del archivo */
export function vaultFolderAccess(folder: string): AdvisorAccessKey {
  if (folder === 'nominas') return 'payroll'
  if (folder === 'impuestos') return 'taxes'
  if (folder === 'banco') return 'bank'
  return 'archive'
}

const DENIED: Record<AdvisorAccessKey, string> = {
  payroll: 'subir nóminas',
  taxes: 'registrar impuestos',
  bank: 'importar extractos del banco',
  archive: 'subir documentos a esa carpeta',
}

/** ¿Puede este rol hacerlo? Miembros y administradores, siempre; el gestor, si la empresa se lo permite */
export const advisorCan = (company: Pick<Company, 'settings'>, role: string, key: AdvisorAccessKey) => role !== 'advisor' || advisorAccess(company)[key]

/** requireCompany que deja pasar al gestor solo con ese permiso */
export async function requireCompanyOrAdvisor(event: H3Event, key: AdvisorAccessKey) {
  const ctx = await requireCompany(event, 'advisor')
  assertAdvisorCan(ctx.company, ctx.role, key)
  return ctx
}

export function assertAdvisorCan(company: Pick<Company, 'settings'>, role: string, key: AdvisorAccessKey) {
  if (!advisorCan(company, role, key)) {
    throw createError({ statusCode: 403, statusMessage: `Tu rol (gestor) no permite ${DENIED[key]}: pídeselo al titular en Ajustes → Equipo` })
  }
}

/**
 * Cambiar o borrar un documento del archivo: el gestor, solo lo que subió él, en carpetas que tiene
 * permitidas (y si lo mueve, a otra permitida). Lo de la empresa no lo toca.
 */
export function assertOwnAdvisorFile(company: Pick<Company, 'settings'>, role: string, userId: number, file: { folder: string | null, uploadedBy: number | null }, moveTo?: string) {
  if (role !== 'advisor') return
  if (file.uploadedBy !== userId) throw createError({ statusCode: 403, statusMessage: 'Tu rol (gestor) solo permite cambiar o borrar los documentos que has subido tú' })
  assertAdvisorCan(company, role, vaultFolderAccess(file.folder ?? 'otros'))
  if (moveTo) assertAdvisorCan(company, role, vaultFolderAccess(moveTo))
}
