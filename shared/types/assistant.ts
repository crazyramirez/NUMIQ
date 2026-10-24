/** Operaciones que propone el asistente sobre los datos y que el usuario confirma en el chat */

/** Fila de la vista previa: qué registro cambia y cómo */
export type AiActionRow = {
  id: number
  label: string
  sub?: string | null
  amount?: number | null
  before?: string | null
  after?: string | null
  url?: string | null
}

export type AiActionPreview = {
  /** Qué cambia, en una línea («Galván → Navlag») */
  change: string | null
  /** A quién alcanza el filtro («Clientes: Galván Asesores SL, José Galván») */
  scope?: string | null
  count: number
  /** Importe total afectado (con impuestos), si tiene sentido */
  total: number | null
  rows: AiActionRow[]
  warnings: string[]
  undoable: boolean
}

export type AiActionSkipped = Array<{ id: number, label: string, reason: string }>

export type AiActionResult = {
  done: number
  skipped: AiActionSkipped
  /** Enlace para ver lo creado o lo cambiado */
  url?: string | null
  message?: string | null
  /** Resultado de deshacerla */
  reverted?: { done: number, skipped: AiActionSkipped, message?: string | null } | null
}

export type AiActionStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled' | 'expired' | 'undoing' | 'undone'

/** Lo que ve la app de una propuesta */
export interface AiActionView {
  id: number
  kind: string
  title: string
  risk: 'normal' | 'high'
  status: AiActionStatus
  preview: AiActionPreview
  result: AiActionResult | null
  error: string | null
  messageId: number | null
  canUndo: boolean
}
