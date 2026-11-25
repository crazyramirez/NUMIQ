/** Imágenes de las páginas adicionales: viven en la carpeta `pages` de cada empresa */

const pagePath = (companyId: number, name: string) => `${companyId}/pages/${name}`

export async function savePageImage(companyId: number, data: Buffer, ext: 'png' | 'jpg') {
  const rel = await saveCompanyFile(companyId, 'pages', data, ext)
  return rel.split('/').pop()!
}

/** La imagen (con su tipo) o null si el nombre no es válido o ya no existe */
export async function readPageImage(companyId: number, name: string) {
  if (!PAGE_IMAGE_RE.test(name)) return null
  const data = await readStoredFile(pagePath(companyId, name)).catch(() => null)
  const kind = data && detectImage(data)
  if (!data || !kind || kind.ext === 'svg') return null
  return { data, kind }
}

/** Páginas con sus imágenes en línea, para el PDF (una imagen que ya no existe no sale) */
export async function pdfPages(companyId: number, pages: DocPage[] | null | undefined): Promise<PdfPage[]> {
  if (!pages?.length) return []
  const cache = new Map<string, string | null>()
  const out: PdfPage[] = []
  for (const p of pages) {
    const blocks: PdfPage['blocks'] = []
    for (const b of p.blocks) {
      if (b.k === 'text') {
        if (b.doc?.length) blocks.push({ k: 'text', doc: b.doc })
        continue
      }
      if (!cache.has(b.img)) {
        const img = await readPageImage(companyId, b.img)
        cache.set(b.img, img ? `data:${img.kind.mime};base64,${img.data.toString('base64')}` : null)
      }
      const dataUrl = cache.get(b.img)
      if (dataUrl) blocks.push({ k: 'image', dataUrl, w: b.w, h: b.h, size: b.size, align: b.align, caption: b.caption ?? null })
    }
    if (p.title || blocks.length) out.push({ title: p.title, blocks })
  }
  return out
}
