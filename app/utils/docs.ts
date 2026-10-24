import type { Tone } from './labels'

/** Textos de la importación con IA y del archivo trimestral */

export function vaultFolder(key: string | null | undefined) {
  return VAULT_FOLDERS.find(f => f.key === key) ?? { key: key ?? 'otros', label: key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Otros', icon: 'ph:folder-simple', hint: '' }
}

/** 12,4 MB */
export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${num(Math.round(bytes / 102.4) / 10)} KB`
  return `${num(Math.round(bytes / 104857.6) / 10)} MB`
}

export function fileIcon(name: string, mime?: string | null) {
  const n = name.toLowerCase()
  if (mime === 'application/pdf' || n.endsWith('.pdf')) return 'ph:file-pdf'
  if (/^image\//.test(mime ?? '') || /\.(png|jpe?g|webp|heic)$/.test(n)) return 'ph:image'
  if (/\.(xlsx?|ods|csv|tsv)$/.test(n)) return 'ph:file-xls'
  if (/\.(docx?|odt)$/.test(n)) return 'ph:file-doc'
  if (n.endsWith('.zip')) return 'ph:file-zip'
  if (n.endsWith('.xml')) return 'ph:file-code'
  return 'ph:file'
}

export const IMPORT_STATUS: Record<string, { label: string, tone: Tone, icon: string }> = {
  ready: { label: 'Listo', tone: 'success', icon: 'ph:check-circle-fill' },
  warning: { label: 'Revisar', tone: 'warning', icon: 'ph:warning-fill' },
  duplicate: { label: 'Duplicado', tone: 'info', icon: 'ph:copy' },
  error: { label: 'Incompleto', tone: 'danger', icon: 'ph:x-circle-fill' },
  imported: { label: 'Importado', tone: 'brand', icon: 'ph:check-fat-fill' },
  excluded: { label: 'Excluido', tone: 'neutral', icon: 'ph:prohibit' },
}

export const IMPORT_TYPE: Record<string, { label: string, icon: string }> = {
  sales: { label: 'Emitida', icon: 'ph:receipt' },
  expense: { label: 'Recibida', icon: 'ph:wallet' },
  contact: { label: 'Contacto', icon: 'ph:address-book' },
  item: { label: 'Producto', icon: 'ph:package' },
  vault: { label: 'Archivo', icon: 'ph:archive' },
  quote: { label: 'Presupuesto', icon: 'ph:file-text' },
}

// Al final y congelado: el escáner de auto-imports se salta la exportación que sigue a un array
export const VAULT_FOLDERS: ReadonlyArray<{ key: string, label: string, icon: string, hint: string }> = Object.freeze([
  { key: 'banco', label: 'Banco', icon: 'ph:bank', hint: 'Extractos y movimientos' },
  { key: 'legal', label: 'Legal', icon: 'ph:scales', hint: 'Contratos, escrituras, poderes' },
  { key: 'nominas', label: 'Nóminas', icon: 'ph:users-three', hint: 'Nóminas y seguros sociales' },
  { key: 'impuestos', label: 'Impuestos', icon: 'ph:stamp', hint: 'Modelos y justificantes' },
  { key: 'seguros', label: 'Seguros', icon: 'ph:shield-check', hint: 'Pólizas y recibos' },
  { key: 'otros', label: 'Otros', icon: 'ph:folder-simple', hint: 'Lo que quieras guardar' },
])
