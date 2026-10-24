import type { ContactChange, ContactDraft, ContactDraftField, ContactIssue } from '../utils/contact-clean'

/** Importación masiva de clientes y proveedores: lo que se leyó de cada archivo, listo para revisar */

/** Crear ficha nueva, completar los huecos de la existente, actualizarla con los datos del archivo o no importar */
export type ContactImportAction = 'create' | 'fill' | 'update' | 'skip'

export type ContactImportRole = 'client' | 'supplier' | 'both'

export interface ContactImportMatch {
  id: number
  name: string
  nif: string | null
  /** Mismo NIF: seguro que es el mismo contacto. Si no, coincide el nombre o el email */
  certain: boolean
  label: string
  isClient: boolean
  isSupplier: boolean
  /** Datos que la ficha no tiene y el archivo sí */
  fills: ContactDraftField[]
  /** Datos distintos en la ficha y en el archivo */
  conflicts: Array<{ field: ContactDraftField, current: string, incoming: string }>
}

export interface ContactImportRow {
  id: number
  /** «clientes.xlsx · fila 12», «listado.pdf · pág. 3» */
  source: string
  data: ContactDraft
  /** Lo que se leyó, antes de limpiarlo */
  original: Partial<ContactDraft>
  isClient: boolean
  isSupplier: boolean
  changes: ContactChange[]
  issues: ContactIssue[]
  match: ContactImportMatch | null
  /** Repetida en el archivo: sus datos se han unido a esta otra fila */
  mergedInto: number | null
  /** La IA dice que no es un contacto (cabecera repetida, total, título…) */
  notContact: string | null
  action: ContactImportAction
}

export interface ContactImportFile {
  name: string
  kind: 'sheet' | 'document' | 'text' | 'vcard'
  contacts: number
  /** Cómo se ha leído («Hoja Clientes: 230 filas, cabecera en la fila 2») */
  note: string | null
  error: string | null
}

export interface ContactImportResult {
  rows: ContactImportRow[]
  files: ContactImportFile[]
  /** Se ha usado la IA para entender las columnas y revisar los datos */
  ai: boolean
}

export type ContactImportPhase = 'read' | 'columns' | 'extract' | 'review' | 'postal' | 'match' | 'done'

export interface ContactImportJobView {
  id: string
  status: 'running' | 'done' | 'failed'
  phase: ContactImportPhase
  done: number
  total: number
  error: string | null
  result: ContactImportResult | null
}

export interface ContactImportCommitResult {
  importId: number
  created: number
  filled: number
  updated: number
  skipped: number
}

export interface ContactImportUndoResult {
  removed: number
  /** Creados que ya tienen facturas o gastos: se quedan */
  kept: number
  restored: number
}
