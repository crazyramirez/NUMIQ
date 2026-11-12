/** Campos de texto con asistente de redacción (✨ IA): cada uno tiene sus instrucciones en server/api/ai/write.post.ts */
export type AiField =
  | 'sales_description' | 'sales_concept' | 'sales_notes' | 'sales_terms'
  | 'expense_concept' | 'expense_notes' | 'recurring_concept' | 'recurring_notes'
  | 'item_description' | 'contact_notes' | 'default_notes' | 'default_terms' | 'payment_text' | 'email_message'

export type AiContextValue = string | number | boolean | null | undefined | string[]

/** Lo que se pasa a UiInput / UiTextarea (`:ai`) para que muestren «✨ IA» junto a la etiqueta */
export interface AiAssist {
  field: AiField
  /** Datos del documento para orientar a la IA; se leen al pulsar */
  context?: () => Record<string, AiContextValue>
  /** Qué usa para redactar desde cero */
  writeHint?: string
}
