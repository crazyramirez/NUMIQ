import { and, eq, gte, inArray, lte, ne, notInArray } from 'drizzle-orm'
import type { LinkCandidate, LinkCandidatesResult, LinkReason } from '../../shared/types/sales-links'

/**
 * Presupuesto ↔ factura: qué factura emitida corresponde a un presupuesto (o de qué presupuesto sale una
 * factura) aunque no se convirtiera en la app. Primero los indicios (cliente, importe, fechas, conceptos,
 * referencias) puntúan todo el histórico; después la IA revisa los mejores como lo haría un contable.
 * Vincular solo pone `sourceId` en la factura y el presupuesto queda facturado: nada más cambia.
 */

const s = tables.salesDocuments
const QUOTE_KINDS = ['quote', 'proforma'] as const
const isQuote = (kind: string) => kind === 'quote' || kind === 'proforma'

type DocRow = Pick<typeof s.$inferSelect,
  'id' | 'kind' | 'status' | 'number' | 'issueDate' | 'contactId' | 'customer' | 'customerReference' | 'taxBase' | 'total' | 'description' | 'notes' | 'sourceId' | 'updatedAt'>

const DOC_FIELDS = {
  id: s.id, kind: s.kind, status: s.status, number: s.number, issueDate: s.issueDate, contactId: s.contactId, customer: s.customer,
  customerReference: s.customerReference, taxBase: s.taxBase, total: s.total, description: s.description, notes: s.notes, sourceId: s.sourceId, updatedAt: s.updatedAt,
}

interface Party { contactId: number | null, name: string | null, nif: string | null }
interface Lines { text: string[], items: Set<number> }

// ─── Indicios ────────────────────────────────────────────────────────────────

const STOP = new Set([
  'para', 'como', 'esta', 'este', 'estos', 'estas', 'sobre', 'entre', 'desde', 'hasta', 'segun', 'incluye', 'incluido', 'incluida',
  'total', 'unidad', 'unidades', 'servicio', 'servicios', 'trabajo', 'trabajos', 'concepto', 'conceptos', 'presupuesto', 'factura',
  'importe', 'precio', 'euros', 'mediante', 'durante', 'todo', 'todos', 'toda', 'todas', 'otro', 'otros', 'cada', 'with', 'from',
])

const plain = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Palabras con significado de los conceptos: «Diseño de logotipo» y «logotipos (diseño)» comparten dos */
function conceptWords(texts: string[]) {
  const out = new Set<string>()
  for (const t of texts) {
    for (const w of plain(t).split(/[^a-z0-9ñ]+/)) {
      if (w.length < 4 || STOP.has(w) || /^\d+$/.test(w)) continue
      // Plurales sencillos fuera: «logotipos» → «logotipo»
      out.add(w.length > 5 && w.endsWith('s') ? w.slice(0, -1) : w)
    }
  }
  return out
}

/** Cuánto comparten dos conceptos, de 0 a 1, contra el más corto (la factura suele resumir el presupuesto) */
function conceptSimilarity(a: Set<string>, b: Set<string>) {
  if (a.size < 2 || b.size < 2) return 0
  let common = 0
  for (const w of a) if (b.has(w)) common++
  return common / Math.min(a.size, b.size)
}

/** El número del documento escrito en otro («Según presupuesto P2026-0003», «ppto 2026/3») */
function mentions(number: string | null, texts: Array<string | null | undefined>) {
  if (!number) return false
  const key = plain(number).replace(/[^a-z0-9]/g, '')
  if (key.length < 3) return false
  return texts.some(t => !!t && plain(t).replace(/[^a-z0-9]/g, '').includes(key))
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
const near = (a: number, b: number, cents = 0.02) => Math.abs(a - b) <= cents

const PARTS = [10, 15, 20, 25, 30, 33, 40, 50, 60, 66, 67, 70, 75, 80, 90]

interface Pair {
  quote: DocRow
  invoice: DocRow
  quoteParty: Party
  invoiceParty: Party
  /** Base ya facturada del presupuesto con otras facturas (anticipos) */
  invoicedBase: number
}

/** Puntos e indicios de que la factura salga del presupuesto, sin mirar las líneas */
function scoreHeader(p: Pair) {
  const reasons: LinkReason[] = []
  let score = 0
  const { quote: q, invoice: i } = p

  // Cliente
  const sameContact = q.contactId && q.contactId === i.contactId
  const sameNif = !sameContact && p.quoteParty.nif && taxIdKey(p.quoteParty.nif) === taxIdKey(p.invoiceParty.nif)
  if (sameContact || sameNif) {
    score += 30
    reasons.push({ text: 'Mismo cliente', tone: 'ok' })
  }
  else {
    const sim = nameSimilarity(p.quoteParty.name, p.invoiceParty.name)
    if (sim > 0) {
      score += Math.round(24 * sim)
      reasons.push({ text: 'Cliente con nombre parecido', tone: 'ok' })
    }
    else if (p.quoteParty.name && p.invoiceParty.name) {
      score -= 25
      reasons.push({ text: 'Otro cliente', tone: 'warn' })
    }
  }

  // Importe: con la base, porque el presupuesto no suele llevar la retención que sí lleva la factura
  const qb = q.taxBase, ib = i.taxBase
  const pending = round2(qb - p.invoicedBase)
  if (qb && near(qb, ib)) {
    score += 35
    reasons.push({ text: 'Mismo importe', tone: 'ok' })
  }
  else if (q.total && near(q.total, i.total)) {
    score += 35
    reasons.push({ text: 'Mismo total', tone: 'ok' })
  }
  else if (p.invoicedBase && pending > 0.02 && near(pending, ib)) {
    score += 30
    reasons.push({ text: 'Completa lo que faltaba por facturar', tone: 'ok' })
  }
  else if (qb > 0 && ib > 0) {
    const ratio = ib / qb
    const part = PARTS.find(x => Math.abs(ratio - x / 100) <= 0.004)
    if (Math.abs(ratio - 1) <= 0.03) {
      score += 22
      reasons.push({ text: 'Importe casi igual', tone: 'ok' })
    }
    else if (part) {
      score += 18
      reasons.push({ text: `Es el ${part} % del presupuesto`, tone: 'ok' })
    }
    else if (ratio >= 0.85 && ratio <= 1.15) {
      score += 8
      reasons.push({ text: 'Importe parecido', tone: 'ok' })
    }
    else if (ratio > 1.6 || ratio < 0.05) {
      score -= 10
      reasons.push({ text: 'Importe muy distinto', tone: 'warn' })
    }
  }

  // Fechas: la factura llega después del presupuesto
  const days = daysBetween(q.issueDate, i.issueDate)
  if (days >= 0 && days <= 45) {
    score += 15
    reasons.push({ text: days === 0 ? 'El mismo día' : days === 1 ? 'Un día después' : `${days} días después`, tone: 'ok' })
  }
  else if (days > 45 && days <= 120) {
    score += 10
    reasons.push({ text: `${Math.round(days / 30)} meses después`, tone: 'ok' })
  }
  else if (days > 120 && days <= 365) score += 4
  else if (days > 365) reasons.push({ text: 'Más de un año después', tone: 'warn' })
  else if (days >= -15) score += 4
  else {
    score -= 20
    reasons.push({ text: 'Anterior al presupuesto', tone: 'warn' })
  }

  // Referencias
  if (q.customerReference && i.customerReference && plain(q.customerReference).trim() === plain(i.customerReference).trim()) {
    score += 30
    reasons.push({ text: 'Misma referencia del cliente', tone: 'ok' })
  }
  if (mentions(q.number, [i.notes, i.customerReference, richToPlain(i.description)])) {
    score += 45
    reasons.push({ text: `La factura cita el ${q.number}`, tone: 'ok' })
  }

  if (q.status === 'rejected') {
    score -= 10
    reasons.push({ text: 'Presupuesto rechazado', tone: 'warn' })
  }
  return { score, reasons }
}

/** Lo que aportan las líneas: conceptos y productos en común, o el número del presupuesto escrito en ellas */
function scoreLines(q: DocRow, ql: Lines, il: Lines, already: LinkReason[]) {
  const reasons: LinkReason[] = []
  let score = 0
  const sim = conceptSimilarity(conceptWords([richToPlain(q.description), ...ql.text]), conceptWords(il.text))
  if (sim >= 0.6) {
    score += 25
    reasons.push({ text: 'Mismos conceptos', tone: 'ok' })
  }
  else if (sim >= 0.3) {
    score += 12
    reasons.push({ text: 'Conceptos parecidos', tone: 'ok' })
  }
  if ([...ql.items].some(id => il.items.has(id))) {
    score += 12
    reasons.push({ text: 'Mismos productos', tone: 'ok' })
  }
  if (!already.some(r => r.text.startsWith('La factura cita')) && mentions(q.number, il.text)) {
    score += 45
    reasons.push({ text: `La factura cita el ${q.number}`, tone: 'ok' })
  }
  return { score, reasons }
}

// ─── Carga ───────────────────────────────────────────────────────────────────

async function loadDoc(companyId: number, id: number) {
  const [doc] = await useDb().select(DOC_FIELDS).from(s).where(and(eq(s.id, id), eq(s.companyId, companyId)))
  if (!doc) throw createError({ statusCode: 404, statusMessage: 'Documento no encontrado' })
  if (doc.kind === 'rectifying') throw createError({ statusCode: 400, statusMessage: 'Las rectificativas no se vinculan a presupuestos' })
  return doc
}

async function partiesOf(docs: DocRow[]) {
  const ids = [...new Set(docs.map(d => d.contactId).filter((x): x is number => x != null))]
  const contacts = ids.length
    ? await useDb().select({ id: tables.contacts.id, name: tables.contacts.name, tradeName: tables.contacts.tradeName, nif: tables.contacts.nif })
      .from(tables.contacts).where(inArray(tables.contacts.id, ids))
    : []
  const byId = new Map(contacts.map(c => [c.id, c]))
  return new Map(docs.map((d) => {
    const c = d.contactId ? byId.get(d.contactId) : undefined
    return [d.id, { contactId: d.contactId, name: d.customer?.name ?? c?.name ?? null, nif: d.customer?.nif ?? c?.nif ?? null } satisfies Party]
  }))
}

async function linesOf(ids: number[]) {
  const map = new Map<number, Lines>(ids.map(id => [id, { text: [], items: new Set() }]))
  if (!ids.length) return map
  const l = tables.salesDocumentLines
  const rows = await useDb().select({ documentId: l.documentId, description: l.description, itemId: l.itemId }).from(l)
    .where(inArray(l.documentId, ids)).orderBy(l.position)
  for (const r of rows) {
    const m = map.get(r.documentId)!
    if (r.description?.trim()) m.text.push(r.description.trim())
    if (r.itemId) m.items.add(r.itemId)
  }
  return map
}

/** Base ya facturada de cada presupuesto con sus facturas emitidas (sin contar `except`) */
async function invoicedBases(companyId: number, quoteIds: number[], except?: number) {
  const out = new Map<number, number>()
  if (!quoteIds.length) return out
  const rows = await useDb().select({ sourceId: s.sourceId, taxBase: s.taxBase }).from(s)
    .where(and(eq(s.companyId, companyId), inArray(s.sourceId, quoteIds), eq(s.kind, 'invoice'), ne(s.status, 'draft'), ...(except ? [ne(s.id, except)] : [])))
  for (const r of rows) out.set(r.sourceId!, round2((out.get(r.sourceId!) ?? 0) + r.taxBase))
  return out
}


// ─── IA ──────────────────────────────────────────────────────────────────────

const AI_SYSTEM = `Eres un contable español que ordena la facturación de un autónomo o una pyme. Te doy un documento de venta y una lista de candidatos del otro tipo: si el documento es un presupuesto, los candidatos son facturas emitidas; si es una factura, los candidatos son presupuestos.
Decide, para cada candidato, con qué confianza (0 a 100) esa factura se hizo a partir de ese presupuesto (total o parcialmente).
Ten en cuenta:
- El cliente debe ser el mismo; un nombre comercial y una razón social del mismo cliente cuentan como el mismo. Si es claramente otro cliente, la confianza es muy baja.
- La factura puede cubrir todo el presupuesto, un anticipo o un porcentaje (30 %, 50 %…), o el resto tras otra factura. Compara bases imponibles: la factura puede llevar retención de IRPF que el presupuesto no lleva.
- La factura suele emitirse días o semanas después del presupuesto; meses también es posible en obras y proyectos largos. Una factura muy anterior al presupuesto casi nunca sale de él.
- Los conceptos pueden estar resumidos o redactados de otra forma: compara el trabajo que describen, no las palabras exactas.
- Si la factura cita el número del presupuesto o la referencia del cliente coincide, es casi seguro.
- Un candidato ya vinculado a otro documento puede ser correcto igualmente, pero sé más exigente.
Responde con todos los candidatos. En "reason" explica en español, en una frase breve (máximo 140 caracteres) y concreta, la prueba decisiva a favor o en contra, con cifras o fechas si ayudan. No repitas el número del candidato.`

const AI_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['matches'],
  properties: {
    matches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'confidence', 'reason'],
        properties: { id: { type: 'integer' }, confidence: { type: 'integer' }, reason: { type: 'string' } },
      },
    },
  },
}

interface AiDocInput { doc: DocRow, party: Party, lines: Lines }

function aiDoc({ doc, party, lines }: AiDocInput, extra: Record<string, unknown> = {}) {
  const description = richToPlain(doc.description).replace(/\s+/g, ' ').trim()
  return {
    tipo: isQuote(doc.kind) ? (doc.kind === 'proforma' ? 'proforma' : 'presupuesto') : 'factura',
    numero: doc.number,
    fecha: doc.issueDate,
    cliente: party.name,
    nif: party.nif,
    base_imponible: doc.taxBase,
    total: doc.total,
    referencia_cliente: doc.customerReference || undefined,
    descripcion: description ? description.slice(0, 500) : undefined,
    notas: doc.notes ? doc.notes.slice(0, 200) : undefined,
    lineas: lines.text.slice(0, 25).map(t => t.slice(0, 160)),
    ...extra,
  }
}

/** Revisiones recientes: abrir y cerrar el diálogo no vuelve a pagar la misma consulta */
const aiCache = new Map<string, { at: number, data: Map<number, { confidence: number, reason: string }> }>()
const AI_TTL = 60 * 60_000

async function aiReview(base: AiDocInput, candidates: Array<AiDocInput & { facts: Record<string, unknown> }>) {
  const key = [base.doc.id, base.doc.updatedAt?.valueOf(), ...candidates.map(c => `${c.doc.id}.${c.doc.updatedAt?.valueOf()}`)].join('|')
  const hit = aiCache.get(key)
  if (hit && Date.now() - hit.at < AI_TTL) return hit.data
  const { data } = await aiJson<{ matches: Array<{ id: number, confidence: number, reason: string }> }>({
    name: 'vinculo_presupuesto',
    schema: AI_SCHEMA,
    system: AI_SYSTEM,
    effort: 'low',
    maxOutputTokens: 4000,
    timeoutMs: 60_000,
    parts: [{
      type: 'input_text',
      text: JSON.stringify({
        documento: aiDoc(base),
        candidatos: candidates.map(c => aiDoc(c, { id: c.doc.id, ...c.facts })),
      }),
    }],
  })
  const ids = new Set(candidates.map(c => c.doc.id))
  const out = new Map(data.matches.filter(m => ids.has(m.id)).map(m => [m.id, { confidence: Math.max(0, Math.min(100, Math.round(m.confidence))), reason: m.reason.trim().slice(0, 220) }]))
  if (aiCache.size > 300) aiCache.delete(aiCache.keys().next().value!)
  aiCache.set(key, { at: Date.now(), data: out })
  return out
}

// ─── Candidatos ──────────────────────────────────────────────────────────────

export interface LinkCandidatesOptions {
  /** Texto a buscar (número, cliente o concepto): lista todo lo que coincida, sin IA */
  q?: string
  /** Revisar los mejores con IA */
  ai?: boolean
  limit?: number
}

/**
 * Documentos del otro lado que podrían ir con `id`, del más al menos probable. Sin búsqueda, solo los que
 * tienen indicios suficientes; con búsqueda, todo lo que coincida con el texto.
 */
export async function linkCandidates(companyId: number, id: number, opts: LinkCandidatesOptions = {}): Promise<LinkCandidatesResult> {
  const db = useDb()
  const doc = await loadDoc(companyId, id)
  const fromQuote = isQuote(doc.kind)
  const limit = opts.limit ?? 8
  const search = opts.q?.trim() ? plain(opts.q.trim()) : ''

  // Facturas desde poco antes del presupuesto; presupuestos hasta poco después de la factura
  const window = search
    ? []
    : fromQuote
      ? [gte(s.issueDate, addDaysISO(doc.issueDate, -60)), lte(s.issueDate, addDaysISO(doc.issueDate, 3 * 365))]
      : [gte(s.issueDate, addDaysISO(doc.issueDate, -3 * 365)), lte(s.issueDate, addDaysISO(doc.issueDate, 60))]
  const pool = await db.select(DOC_FIELDS).from(s)
    .where(and(
      eq(s.companyId, companyId),
      fromQuote ? eq(s.kind, 'invoice') : inArray(s.kind, [...QUOTE_KINDS]),
      notInArray(s.status, ['draft', 'cancelled']),
      ne(s.id, id),
      ...window,
    ))
    .limit(5000)

  const parties = await partiesOf([doc, ...pool])
  const party = parties.get(doc.id)!
  const quoteIds = fromQuote ? [doc.id] : pool.map(p => p.id)
  const bases = await invoicedBases(companyId, quoteIds, fromQuote ? undefined : doc.id)

  // Vínculos actuales: la factura con su presupuesto
  const linkedNumbers = new Map<number, string | null>()
  const sourceIds = [...new Set((fromQuote ? pool.map(p => p.sourceId) : [doc.sourceId]).filter((x): x is number => x != null))]
  if (sourceIds.length) {
    for (const r of await db.select({ id: s.id, number: s.number }).from(s).where(and(eq(s.companyId, companyId), inArray(s.id, sourceIds)))) linkedNumbers.set(r.id, r.number)
  }

  const scored = pool.map((other) => {
    const quote = fromQuote ? doc : other
    const invoice = fromQuote ? other : doc
    const linked = invoice.sourceId === quote.id
    const pair: Pair = {
      quote,
      invoice,
      quoteParty: parties.get(quote.id)!,
      invoiceParty: parties.get(invoice.id)!,
      invoicedBase: linked ? 0 : bases.get(quote.id) ?? 0,
    }
    const head = scoreHeader(pair)
    // La factura ya sale de otro presupuesto
    const linkedTo = invoice.sourceId && !linked ? { id: invoice.sourceId, number: linkedNumbers.get(invoice.sourceId) ?? null } : null
    if (linkedTo) {
      head.score -= 15
      head.reasons.push({ text: `Ya vinculada a ${linkedTo.number ?? 'otro presupuesto'}`, tone: 'warn' })
    }
    return { other, quote, invoice, linked, linkedTo, ...head }
  })

  let shortlist = scored
  if (search) {
    const otherParty = (d: DocRow) => plain(parties.get(d.id)?.name ?? '')
    const hits = new Set(pool.filter(d => plain(d.number ?? '').includes(search) || otherParty(d).includes(search)).map(d => d.id))
    // Conceptos: solo en lo que no coincidió por número o cliente
    const rest = pool.filter(d => !hits.has(d.id))
    const restLines = await linesOf(rest.map(d => d.id))
    for (const d of rest) {
      if ([richToPlain(d.description), d.notes, ...restLines.get(d.id)!.text].some(t => t && plain(t).includes(search))) hits.add(d.id)
    }
    shortlist = scored.filter(c => hits.has(c.other.id))
  }
  shortlist = shortlist.sort((a, b) => b.score - a.score).slice(0, 40)

  // Las líneas, solo de los finalistas
  const lines = await linesOf([doc.id, ...shortlist.map(c => c.other.id)])
  for (const c of shortlist) {
    const extra = scoreLines(c.quote, lines.get(c.quote.id)!, lines.get(c.invoice.id)!, c.reasons)
    c.score += extra.score
    c.reasons.push(...extra.reasons)
  }
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))
  const ranked = shortlist
    // Con otro cliente, por mucho que coincida, solo es posible: lo decide la IA o el usuario
    .map(c => ({ ...c, score: clamp(c.reasons.some(r => r.text === 'Otro cliente') ? Math.min(c.score, 40) : c.score) }))
    .filter(c => search || c.linked || c.score >= 35)
    .sort((a, b) => Number(b.linked) - Number(a.linked) || b.score - a.score)
    .slice(0, search ? 20 : limit)

  let reviewed = false
  let aiError: string | null = null
  const ai = new Map<number, { confidence: number, reason: string }>()
  const toReview = ranked.filter(c => !c.linked).slice(0, 6)
  if (opts.ai && !search && toReview.length && await aiEnabled()) {
    try {
      const result = await aiReview(
        { doc, party, lines: lines.get(doc.id)! },
        toReview.map((c) => {
          const days = daysBetween(c.quote.issueDate, c.invoice.issueDate)
          return {
            doc: c.other,
            party: parties.get(c.other.id)!,
            lines: lines.get(c.other.id)!,
            facts: {
              dias_de_presupuesto_a_factura: days,
              porcentaje_base_sobre_presupuesto: c.quote.taxBase ? Math.round((c.invoice.taxBase / c.quote.taxBase) * 1000) / 10 : null,
              ya_facturado_antes_del_presupuesto: bases.get(c.quote.id) || undefined,
              ya_vinculada_a: c.linkedTo?.number ?? undefined,
              indicios: c.reasons.map(r => r.text),
            },
          }
        }),
      )
      for (const [k, v] of result) ai.set(k, v)
      reviewed = true
    }
    catch (err) {
      aiError = err instanceof AiError ? err.message : 'La IA no pudo revisar las coincidencias'
      console.warn('[vínculos] revisión con IA:', err)
    }
  }

  const candidates: LinkCandidate[] = ranked.map((c) => {
    const verdict = ai.get(c.other.id)
    const concept = richToPlain(c.other.description).replace(/\s+/g, ' ').trim() || lines.get(c.other.id)?.text.join(' · ') || null
    return {
      id: c.other.id,
      kind: c.other.kind,
      number: c.other.number,
      status: c.other.status,
      issueDate: c.other.issueDate,
      total: c.other.total,
      taxBase: c.other.taxBase,
      contactName: parties.get(c.other.id)?.name ?? null,
      concept: concept ? concept.slice(0, 220) : null,
      score: c.linked ? 100 : verdict ? verdict.confidence : c.score,
      reasons: c.reasons.slice(0, 6),
      ai: verdict ? { reason: verdict.reason } : null,
      linkedTo: c.linkedTo,
      linked: c.linked,
    }
  })
  // Con la IA, su confianza ordena; lo que descarta (por debajo de 20) desaparece de las sugerencias
  if (reviewed) {
    candidates.sort((a, b) => Number(b.linked) - Number(a.linked) || b.score - a.score)
    return { candidates: candidates.filter(c => c.linked || !ai.has(c.id) || c.score >= 20), reviewed, aiError }
  }
  return { candidates, reviewed, aiError }
}

// ─── Vincular y desvincular ──────────────────────────────────────────────────

/**
 * Estado del presupuesto según sus facturas: con alguna emitida, facturado; si ya no le queda ninguna,
 * vuelve a aceptado (lo estuvo para facturarse).
 */
export async function refreshQuoteInvoiced(companyId: number, quoteId: number) {
  const db = useDb()
  const [quote] = await db.select({ status: s.status, kind: s.kind }).from(s).where(and(eq(s.id, quoteId), eq(s.companyId, companyId)))
  if (!quote || !isQuote(quote.kind)) return
  const [invoice] = await db.select({ id: s.id }).from(s)
    .where(and(eq(s.companyId, companyId), eq(s.sourceId, quoteId), eq(s.kind, 'invoice'), ne(s.status, 'draft'))).limit(1)
  if (invoice && quote.status !== 'invoiced') await db.update(s).set({ status: 'invoiced' }).where(eq(s.id, quoteId))
  if (!invoice && quote.status === 'invoiced') await db.update(s).set({ status: 'accepted' }).where(eq(s.id, quoteId))
}

/** Ordena el par: siempre presupuesto y factura de la empresa, sea cual sea el documento de partida */
async function resolvePair(companyId: number, id: number, otherId: number) {
  const [a, b] = await Promise.all([loadDoc(companyId, id), loadDoc(companyId, otherId)])
  const quote = isQuote(a.kind) ? a : b
  const invoice = isQuote(a.kind) ? b : a
  if (!isQuote(quote.kind) || invoice.kind !== 'invoice') throw createError({ statusCode: 400, statusMessage: 'Se vincula un presupuesto con una factura' })
  return { quote, invoice }
}

/**
 * La factura pasa a salir del presupuesto. Si ya salía de otro, solo con `replace` (y ese otro deja de
 * estar facturado si se queda sin facturas).
 */
export async function linkQuoteInvoice(companyId: number, id: number, otherId: number, opts: { replace?: boolean } = {}) {
  const { quote, invoice } = await resolvePair(companyId, id, otherId)
  const previous = { sourceId: invoice.sourceId, quoteStatus: quote.status }
  if (invoice.sourceId === quote.id) return { quoteId: quote.id, invoiceId: invoice.id, previous, changed: false }
  if (invoice.sourceId && !opts.replace) {
    const [other] = await useDb().select({ number: s.number }).from(s).where(eq(s.id, invoice.sourceId))
    throw createError({ statusCode: 409, statusMessage: `La factura ya está vinculada a ${other?.number ?? 'otro presupuesto'}`, data: { linkedTo: invoice.sourceId } })
  }
  await useDb().update(s).set({ sourceId: quote.id }).where(and(eq(s.id, invoice.id), eq(s.companyId, companyId)))
  await refreshQuoteInvoiced(companyId, quote.id)
  if (invoice.sourceId) await refreshQuoteInvoiced(companyId, invoice.sourceId)
  return { quoteId: quote.id, invoiceId: invoice.id, previous, changed: true }
}

/** Quita el vínculo; el presupuesto vuelve a aceptado si se queda sin facturas */
export async function unlinkQuoteInvoice(companyId: number, id: number, otherId: number) {
  const { quote, invoice } = await resolvePair(companyId, id, otherId)
  if (invoice.sourceId !== quote.id) return { quoteId: quote.id, invoiceId: invoice.id, changed: false }
  await useDb().update(s).set({ sourceId: null }).where(and(eq(s.id, invoice.id), eq(s.companyId, companyId)))
  await refreshQuoteInvoiced(companyId, quote.id)
  return { quoteId: quote.id, invoiceId: invoice.id, changed: true }
}
