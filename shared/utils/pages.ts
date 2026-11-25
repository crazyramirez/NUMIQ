/**
 * Páginas adicionales de facturas y presupuestos (condiciones generales, memoria del proyecto, fotos…):
 * cada página lleva un título y bloques de texto con formato o imágenes, en el orden elegido. Se guardan
 * como datos, nunca como HTML: la hoja, la página pública y el PDF las pintan cada uno a su manera.
 */

export type PageImageSize = 's' | 'm' | 'l' | 'full'
export type PageAlign = 'left' | 'center' | 'right'

export interface PageText {
  id: string
  k: 'text'
  doc: RichDoc | null
}

export interface PageImage {
  id: string
  k: 'image'
  /** Nombre del archivo en la carpeta de imágenes de páginas de la empresa */
  img: string
  /** Tamaño en píxeles (para reservar el hueco y mantener la proporción) */
  w: number
  h: number
  size: PageImageSize
  align: PageAlign
  caption?: string | null
}

export type PageBlock = PageText | PageImage

export interface DocPage {
  id: string
  title: string
  blocks: PageBlock[]
}

/** Plantilla de página guardada para reutilizarla (unas condiciones generales, por ejemplo) */
export interface PageTemplate {
  id: string
  name: string
  page: DocPage
  updatedAt: string
}

/** Identificador corto para páginas y bloques (solo distingue elementos dentro del documento) */
export function pageId() {
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0')
}

export function blockIsEmpty(b: PageBlock) {
  return b.k === 'text' ? richIsEmpty(b.doc) : !b.img
}

export function pageIsEmpty(p: DocPage) {
  return !p.title.trim() && p.blocks.every(blockIsEmpty)
}

/**
 * Limpia las páginas antes de guardarlas: textos normalizados, bloques de texto vacíos y páginas sin
 * nada fuera. Sin páginas: null.
 */
export function cleanPages(pages: DocPage[] | null | undefined): DocPage[] | null {
  if (!pages?.length) return null
  const out: DocPage[] = []
  for (const p of pages) {
    const blocks: PageBlock[] = []
    for (const b of p.blocks) {
      if (b.k === 'text') {
        const doc = normalizeRich(b.doc)
        if (doc) blocks.push({ id: b.id, k: 'text', doc })
      }
      else if (b.img) {
        blocks.push({ id: b.id, k: 'image', img: b.img, w: b.w, h: b.h, size: b.size, align: b.align, caption: b.caption?.trim() || null })
      }
    }
    const page = { id: p.id, title: p.title.trim(), blocks }
    if (!pageIsEmpty(page)) out.push(page)
  }
  return out.length ? out : null
}

/** Imágenes que usan las páginas (para servirlas en el enlace público solo si son de ese documento) */
export function pageImages(pages: DocPage[] | null | undefined): string[] {
  return (pages ?? []).flatMap(p => p.blocks.flatMap(b => (b.k === 'image' ? [b.img] : [])))
}

/** Texto plano de las páginas: asistente, búsquedas y resúmenes */
export function pagesToPlain(pages: DocPage[] | null | undefined) {
  return (pages ?? []).map(p => [
    p.title,
    ...p.blocks.map(b => (b.k === 'text' ? richToPlain(b.doc) : `[Imagen${b.caption ? `: ${b.caption}` : ''}]`)),
  ].filter(Boolean).join('\n')).join('\n\n').trim()
}

/** Copia de una página con identificadores nuevos (duplicar, insertar una plantilla) */
export function clonePage(p: DocPage): DocPage {
  return { id: pageId(), title: p.title, blocks: p.blocks.map(b => ({ ...structuredClone(b), id: pageId() })) }
}

// Constantes al final: el escáner de auto-importaciones se salta lo que va detrás de un literal
/** Nombre de una imagen de página: lo genera el servidor al subirla (sin rutas ni nada más) */
export const PAGE_IMAGE_RE = /^[a-z0-9]{4,16}-[a-f0-9]{12}\.(?:png|jpg)$/

/** Ancho de la imagen respecto al de la hoja */
export const PAGE_IMAGE_WIDTH: Record<PageImageSize, number> = { s: 0.34, m: 0.5, l: 0.75, full: 1 }
