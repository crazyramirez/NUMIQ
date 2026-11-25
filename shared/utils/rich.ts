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
  return linesToRich(text, t => [{ t }])
}

/** Como plainToRich, pero además **negrita** y *cursiva* dentro de cada línea (lo que devuelve la IA) */
export function markdownToRich(text: string | null | undefined): RichDoc | null {
  return linesToRich(text, inlineMarkdown)
}

/** Bloques → texto con las mismas marcas que entiende markdownToRich (para pasárselo a la IA y volver) */
export function richToMarkdown(doc: RichDoc | null | undefined): string {
  if (!doc) return ''
  const md = (spans: RichSpan[]) => spans.map(s => (s.b ? `**${s.t}**` : s.i ? `*${s.t}*` : s.t)).join('')
  return doc.map((b) => {
    if (b.k === 'h') return `## ${md(b.c)}`
    if (b.k === 'p') return md(b.c)
    return b.items.map((it, n) => `${b.k === 'ol' ? `${n + 1}.` : '-'} ${md(it)}`).join('\n')
  }).join('\n').trim()
}

function inlineMarkdown(text: string): RichSpan[] {
  const out: RichSpan[] = []
  const re = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|__([^_]+)__/g
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ t: text.slice(last, m.index) })
    if (m[2] !== undefined) out.push({ t: m[2], i: true })
    else out.push({ t: (m[1] ?? m[3])!, b: true })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ t: text.slice(last) })
  return out
}

/**
 * Texto pegado sin estructura (un PDF, un correo en texto plano) → bloques. Un PDF corta cada línea con
 * un salto: las líneas que siguen la misma frase se vuelven a unir en su párrafo (y «condi-\nciones»
 * en «condiciones»), las viñetas del PDF (•, , ▪…) son listas, los títulos en mayúsculas subtítulos,
 * las líneas en blanco separan párrafos (nunca párrafos vacíos) y los números de página sobran.
 */
export function pastedTextToRich(text: string | null | undefined): RichDoc | null {
  if (!text?.trim()) return null
  const lines = text
    .replace(/\r\n?/g, '\n')
    .replace(/\f/g, '\n\n')
    .replace(/­/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000E-\u001F]/g, '')
    .split('\n')
    .map(l => l.replace(/[ \t  -​]+/g, ' ').trim())
  const filled = lines.filter(Boolean)
  // Ancho de línea del texto: el de las líneas largas (percentil 90). Un PDF ronda 60-130 caracteres
  const lens = filled.filter(l => !listLine(l)).map(l => l.length).sort((a, b) => a - b)
  const width = lens[Math.floor((lens.length - 1) * 0.9)] ?? 0
  const wrapped = filled.length >= 3 && width >= 30 && width <= 160
  const pageNo = /^(?:p[áa]g(?:ina)?\.?\s*)?\d{1,3}(?:\s*(?:de|\/|of)\s*\d{1,3})?$/i

  type Item = { k: 'p' | 'h' | 'ul' | 'ol', t: string, last: string }
  const items: Item[] = []
  let cur: Item | null = null
  for (const line of lines) {
    if (!line || (wrapped && filled.length >= 5 && pageNo.test(line))) {
      cur = null
      continue
    }
    const md = /^#{1,6}\s+(.+)$/.exec(line)
    const li = listLine(line)
    const caps = wrapped && isCapsTitle(li?.k === 'ol' ? li.t : line)
    if (md || caps) {
      items.push({ k: 'h', t: md ? md[1]! : line, last: line })
      cur = null
      continue
    }
    if (li) {
      cur = { k: li.k, t: li.t, last: line }
      items.push(cur)
      continue
    }
    if (cur && wrapped) {
      const prev = cur.last
      const longPrev = prev.length >= width * 0.65
      const continues = !/[.:;!?…»"”)]$/.test(prev) && /^[a-záéíóúüñç(«"“,;\d]/.test(line)
      if (longPrev || continues) {
        cur.t = /[a-záéíóúüñç]-$/i.test(cur.t) && /^[a-záéíóúüñç]/.test(line) ? cur.t.slice(0, -1) + line : `${cur.t} ${line}`
        cur.last = line
        continue
      }
    }
    cur = { k: 'p', t: line, last: line }
    items.push(cur)
  }

  const out: RichDoc = []
  for (const it of items) {
    const c = [{ t: it.t }]
    if (it.k === 'p' || it.k === 'h') {
      out.push({ k: it.k, c })
      continue
    }
    const prev = out.at(-1)
    if (prev && prev.k === it.k) prev.items.push(c)
    else out.push({ k: it.k, items: [c] })
  }
  return normalizeRich(out)
}

/** Viñeta o número al principio de una línea (también los símbolos privados que usan Word y los PDF) */
function listLine(line: string): { k: 'ul' | 'ol', t: string } | null {
  const b = /^(?:[-•◦▪▫●○■□*·–—►▶✓✔]|[])\s+(.+)$/.exec(line)
  if (b) return { k: 'ul', t: b[1]!.trim() }
  const n = /^\d{1,2}[.)]\s+(.+)$/.exec(line)
  return n ? { k: 'ol', t: n[1]!.trim() } : null
}

/** «CONDICIONES GENERALES», «1. OBJETO DEL CONTRATO»: corto, con letras y todo en mayúsculas */
function isCapsTitle(t: string) {
  const letters = t.replace(/[^a-záéíóúüñç]/gi, '')
  return t.length <= 90 && letters.length >= 3 && letters === letters.toUpperCase() && letters !== letters.toLowerCase() && !/[.,;]$/.test(t)
}

function linesToRich(text: string | null | undefined, spans: (line: string) => RichSpan[]): RichDoc | null {
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
      const item = spans((bullet ?? numbered)![1]!.trim())
      const last = out.at(-1)
      if (last && (last.k === 'ul' || last.k === 'ol') && last.k === k) last.items.push(item)
      else out.push({ k, items: [item] })
    }
    else if (heading) out.push({ k: 'h', c: spans(heading[1]!.trim()) })
    else out.push({ k: 'p', c: spans(line) })
  }
  return normalizeRich(out)
}
