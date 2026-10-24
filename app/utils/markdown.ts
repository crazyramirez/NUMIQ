/**
 * Markdown mínimo y seguro para las respuestas del asistente: se escapa todo el HTML y solo se
 * generan párrafos, listas, tablas, negritas, cursivas, código y enlaces (internos o https).
 */

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function inline(raw: string) {
  let s = escapeHtml(raw)
  const codes: string[] = []
  s = s.replace(/`([^`]+)`/g, (_, c: string) => {
    codes.push(`<code>${c}</code>`)
    return `\u0000${codes.length - 1}\u0000`
  })
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text: string, url: string) => {
    const href = url.replace(/&amp;/g, '&')
    if (/^\/(?!\/)[^\s"'<>]*$/.test(href)) return `<a href="${escapeHtml(href)}" data-internal="1">${text}</a>`
    if (/^https:\/\/[^\s"'<>]+$/.test(href)) return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`
    return text
  })
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
  s = s.replace(/(^|\W)_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[Number(i)] ?? '')
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l)
const isDivider = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l)
const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())

export function renderMarkdown(md: string) {
  const lines = md.replace(/\r/g, '').split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) {
      i++
      continue
    }
    // Bloque de código
    if (line.trim().startsWith('```')) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) body.push(lines[i++]!)
      i++
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }
    // Tabla
    if (isTableRow(line) && i + 1 < lines.length && isDivider(lines[i + 1]!)) {
      const head = cells(line)
      const align = cells(lines[i + 1]!).map(c => (c.endsWith(':') ? (c.startsWith(':') ? 'c' : 'r') : ''))
      i += 2
      const rows: string[][] = []
      while (i < lines.length && isTableRow(lines[i]!)) rows.push(cells(lines[i++]!))
      const cls = (j: number) => (align[j] ? ` class="${align[j]}"` : '')
      out.push(`<div class="md-table"><table><thead><tr>${head.map((h, j) => `<th${cls(j)}>${inline(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, j) => `<td${cls(j)}>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`)
      continue
    }
    // Títulos (se muestran discretos)
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      out.push(`<p class="md-h">${inline(h[2]!)}</p>`)
      i++
      continue
    }
    // Listas
    const ul = /^\s*[-*•]\s+/
    const ol = /^\s*\d+[.)]\s+/
    if (ul.test(line) || ol.test(line)) {
      const ordered = ol.test(line)
      const re = ordered ? ol : ul
      const items: string[] = []
      while (i < lines.length && re.test(lines[i]!)) {
        let item = lines[i]!.replace(re, '')
        i++
        // Continuación del elemento en la línea siguiente (sangrada)
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]!) && !ul.test(lines[i]!) && !ol.test(lines[i]!)) item += ` ${lines[i++]!.trim()}`
        items.push(`<li>${inline(item)}</li>`)
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`)
      continue
    }
    // Párrafo
    // La primera línea siempre entra (una fila de tabla suelta también es texto)
    const para: string[] = [lines[i++]!]
    while (i < lines.length && lines[i]!.trim() && !isTableRow(lines[i]!) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!) && !/^#{1,4}\s/.test(lines[i]!) && !lines[i]!.trim().startsWith('```')) para.push(lines[i++]!)
    out.push(`<p>${para.map(inline).join('<br>')}</p>`)
  }
  return out.join('')
}
