import { z } from 'zod'

type Company = typeof tables.companies.$inferSelect

/**
 * Cobro online sin pasarela propia: el enlace de pago del usuario (Stripe Payment Link, PayPal.me,
 * Revolut, SumUp…) y su teléfono de Bizum. Salen en la página pública de cada factura pendiente.
 */
export function onlinePaymentsOf(company: Pick<Company, 'settings'>): OnlinePayments {
  const p = (company.settings as { payments?: Partial<OnlinePayments> } | null)?.payments ?? {}
  return { link: p.link ?? null, linkLabel: p.linkLabel ?? null, bizum: p.bizum ?? null }
}

export const onlinePaymentsSchema = z.object({
  link: z.string().trim().max(500).nullish().transform(v => v || null)
    .refine(v => !v || /^https:\/\/[^\s]+\.[^\s]+/i.test(v), 'El enlace debe empezar por https://'),
  linkLabel: z.string().trim().max(40).nullish().transform(v => v || null),
  bizum: z.string().trim().max(20).nullish()
    .transform(v => (v ? v.replace(/[\s.-]/g, '') : null))
    .refine(v => !v || /^(\+34)?[67]\d{8}$/.test(v), 'Escribe un móvil español (6xx xxx xxx o 7xx xxx xxx)'),
})

export interface OnlinePayments {
  link: string | null
  /** «Tarjeta», «PayPal»… (si no, «Pagar online») */
  linkLabel: string | null
  bizum: string | null
}
