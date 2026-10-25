import { z } from 'zod'

const emailList = z.string().trim().min(1, 'Indica al menos un destinatario').transform(s => s.split(/[,;\s]+/).filter(Boolean))
  .pipe(z.array(z.email('Hay un email no válido')).min(1, 'Indica al menos un destinatario').max(5, 'Máximo 5 destinatarios'))

const schema = z.object({
  to: emailList,
  cc: z.string().trim().max(500).optional().transform(s => (s ? s.split(/[,;\s]+/).filter(Boolean) : [])).pipe(z.array(z.email('Hay un email en copia no válido')).max(5)),
  subject: z.string().trim().min(1, 'Escribe un asunto').max(200),
  message: z.string().trim().min(1, 'Escribe un mensaje').max(5000),
  kind: z.enum(['document', 'reminder']).default('document'),
  attachPdf: z.boolean().default(true),
  /** Adjuntos del documento que viajan también en el correo (orden de pedido, albarán…) */
  attachmentIds: z.array(z.number().int().positive()).max(10).default([]),
  /** Documento original importado o escaneado del que sale la factura */
  attachOriginal: z.boolean().default(false),
})

/** Envía la factura o el presupuesto (o un recordatorio de pago) desde el Gmail de la app */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const input = await readInput(event, schema)
  const site = useRuntimeConfig().siteUrl || getRequestURL(event, { xForwardedProto: true }).origin
  const record = await sendSalesEmail(company, user.id, id, input, site)
  await audit(event, { companyId: company.id, userId: user.id, action: `sales.email.${input.kind}`, entity: 'sales_document', entityId: id, data: { to: record.to } })
  return { ok: true }
})
