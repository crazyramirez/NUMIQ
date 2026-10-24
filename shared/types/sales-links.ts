export interface SalesInvoiceLink {
  id: number
  number: string | null
  status: string
}

/** Presupuesto del que sale una factura */
export interface SalesSourceLink {
  id: number
  number: string | null
  kind: string
  status: string
}

/** Un indicio a favor (ok) o en contra (warn) de que presupuesto y factura vayan juntos */
export interface LinkReason {
  text: string
  tone: 'ok' | 'warn'
}

/** Documento del otro lado (factura para un presupuesto, presupuesto para una factura) que podría ir con él */
export interface LinkCandidate {
  id: number
  kind: string
  number: string | null
  status: string
  issueDate: string
  total: number
  taxBase: number
  contactName: string | null
  concept: string | null
  /** 0–100: la confianza de la IA si la revisó; si no, la de los indicios */
  score: number
  reasons: LinkReason[]
  /** La IA lo revisó: su explicación */
  ai: { reason: string } | null
  /** Ya vinculado a otro documento: la factura con otro presupuesto */
  linkedTo: { id: number, number: string | null } | null
  /** Ya vinculados entre sí */
  linked: boolean
}

export interface LinkCandidatesResult {
  candidates: LinkCandidate[]
  /** La IA revisó la lista (false si no está configurada, falló o no se pidió) */
  reviewed: boolean
  aiError: string | null
}
