import { z } from 'zod'

const span = z.object({
  t: z.string().max(8000),
  b: z.boolean().optional(),
  i: z.boolean().optional(),
  u: z.boolean().optional(),
}).strict()

const spans = z.array(span).max(1000)

/** Texto con formato que llega del navegador: solo bloques conocidos, sin HTML; vacío → null */
function richDocOf(maxChars: number, tooLong: string) {
  return z.array(z.union([
    z.object({ k: z.enum(['p', 'h']), c: spans }).strict(),
    z.object({ k: z.enum(['ul', 'ol']), items: z.array(spans).max(300) }).strict(),
  ])).max(300)
    .superRefine((doc, ctx) => {
      if (richToPlain(doc).length > maxChars) ctx.addIssue({ code: 'custom', message: `${tooLong}: máximo ${maxChars} caracteres` })
    })
    .transform(doc => normalizeRich(doc))
}

export const richDocSchema = richDocOf(8000, 'La descripción es demasiado larga')

const blockId = z.string().regex(/^[a-z0-9]{4,16}$/)

/**
 * Páginas adicionales del documento: título y bloques de texto o imagen. Las imágenes se nombran por
 * su archivo en la carpeta de la empresa (sin rutas), así que nunca apuntan a archivos de otra.
 */
export const docPageSchema = z.object({
  id: blockId,
  title: z.string().trim().max(160, 'El título de la página es demasiado largo').default(''),
  blocks: z.array(z.discriminatedUnion('k', [
    z.object({ id: blockId, k: z.literal('text'), doc: richDocOf(20_000, 'El texto de la página es demasiado largo').nullable() }).strict(),
    z.object({
      id: blockId,
      k: z.literal('image'),
      img: z.string().regex(PAGE_IMAGE_RE, 'Imagen no válida'),
      w: z.number().int().min(1).max(20_000),
      h: z.number().int().min(1).max(20_000),
      size: z.enum(['s', 'm', 'l', 'full']).default('full'),
      align: z.enum(['left', 'center', 'right']).default('center'),
      caption: z.string().trim().max(300).nullish(),
    }).strict(),
  ])).max(60, 'Máximo 60 bloques por página'),
}).strict()

export const docPagesSchema = z.array(docPageSchema).max(10, 'Máximo 10 páginas adicionales')
  .transform(pages => cleanPages(pages as DocPage[]))
