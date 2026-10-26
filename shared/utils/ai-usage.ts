/**
 * Para qué se usó la IA: categorías del desglose de costes (Ajustes → Inteligencia artificial). El orden es el
 * de apilado en el gráfico y cada una lleva siempre su color (paleta validada para daltonismo en ese orden).
 */
export const AI_CATEGORIES = {
  asistente: { label: 'Asistente', icon: 'ph:chat-circle-dots', color: 'var(--chart-c1)' },
  importacion: { label: 'Importación de documentos', icon: 'ph:files', color: 'var(--chart-c2)' },
  escaneo: { label: 'Escaneo de documentos', icon: 'ph:scan', color: 'var(--chart-c3)' },
  banco: { label: 'Banco', icon: 'ph:bank', color: 'var(--chart-c4)' },
  contactos: { label: 'Contactos', icon: 'ph:address-book', color: 'var(--chart-c5)' },
  correo: { label: 'Facturas del correo', icon: 'ph:envelope-simple', color: 'var(--chart-c6)' },
  impuestos: { label: 'Impuestos', icon: 'ph:receipt', color: 'var(--chart-c7)' },
  otros: { label: 'Otros', icon: 'ph:dots-three-circle', color: 'var(--chart-c8)' },
} as const

export type AiCategory = keyof typeof AI_CATEGORIES

/** Tarea concreta dentro de la categoría (el nombre del esquema de la respuesta) */
export const AI_TASKS: Record<string, string> = {
  documentos: 'Lectura de facturas y tickets',
  hojas: 'Análisis de hojas de cálculo',
  asistente: 'Respuestas del asistente',
  bank_categories: 'Clasificación de movimientos',
  bank_columns: 'Columnas de extractos',
  contactos: 'Lectura de contactos',
  columnas_contactos: 'Columnas de listados de contactos',
  revision_contactos: 'Revisión de contactos importados',
  contacto: 'Ficha de contacto desde archivo',
  justificante: 'Justificantes de presentación',
  vinculo_presupuesto: 'Vincular presupuestos y facturas',
  bank_invoices: 'Conciliar movimientos con facturas',
}

export const aiTaskLabel = (task: string) => AI_TASKS[task] ?? task.replace(/_/g, ' ')
export const aiCategoryOf = (id: string) => AI_CATEGORIES[id as AiCategory] ?? AI_CATEGORIES.otros

/**
 * Importe de IA con los decimales que necesita: una lectura cuesta décimas de céntimo (0,0043 €), un mes
 * entero euros. `short`: sin ceros a la derecha (ejes del gráfico).
 */
export function aiMoney(v: number, currency: 'eur' | 'usd', short = false) {
  const abs = Math.abs(v)
  const digits = abs === 0 ? 2 : abs < 0.01 ? 4 : abs < 1 ? 3 : 2
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: short ? 0 : digits,
    maximumFractionDigits: digits,
    useGrouping: 'always',
  }).format(v)
}

/** 12,3 mil tokens */
export const aiTokens = (n: number) => new Intl.NumberFormat('es-ES', { notation: n >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1, useGrouping: 'always' }).format(n)

export type AiUsageGroup = 'day' | 'week' | 'month'

export interface AiUsageTotals {
  usd: number
  eur: number
  calls: number
  input: number
  cached: number
  output: number
  reasoning: number
  /** Coste reconstruido de antes de registrar cada llamada */
  estimatedUsd: number
  estimatedEur: number
  /** Parte estimada que son respuestas del asistente cortadas a medias (OpenAI las cobra sin decir cuánto) */
  cutUsd: number
  cutEur: number
  errors: number
}

export interface AiUsageRow extends AiUsageTotals {
  key: string
}

export interface AiUsageReport {
  /** key: lo pagado con la clave de OpenAI de quien mira (todas sus empresas), lo comparable con su uso en OpenAI */
  scope: 'company' | 'key' | 'app'
  canSeeApp: boolean
  /** «sk-proj-…a1b2» de la clave propia de quien mira */
  keyHint: string | null
  /** Desde cuándo cada llamada guarda la clave que la pagó (lo anterior no sale en «Mi clave») */
  keySince: string | null
  from: string
  to: string
  group: AiUsageGroup
  /** Dólares por euro (BCE) con que se convierte lo que no trae su propio cambio */
  usdPerEur: number | null
  totals: AiUsageTotals
  previous: AiUsageTotals
  series: Array<{ key: string, from: string, to: string, usd: number, eur: number, calls: number, byCategory: Record<string, AiMoney> }>
  categories: AiUsageRow[]
  tasks: Array<AiUsageRow & { category: string, task: string }>
  models: AiUsageRow[]
  users: Array<AiUsageRow & { name: string }>
  companies: Array<AiUsageRow & { name: string }>
  recent: Array<{ id: number, at: string, category: string, task: string, model: string, input: number, cached: number, output: number, reasoning: number, usd: number, eur: number, ms: number, ok: boolean, estimated: boolean, user: string | null }>
  kpis: {
    today: AiMoney
    last7: AiMoney
    month: AiMoney
    /** Ritmo del mes en curso llevado a sus días */
    monthProjection: AiMoney
    allTime: AiMoney
    /** Coste medio por documento leído y por respuesta del asistente, en el periodo */
    perDocument: AiMoney | null
    perAnswer: AiMoney | null
    /** Parte de la entrada servida desde la caché de OpenAI (90 % más barata), en el periodo */
    cacheRate: number | null
  }
  /** Primera llamada registrada con su coste exacto (lo anterior es estimado) */
  exactSince: string | null
  /** USD por millón de tokens */
  prices: Array<{ model: string, input: number, cached: number, output: number }>
}

export interface AiMoney { usd: number, eur: number }
