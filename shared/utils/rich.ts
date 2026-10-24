/**
 * Texto con formato (descripción de facturas y presupuestos). Se guarda como bloques, nunca como HTML:
 * la hoja en pantalla, la página pública y el PDF lo pintan cada uno a su manera y sin riesgo de inyección.
 */

export interface RichSpan {
  t: string
  b?: boolean
  i?: boolean
  u?: boolean
}

export type RichBlock =
  | { k: 'p', c: RichSpan[] }
  | { k: 'h', c: RichSpan[] }
  | { k: 'ul', items: RichSpan[][] }
  | { k: 'ol', items: RichSpan[][] }

export type RichDoc = RichBlock[]

export function richIsEmpty(doc: RichDoc | null | undefined) {
  return !doc?.some(b => ('c' in b ? spansText(b.c) : b.items.map(spansText).join('')).trim())
}

export function spansText(spans: RichSpan[]) {
  return spans.map(s => s.t).join('')
}

/** Texto plano: correos, búsquedas, asistente */
export function richToPlain(doc: RichDoc | null | undefined) {
  if (!doc) return ''
  return doc.map((b) => {
    if ('c' in b) return spansText(b.c)
    return b.items.map((it, n) => `${b.k === 'ol' ? `${n + 1}.` : '•'} ${spansText(it)}`).join('\n')
  }).join('\n').trim()
}

/** Une tramos seguidos con el mismo formato y quita los vacíos */
export function mergeSpans(spans: RichSpan[]): RichSpan[] {
  const out: RichSpan[] = []
  for (const s of spans) {
    if (!s.t) continue
    const last = out.at(-1)
    if (last && !!last.b === !!s.b && !!last.i === !!s.i && !!last.u === !!s.u) last.t += s.t
    else out.push({ t: s.t, ...(s.b ? { b: true } : {}), ...(s.i ? { i: true } : {}), ...(s.u ? { u: true } : {}) })
  }
  return out
}

/** Limpia un documento: tramos unidos, bloques vacíos fuera (sin bloques: null) */
export function normalizeRich(doc: RichDoc | null | undefined): RichDoc | null {
  if (!doc) return null
  const out: RichDoc = []
  for (const b of doc) {
    if ('c' in b) {
      const c = mergeSpans(b.c)
      // Un párrafo vacío entre otros es un espacio intencionado; al principio y al final sobra
      out.push({ k: b.k, c })
    }
    else {
      const items = b.items.map(mergeSpans).filter(it => spansText(it).trim())
      if (items.length) out.push({ k: b.k, items })
    }
  }
  const blank = (b: RichBlock) => 'c' in b && !spansText(b.c).trim()
  while (out.length && blank(out[0]!)) out.shift()
  while (out.length && blank(out.at(-1)!)) out.pop()
  return out.length ? out : null
}

/**
 * Texto plano con marcas sencillas → bloques: "## título", "- viñeta", "1. numerada"; cada línea,
 * un párrafo. Las líneas en blanco se ignoran (los bloques ya llevan su separación).
 */
export function plainToRich(text: string | null | undefined): RichDoc | null {
  if (!text?.trim()) return null
  const out: RichDoc = []
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const bullet = /^[-•*·–]\s+(.+)$/.exec(line)
    const numbered = bullet ? null : /^\d{1,2}[.)]\s+(.+)$/.exec(line)
    const heading = /^#{1,6}\s+(.+)$/.exec(line)
    if (bullet || numbered) {
      const k = bullet ? 'ul' : 'ol'
      const item: RichSpan[] = [{ t: (bullet ?? numbered)![1]!.trim() }]
      const last = out.at(-1)
      if (last && (last.k === 'ul' || last.k === 'ol') && last.k === k) last.items.push(item)
      else out.push({ k, items: [item] })
    }
    else if (heading) out.push({ k: 'h', c: [{ t: heading[1]!.trim() }] })
    else out.push({ k: 'p', c: [{ t: line }] })
  }
  return normalizeRich(out)
}
