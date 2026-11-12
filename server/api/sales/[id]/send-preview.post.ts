import { z } from 'zod'

const schema = z.object({
  subject: z.string().max(200).default(''),
  message: z.string().max(5000).default(''),
  kind: z.enum(['document', 'reminder']).default('document'),
  attachPdf: z.boolean().default(true),
})

/**
 * Vista previa del correo de la ventana «Enviar»: el mismo HTML que recibirá el cliente, con la firma.
 * La imagen de la firma, que en el correo va como adjunto en línea (cid:), aquí va incrustada.
 */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event)
  const id = idParam(event)
  const input = await readInput(event, schema)
  const doc = await loadSalesDocument(company.id, id)
  const site = useRuntimeConfig().siteUrl || getRequestURL(event, { xForwardedProto: true }).origin
  const { html, signature } = await salesEmailBody(company, doc, { ...input, subject: input.subject.trim() || '(Sin asunto)', message: input.message.trim() }, site)
  const img = signature?.image
  return {
    html: img ? html.replaceAll(`cid:${SIGNATURE_CID}`, `data:${img.mime};base64,${img.content.toString('base64')}`) : html,
    from: company.tradeName || company.legalName,
    replyTo: company.email ?? null,
  }
})
