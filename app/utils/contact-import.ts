import type { ContactImportRow } from '#shared/types/contact-import'
import type { ContactDraftField } from '#shared/utils/contact-clean'

/** Estado de una fila en la revisión de la importación de contactos */
export type ContactRowStatus = 'ready' | 'warning' | 'error' | 'existing' | 'merged' | 'skipped'

export function contactRowStatus(r: ContactImportRow): ContactRowStatus {
  if (r.action === 'skip') return r.mergedInto ? 'merged' : 'skipped'
  if (r.issues.some(i => i.level === 'error')) return 'error'
  if (r.match) return 'existing'
  return r.issues.length ? 'warning' : 'ready'
}

/** Cambios automáticos que conviene mirar (no los de forma: mayúsculas, puntos…) */
export const contactRowChanges = (r: ContactImportRow) => r.changes.filter(c => !c.minor)

export const CONTACT_FIELD_LABELS: Readonly<Record<ContactDraftField, string>> = Object.freeze({
  kind: 'Tipo', name: 'Nombre', tradeName: 'Nombre comercial', contactPerson: 'Persona de contacto', nif: 'NIF', email: 'Email',
  phone: 'Teléfono', website: 'Web', address: 'Dirección', postalCode: 'Código postal', city: 'Población', province: 'Provincia',
  country: 'País', iban: 'IBAN', paymentTermsDays: 'Plazo de pago', irpfRate: 'Retención IRPF', notes: 'Notas',
})

/** Valor de un cambio para enseñarlo («Persona» en vez de «person») */
export function contactChangeValue(field: ContactDraftField, v: string | null) {
  if (v == null || v === '') return 'vacío'
  if (field === 'kind') return v === 'person' ? 'Persona' : 'Empresa'
  return v
}
