import { z } from 'zod'

const span = z.object({
  t: z.string().max(8000),
  b: z.boolean().optional(),
  i: z.boolean().optional(),
  u: z.boolean().optional(),
}).strict()

const spans = z.array(span).max(1000)

/** Texto con formato que llega del navegador: solo bloques conocidos, sin HTML; vacío → null */
export const richDocSchema = z.array(z.union([
  z.object({ k: z.enum(['p', 'h']), c: spans }).strict(),
  z.object({ k: z.enum(['ul', 'ol']), items: z.array(spans).max(300) }).strict(),
])).max(300)
  .superRefine((doc, ctx) => {
    if (richToPlain(doc).length > 8000) ctx.addIssue({ code: 'custom', message: 'La descripción es demasiado larga: máximo 8000 caracteres' })
  })
  .transform(doc => normalizeRich(doc))
