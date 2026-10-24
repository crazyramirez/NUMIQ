/**
 * Texto con formato ↔ HTML del editor (solo en el navegador). Lo que entra (lo escrito o lo pegado de
 * Word, Google Docs o una web) se reduce a bloques; lo que sale se construye escapando todo el texto.
 */

interface Marks { b?: boolean, i?: boolean, u?: boolean }

const BLOCK_TAGS = new Set(['P', 'DIV', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'ASIDE', 'MAIN', 'TABLE', 'TBODY', 'TR', 'TD', 'TH', 'FIGURE'])
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'HEAD', 'IMG', 'SVG', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'NOSCRIPT', 'TEMPLATE', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'])

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function spansToHtml(spans: RichSpan[]) {
  return spans.map((s) => {
    let h = esc(s.t).replace(/\n/g, '<br>')
    if (s.u) h = `<u>${h}</u>`
    if (s.i) h = `<i>${h}</i>`
    if (s.b) h = `<b>${h}</b>`
    return h
  }).join('')
}

export function richToHtml(doc: RichDoc | null | undefined) {
  if (!doc?.length) return ''
  return doc.map((b) => {
    if ('c' in b) {
      const tag = b.k === 'h' ? 'h3' : 'p'
      return `<${tag}>${spansToHtml(b.c) || '<br>'}</${tag}>`
    }
    return `<${b.k}>${b.items.map(it => `<li>${spansToHtml(it) || '<br>'}</li>`).join('')}</${b.k}>`
  }).join('')
}

function marksOf(e: HTMLElement, base: Marks): Marks {
  const m = { ...base }
  const tag = e.tagName
  if (tag === 'B' || tag === 'STRONG') m.b = true
  if (tag === 'I' || tag === 'EM') m.i = true
  if (tag === 'U' || tag === 'INS') m.u = true
  // Estilos en línea (Google Docs envuelve todo en <b style="font-weight:normal">)
  const st = e.style
  if (st?.fontWeight) m.b = st.fontWeight === 'bold' || st.fontWeight === 'bolder' || Number(st.fontWeight) >= 600
  if (st?.fontStyle) m.i = st.fontStyle === 'italic' || st.fontStyle === 'oblique'
  const deco = st?.textDecorationLine || st?.textDecoration
  if (deco) m.u = deco.includes('underline')
  return m
}

const clean = (t: string) => t.replace(/[\s ]+/g, ' ')

/** Quita saltos y espacios sobrantes al principio y al final de un bloque */
function trimEdges(spans: RichSpan[]): RichSpan[] {
  const out = spans.filter(s => s.t)
  while (out.length && !out[0]!.t.replace(/^[\n ]+/, '')) out.shift()
  while (out.length && !out.at(-1)!.t.replace(/[\n ]+$/, '')) out.pop()
  if (out.length) {
    out[0] = { ...out[0]!, t: out[0]!.t.replace(/^[\n ]+/, '') }
    out[out.length - 1] = { ...out.at(-1)!, t: out.at(-1)!.t.replace(/\n+$/, '') }
  }
  return out
}

function inlineNode(node: Node, marks: Marks, acc: RichSpan[]) {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = clean(node.nodeValue ?? '')
    if (t) acc.push({ t, ...marks })
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return
  const e = node as HTMLElement
  if (SKIP_TAGS.has(e.tagName)) return
  if (e.tagName === 'BR') {
    acc.push({ t: '\n' })
    return
  }
  const block = BLOCK_TAGS.has(e.tagName) || /^H[1-6]$/.test(e.tagName) || e.tagName === 'LI'
  if (block && acc.length && !acc.at(-1)!.t.endsWith('\n')) acc.push({ t: '\n' })
  const m = marksOf(e, marks)
  for (const ch of e.childNodes) inlineNode(ch, m, acc)
}

function listItems(list: Element, marks: Marks = {}): RichSpan[][] {
  const items: RichSpan[][] = []
  for (const li of list.children) {
    if (li.tagName === 'UL' || li.tagName === 'OL') {
      items.push(...listItems(li, marks))
      continue
    }
    const c: RichSpan[] = []
    const nested: Element[] = []
    for (const ch of li.childNodes) {
      if (ch.nodeType === Node.ELEMENT_NODE && /^(UL|OL)$/.test((ch as Element).tagName)) nested.push(ch as Element)
      else inlineNode(ch, marksOf(li as HTMLElement, marks), c)
    }
    items.push(trimEdges(c))
    // Las sublistas se aplanan: un solo nivel en la factura
    for (const n of nested) items.push(...listItems(n, marks))
  }
  return items
}

const hasBlocks = (e: Element) => !!e.querySelector('p, div, ul, ol, li, h1, h2, h3, h4, h5, h6, blockquote, pre, table, section, article')

/** HTML (el editor o lo pegado) → bloques */
export function htmlToRich(root: Node): RichDoc {
  const out: RichDoc = []
  let para: RichSpan[] | null = null
  const flush = () => {
    if (para) out.push({ k: 'p', c: trimEdges(para) })
    para = null
  }
  const walk = (parent: Node, marks: Marks = {}) => {
    for (const ch of parent.childNodes) {
      if (ch.nodeType === Node.TEXT_NODE) {
        if ((ch.nodeValue ?? '').trim() || para) inlineNode(ch, marks, (para ??= []))
        continue
      }
      if (ch.nodeType !== Node.ELEMENT_NODE) continue
      const e = ch as HTMLElement
      const tag = e.tagName
      if (SKIP_TAGS.has(tag)) continue
      if (tag === 'BR') {
        if (para) flush()
        else out.push({ k: 'p', c: [] })
        continue
      }
      if (tag === 'UL' || tag === 'OL') {
        flush()
        const items = listItems(e, marks)
        if (items.length) out.push({ k: tag === 'UL' ? 'ul' : 'ol', items })
        continue
      }
      if (/^H[1-6]$/.test(tag)) {
        flush()
        const c: RichSpan[] = []
        for (const n of e.childNodes) inlineNode(n, marks, c)
        out.push({ k: 'h', c: trimEdges(c) })
        continue
      }
      if (BLOCK_TAGS.has(tag)) {
        flush()
        // Bloques anidados (div > p, tablas…): se recorren por dentro
        if (hasBlocks(e)) {
          walk(e, marksOf(e, marks))
          flush()
          continue
        }
        const c: RichSpan[] = []
        const m = marksOf(e, marks)
        for (const n of e.childNodes) inlineNode(n, m, c)
        out.push({ k: 'p', c: trimEdges(c) })
        continue
      }
      // Envoltorio en línea con párrafos dentro (Google Docs mete todo en un <b>): se entra en él
      if (hasBlocks(e)) {
        flush()
        walk(e, marksOf(e, marks))
        flush()
        continue
      }
      inlineNode(e, marks, (para ??= []))
    }
  }
  walk(root)
  flush()
  return out
}
