import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import type { ContactChange, ContactDraft, ContactDraftField } from '../../shared/utils/contact-clean'
import type { ContactImportAction, ContactImportCommitResult, ContactImportFile, ContactImportJobView, ContactImportMatch, ContactImportPhase, ContactImportResult, ContactImportRole, ContactImportRow, ContactImportUndoResult } from '../../shared/types/contact-import'
import { bestByName, findSimilarContact, taxIdKey } from '../../shared/utils/duplicate-matching'
import type { ReadContact, RefineFix, RefineInput } from './contact-import-read'

/**
 * Importación masiva de clientes y proveedores. Se lee todo en segundo plano (la página va preguntando
 * cómo va) y el resultado se revisa antes de guardar nada: cada dato limpio, lo que ha cambiado la IA,
 * los repetidos dentro del archivo y los que ya existen en NUMIQ. Al confirmar se crean o completan las
 * fichas de una vez y queda un registro para poder deshacerlo.
 */

type Company = typeof tables.companies.$inferSelect
type ContactRow = typeof tables.contacts.$inferSelect

interface Job {
  view: ContactImportJobView
  companyId: number
  createdAt: number
}

/** Lo que se está leyendo o se acaba de leer (en memoria: la revisión es inmediata) */
const jobs = new Map<string, Job>()
const JOB_TTL = 3 * 60 * 60 * 1000
const MAX_ROWS = 10_000

export interface ContactImportInput {
  company: Company
  role: ContactImportRole
  files: Array<{ name: string, data: Buffer }>
}

/** Empieza a leer los archivos y devuelve el identificador para seguir el progreso */
export function startContactImport(input: ContactImportInput) {
  const now = Date.now()
  for (const [id, j] of jobs) if (now - j.createdAt > JOB_TTL) jobs.delete(id)
  const running = [...jobs.values()].filter(j => j.companyId === input.company.id && j.view.status === 'running').length
  if (running >= 2) throw createError({ statusCode: 429, statusMessage: 'Ya hay dos importaciones leyéndose: espera a que terminen' })
  const id = randomUUID()
  const job: Job = { view: { id, status: 'running', phase: 'read', done: 0, total: input.files.length, error: null, result: null }, companyId: input.company.id, createdAt: now }
  jobs.set(id, job)
  const progress = (phase: ContactImportPhase, done: number, total: number) => Object.assign(job.view, { phase, done, total })
  runContactImport(input, progress)
    .then(result => Object.assign(job.view, { status: 'done', phase: 'done', result }))
    .catch((err) => {
      console.error('[contact-import]', err)
      Object.assign(job.view, { status: 'failed', error: err instanceof AiError || (err as { statusMessage?: string }).statusMessage ? (err as Error & { statusMessage?: string }).statusMessage ?? (err as Error).message : 'No se pudo leer el archivo' })
    })
  return id
}

export function contactImportJob(id: string, companyId: number): ContactImportJobView | null {
  const job = jobs.get(id)
  return job && job.companyId === companyId ? job.view : null
}

// ─── Lectura y revisión ──────────────────────────────────────────────────────

interface Working {
  id: number
  source: string
  original: Partial<ContactDraft>
  data: ContactDraft
  changes: ContactChange[]
  role: ContactImportRole
  fromSheet: boolean
  notContact: string | null
  mergedInto: number | null
}

async function runContactImport(input: ContactImportInput, progress: (phase: ContactImportPhase, done: number, total: number) => void): Promise<ContactImportResult> {
  const ai = aiEnabled()
  const { company } = input
  const files: ContactImportFile[] = []
  const read: ReadContact[] = []
  for (const [i, f] of input.files.entries()) {
    progress('read', i, input.files.length)
    try {
      const r = await readContactSource(f.name, f.data, { company, ai, progress: (phase, done, total) => progress(phase, done, total) })
      files.push(r.file)
      read.push(...r.contacts)
    }
    catch (err) {
      files.push({ name: f.name, kind: 'document', contacts: 0, note: null, error: err instanceof AiError ? err.message : 'No se pudo leer este archivo' })
      if (!(err instanceof AiError)) console.error('[contact-import]', f.name, err)
    }
  }
  if (!read.length) throw new AiError(files.find(f => f.error)?.error ?? 'No se ha encontrado ningún contacto', 422)
  if (read.length > MAX_ROWS) {
    const last = files.at(-1)!
    last.note = [last.note, `Solo se leen los ${MAX_ROWS.toLocaleString('es-ES')} primeros`].filter(Boolean).join(' · ')
    read.length = MAX_ROWS
  }

  // 1. Cada dato en su forma correcta
  const own = taxIdKey(company.nif)
  const rows: Working[] = read.map((r, i) => {
    const { contact, changes } = cleanContactDraft(r.draft)
    return {
      id: i + 1,
      source: r.source,
      original: r.draft,
      data: contact,
      changes,
      role: r.role ?? input.role,
      fromSheet: r.fromSheet,
      notContact: own && taxIdKey(contact.nif) === own ? 'Es tu propia empresa' : null,
      mergedInto: null,
    }
  })

  // 2. La IA revisa lo leído de hojas: autónomos, mayúsculas, erratas, filas que no son contactos
  if (ai) {
    const pending = rows.filter(r => r.fromSheet && !r.notContact && (rows.length <= 1500 || needsReview(r)))
    if (pending.length) {
      const fixes = await refineContactsWithAi(pending.map(refineInput), (done, total) => progress('review', done, total))
      const byId = new Map(rows.map(r => [r.id, r]))
      for (const f of fixes) {
        const row = byId.get(f.i)
        if (row) applyFix(row, f)
      }
    }
  }
  for (const r of rows) {
    const again = cleanContactDraft(r.data)
    r.data = again.contact
    r.changes.push(...again.changes)
    if (!r.data.kind) r.data.kind = 'company'
  }

  // 3. Código postal por la dirección (CartoCiudad) cuando falta
  const noCp = rows.filter(r => !r.notContact && !r.data.postalCode && (!r.data.country || r.data.country === 'ES') && r.data.address).slice(0, 400)
  if (noCp.length) {
    let done = 0
    progress('postal', 0, noCp.length)
    await runLimited(noCp.map(r => async () => {
      const before = { ...r.data }
      await completePostalCode(r.data).catch(() => false)
      progress('postal', ++done, noCp.length)
      if (!r.data.postalCode) return
      for (const f of ['address', 'city'] as const) {
        if (before[f] !== r.data[f]) r.changes.push({ field: f, from: before[f], to: r.data[f], reason: 'El código postal estaba dentro: pasa a su campo', minor: true, by: 'rule' })
      }
      r.changes.push({ field: 'postalCode', from: null, to: r.data.postalCode, reason: before.address?.includes(r.data.postalCode) || before.city?.includes(r.data.postalCode) ? 'Estaba escrito en la dirección' : 'Encontrado por la dirección (callejero oficial)', by: 'rule' })
      const again = cleanContactDraft(r.data)
      r.data = again.contact
      r.changes.push(...again.changes)
    }), 4)
  }

  // 4. Repetidos dentro de lo importado: se unen en la primera fila
  progress('match', 0, 1)
  mergeRepeated(rows)

  // 5. Los que ya existen en NUMIQ
  const existing = await useDb().select().from(tables.contacts).where(eq(tables.contacts.companyId, company.id))
  const result = rows.map((r): ContactImportRow => {
    const isClient = r.role !== 'supplier'
    const isSupplier = r.role !== 'client'
    const match = r.notContact || r.mergedInto ? null : findMatch(existing, r.data)
    const roleMissing = !!match && ((isClient && !match.isClient) || (isSupplier && !match.isSupplier))
    const action: ContactImportAction = r.notContact || r.mergedInto ? 'skip' : match ? (match.fills.length || roleMissing ? 'fill' : 'skip') : 'create'
    return {
      id: r.id,
      source: r.source,
      data: r.data,
      original: r.original,
      isClient,
      isSupplier,
      changes: dedupeChanges(r.changes),
      issues: checkContactDraft(r.data),
      match,
      mergedInto: r.mergedInto,
      notContact: r.notContact,
      action,
    }
  })
  progress('match', 1, 1)
  return { rows: result, files, ai }
}

const loose = (s: string | number | null | undefined) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]+/g, '')

/** Parecido entre dos textos (coeficiente de Dice sobre pares de letras) */
function similarity(a: string, b: string) {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const pairs = new Map<string, number>()
  for (let i = 0; i < a.length - 1; i++) pairs.set(a.slice(i, i + 2), (pairs.get(a.slice(i, i + 2)) ?? 0) + 1)
  let common = 0
  for (let i = 0; i < b.length - 1; i++) {
    const n = pairs.get(b.slice(i, i + 2)) ?? 0
    if (n) {
      common++
      pairs.set(b.slice(i, i + 2), n - 1)
    }
  }
  return (2 * common) / (a.length + b.length - 2)
}

const caps = (s: string | null) => !!s && (s.match(/\p{L}/gu)?.length ?? 0) >= 3 && !/\p{Ll}/u.test(s)

/** En listados enormes la IA solo revisa lo que lo necesita */
function needsReview(r: Working) {
  const d = r.data
  return !d.kind || !!d.contactPerson || !!d.tradeName || [d.name, d.address, d.city].some(caps)
}

function nifKind(d: ContactDraft) {
  if (!d.nif) return 'ninguno'
  if (d.nifType === 'vat_eu') return 'vat'
  const v = validateNif(d.nif)
  return v.valid ? v.kind! : 'otro'
}

function refineInput(r: Working): RefineInput {
  const d = r.data
  return { i: r.id, name: d.name, tradeName: d.tradeName, contactPerson: d.contactPerson, nifKind: nifKind(d), kind: d.kind, address: d.address, postalCode: d.postalCode, city: d.city, province: d.province, country: d.country }
}

/**
 * Aplica lo que propone la IA solo si es seguro: los nombres solo se reordenan o cambian de
 * mayúsculas (nunca aparece un nombre nuevo ni se pierde uno), y las calles y poblaciones solo
 * admiten correcciones pequeñas.
 */
function applyFix(row: Working, f: RefineFix) {
  if (f.skip) {
    row.notContact = f.reason?.trim() || 'No parece un cliente ni un proveedor'
    return
  }
  const d = row.data
  const next: ContactDraft = { ...d }
  const names = ['name', 'tradeName', 'contactPerson'] as const
  const pool = new Set(names.map(k => loose(d[k])).filter(Boolean))
  for (const k of names) {
    const v = f[k]
    if (v == null) continue
    if (v.trim() === '') {
      if (k !== 'name') next[k] = null
    }
    else if (pool.has(loose(v))) next[k] = v.trim()
  }
  const after = new Set(names.map(k => loose(next[k])).filter(Boolean))
  if (!next.name || [...pool].some(v => !after.has(v))) for (const k of names) next[k] = d[k]

  for (const k of ['address', 'city', 'province'] as const) {
    const v = f[k]?.trim()
    if (!v) continue
    const old = d[k]
    if (old ? similarity(loose(old), loose(v)) >= 0.75 : k === 'province' && !d.postalCode && !!spanishProvince(v)) next[k] = v
  }
  if (f.kind && nifKind(d) !== 'dni' && nifKind(d) !== 'nie' && nifKind(d) !== 'cif') next.kind = f.kind

  const reason = f.reason?.trim() || 'Revisado con IA'
  for (const k of [...names, 'address', 'city', 'province', 'kind'] as const) {
    if (next[k] === d[k]) continue
    const minor = k === 'kind' ? !d.kind : !!d[k] && !!next[k] && loose(d[k]) === loose(next[k])
    row.changes.push({ field: k, from: d[k], to: next[k], reason: k === 'kind' && !d.kind ? (next.kind === 'person' ? 'Es una persona' : 'Es una empresa o entidad') : reason, minor, by: 'ai' })
  }
  row.data = next
}

/** El mismo cambio anotado dos veces (en la primera y la segunda limpieza) se queda una */
function dedupeChanges(list: ContactChange[]) {
  const out: ContactChange[] = []
  for (const c of list) {
    const prev = out.findLast(x => x.field === c.field)
    // Dos pasos sobre el mismo dato: un solo cambio de lo leído al resultado
    if (prev && prev.to === c.from) {
      prev.to = c.to
      prev.minor = prev.minor && c.minor
      if (prev.by === 'rule' && c.by === 'ai') Object.assign(prev, { by: 'ai', reason: c.reason })
      continue
    }
    out.push({ ...c })
  }
  return out.filter(c => c.from !== c.to)
}

const MERGE_FIELDS: readonly ContactDraftField[] = Object.freeze(['tradeName', 'contactPerson', 'nif', 'email', 'phone', 'website', 'address', 'postalCode', 'city', 'province', 'iban', 'paymentTermsDays', 'irpfRate'] as ContactDraftField[])

/**
 * Mismo NIF, o sin NIF con el mismo nombre o email, o un nombre que solo cambia por una errata, el orden o
 * las siglas («Acme Consultng» y «ACME CONSULTING, S.L.»): se unen y se completan los huecos de la primera
 */
function mergeRepeated(rows: Working[]) {
  const byNif = new Map<string, Working>()
  const byName = new Map<string, Working>()
  const byEmail = new Map<string, Working>()
  const kept: Working[] = []
  for (const r of rows) {
    if (r.notContact) continue
    const nif = taxIdKey(r.data.nif)
    const name = comparableName(r.data.name)
    const email = r.data.email?.toLowerCase() ?? ''
    let target = nif ? byNif.get(nif) : undefined
    if (!target) {
      const cand = (name ? byName.get(name) : undefined) ?? (email ? byEmail.get(email) : undefined)
      const candNif = cand ? taxIdKey(cand.data.nif) : ''
      if (cand && (!nif || !candNif)) target = cand
    }
    if (!target) {
      // Casi el mismo nombre (todas las palabras, como mucho una errata) y ningún NIF que lo contradiga
      const close = bestByName(kept.filter(k => !nif || !taxIdKey(k.data.nif)).map(k => ({ ...k.data, row: k })), r.data.name, r.data.tradeName)
      if (close && close.score >= 0.75) target = close.contact.row
    }
    if (target && target.role !== r.role) target.role = 'both'
    if (target) {
      r.mergedInto = target.id
      for (const k of MERGE_FIELDS) {
        if (target.data[k] == null && r.data[k] != null) {
          if (k === 'nif') target.data.nifType = r.data.nifType
          ;(target.data as unknown as Record<string, unknown>)[k] = r.data[k]
          target.changes.push({ field: k, from: null, to: String(r.data[k]), reason: `Completado con su fila repetida (${r.source})`, by: 'rule' })
        }
      }
      if (r.data.notes && !(target.data.notes ?? '').includes(r.data.notes)) target.data.notes = [target.data.notes, r.data.notes].filter(Boolean).join('\n').slice(0, 5000)
      continue
    }
    kept.push(r)
    if (nif) byNif.set(nif, r)
    if (name && !byName.has(name)) byName.set(name, r)
    if (email && !byEmail.has(email)) byEmail.set(email, r)
  }
}

const COMPARE_FIELDS: readonly ContactDraftField[] = Object.freeze(['tradeName', 'contactPerson', 'nif', 'email', 'phone', 'website', 'address', 'postalCode', 'city', 'province', 'country', 'iban', 'paymentTermsDays', 'irpfRate'] as ContactDraftField[])

function findMatch(existing: ContactRow[], d: ContactDraft): ContactImportMatch | null {
  const hit = findSimilarContact(existing, { name: d.name, tradeName: d.tradeName, nif: d.nif, email: d.email, phone: d.phone, address: d.address })
  if (!hit) return null
  const certain = !!taxIdKey(d.nif) && taxIdKey(hit.nif) === taxIdKey(d.nif)
  const fills: ContactDraftField[] = []
  const conflicts: ContactImportMatch['conflicts'] = []
  for (const k of COMPARE_FIELDS) {
    const incoming = d[k]
    if (incoming == null || incoming === '') continue
    const current = (hit as unknown as Record<string, unknown>)[k] as string | number | null
    if (current == null || current === '') fills.push(k)
    else if (k === 'nif' ? taxIdKey(String(current)) !== taxIdKey(String(incoming)) : loose(current) !== loose(incoming)) conflicts.push({ field: k, current: String(current), incoming: String(incoming) })
  }
  const archived = hit.archivedAt ? ' (archivado)' : ''
  return {
    id: hit.id,
    name: hit.name,
    nif: hit.nif,
    certain,
    label: certain ? `Ya existe con el mismo NIF: ${hit.name}${archived}` : `Ya tienes a ${hit.name}${archived}, con ${d.email && hit.email?.toLowerCase() === d.email.toLowerCase() ? 'el mismo email' : 'un nombre igual o muy parecido'}`,
    isClient: hit.isClient,
    isSupplier: hit.isSupplier,
    fills,
    conflicts,
  }
}

// ─── Guardar ─────────────────────────────────────────────────────────────────

export interface ContactImportCommitRow {
  id: number
  action: Exclude<ContactImportAction, 'skip'>
  data: ContactDraft
  isClient: boolean
  isSupplier: boolean
  matchId: number | null
}

type ContactValues = Omit<typeof tables.contacts.$inferInsert, 'id' | 'companyId'>

/** Los campos que se pueden completar o actualizar de una ficha existente */
const PATCH_FIELDS = Object.freeze(['tradeName', 'contactPerson', 'nif', 'email', 'phone', 'website', 'country', 'iban', 'paymentTermsDays', 'irpfRate'] as const)
const ADDRESS_FIELDS = Object.freeze(['address', 'postalCode', 'city', 'province'] as const)

const empty = (v: unknown) => v == null || v === ''

/** Qué cambia en una ficha existente: «fill» solo rellena huecos; «update» pone lo del archivo (nunca otro NIF) */
function contactPatch(target: ContactRow, v: ContactValues, mode: 'fill' | 'update') {
  const patch: Partial<ContactValues> = {}
  const t = target as unknown as Record<string, unknown>
  const vals = v as unknown as Record<string, unknown>
  for (const k of PATCH_FIELDS) {
    if (empty(vals[k])) continue
    if (k === 'nif') {
      if (empty(target.nif)) Object.assign(patch, { nif: v.nif, nifType: v.nifType })
      continue
    }
    if (k === 'country' && (mode === 'fill' || v.country === target.country)) continue
    if (mode === 'fill' ? empty(t[k]) : t[k] !== vals[k]) (patch as Record<string, unknown>)[k] = vals[k]
  }
  // La dirección va entera: no se mezcla la calle de un sitio con la población de otro
  const hasAddress = ADDRESS_FIELDS.some(k => !empty(vals[k]))
  if (hasAddress) {
    if (empty(target.address) && empty(target.city)) {
      for (const k of ADDRESS_FIELDS) if (!empty(vals[k])) (patch as Record<string, unknown>)[k] = vals[k]
    }
    else if (mode === 'update' && ADDRESS_FIELDS.some(k => !empty(vals[k]) && t[k] !== vals[k])) {
      for (const k of ADDRESS_FIELDS) (patch as Record<string, unknown>)[k] = vals[k] ?? null
    }
    else if (loose(target.city) && loose(target.city) === loose(v.city)) {
      if (empty(target.postalCode) && v.postalCode) patch.postalCode = v.postalCode
      if (empty(target.province) && v.province) patch.province = v.province
    }
  }
  if (mode === 'update') {
    if (v.name && v.name !== target.name) patch.name = v.name
    if (v.kind && v.kind !== target.kind) patch.kind = v.kind
  }
  if (v.notes && !(target.notes ?? '').includes(v.notes)) patch.notes = [target.notes, v.notes].filter(Boolean).join('\n').slice(0, 5000)
  if (v.isClient && !target.isClient) patch.isClient = true
  if (v.isSupplier && !target.isSupplier) patch.isSupplier = true
  if (target.archivedAt) patch.archivedAt = null
  return patch
}

/**
 * Crea y completa las fichas de una vez. Antes se comprueba todo: si alguna fila tiene un dato
 * inválido no se guarda ninguna y se dice cuál. Dos filas con el mismo NIF nunca crean dos fichas.
 */
export async function commitContactImport(company: Company, userId: number, rows: ContactImportCommitRow[], files: string[], ip: string | null): Promise<ContactImportCommitResult> {
  const problems: Array<{ id: number, text: string }> = []
  const prepared: Array<{ row: ContactImportCommitRow, values: ContactValues }> = []
  for (const row of rows) {
    const { contact } = cleanContactDraft(row.data)
    contact.kind ??= 'company'
    const error = checkContactDraft(contact).find(i => i.level === 'error')
    if (error) {
      problems.push({ id: row.id, text: error.text })
      continue
    }
    const parsed = contactInputSchema.safeParse({
      ...contact,
      nifType: contact.nifType ?? 'nif',
      country: contact.country ?? 'ES',
      isClient: row.isClient,
      isSupplier: row.isSupplier,
    })
    if (!parsed.success) {
      problems.push({ id: row.id, text: parsed.error.issues[0]?.message ?? 'Datos no válidos' })
      continue
    }
    prepared.push({ row, values: parsed.data })
  }
  if (problems.length) {
    throw createError({ statusCode: 422, statusMessage: problems.length === 1 ? 'Un contacto tiene un dato que corregir' : `${problems.length} contactos tienen datos que corregir`, data: { rows: problems } })
  }

  const db = useDb()
  const c = tables.contacts
  const existing = await db.select().from(c).where(eq(c.companyId, company.id))
  const byId = new Map(existing.map(x => [x.id, x]))
  const byNif = new Map(existing.filter(x => taxIdKey(x.nif)).map(x => [taxIdKey(x.nif), x]))
  const created: number[] = []
  const updated: Array<{ id: number, before: Record<string, unknown>, after: Record<string, unknown> }> = []
  let filled = 0
  let changed = 0
  let skipped = 0
  let importId = 0

  await db.transaction(async (tx) => {
    for (const { row, values } of prepared) {
      const nif = taxIdKey(values.nif)
      let target = row.action !== 'create' && row.matchId ? byId.get(row.matchId) : undefined
      // El mismo NIF nunca crea otra ficha: completa la que ya hay (de antes o de esta misma importación)
      if (!target && nif) target = byNif.get(nif)
      if (!target) {
        const [res] = await tx.insert(c).values({ ...values, companyId: company.id }).$returningId()
        const fresh = { ...values, id: res!.id, companyId: company.id, archivedAt: null, logoPath: null } as unknown as ContactRow
        byId.set(fresh.id, fresh)
        if (nif) byNif.set(nif, fresh)
        created.push(fresh.id)
        continue
      }
      const patch = contactPatch(target, values, row.action === 'update' ? 'update' : 'fill')
      // Un NIF que ya tiene otra ficha no se copia
      const owner = patch.nif ? byNif.get(taxIdKey(patch.nif)) : undefined
      if (owner && owner.id !== target.id) {
        delete patch.nif
        delete patch.nifType
      }
      const keys = Object.keys(patch) as Array<keyof typeof patch>
      if (!keys.length) {
        skipped++
        continue
      }
      await tx.update(c).set(patch).where(and(eq(c.id, target.id), eq(c.companyId, company.id)))
      const t = target as unknown as Record<string, unknown>
      updated.push({ id: target.id, before: Object.fromEntries(keys.map(k => [k, t[k] ?? null])), after: patch as Record<string, unknown> })
      Object.assign(target, patch)
      if (patch.nif) byNif.set(taxIdKey(patch.nif), target)
      if (row.action === 'update') changed++
      else filled++
    }
    const [entry] = await tx.insert(tables.auditLog).values({
      companyId: company.id,
      userId,
      action: 'contact.import',
      entity: 'contact',
      data: { files, created, updated, counts: { created: created.length, filled, updated: changed, skipped } },
      ip,
    }).$returningId()
    importId = entry!.id
  })
  return { importId, created: created.length, filled, updated: changed, skipped }
}

// ─── Deshacer ────────────────────────────────────────────────────────────────

interface ImportLog {
  created?: number[]
  updated?: Array<{ id: number, before: Record<string, unknown>, after: Record<string, unknown> }>
  undoneAt?: string
}

/**
 * Deshace una importación: borra las fichas que creó y que aún no se han usado (las que ya tienen
 * facturas, presupuestos o gastos se quedan) y devuelve a su valor anterior lo que completó, salvo
 * lo que el usuario haya cambiado después.
 */
export async function undoContactImport(companyId: number, importId: number): Promise<ContactImportUndoResult> {
  const db = useDb()
  const [entry] = await db.select().from(tables.auditLog)
    .where(and(eq(tables.auditLog.id, importId), eq(tables.auditLog.companyId, companyId), eq(tables.auditLog.action, 'contact.import')))
  if (!entry) throw createError({ statusCode: 404, statusMessage: 'Importación no encontrada' })
  const data = (entry.data ?? {}) as ImportLog
  if (data.undoneAt) throw createError({ statusCode: 409, statusMessage: 'Esta importación ya se deshizo' })

  const created = [...new Set(data.created ?? [])]
  const used = new Set<number>()
  for (let i = 0; i < created.length; i += 1000) {
    const ids = created.slice(i, i + 1000)
    const [sales, expenses] = await Promise.all([
      db.selectDistinct({ id: tables.salesDocuments.contactId }).from(tables.salesDocuments).where(and(eq(tables.salesDocuments.companyId, companyId), inArray(tables.salesDocuments.contactId, ids))),
      db.selectDistinct({ id: tables.expenses.supplierId }).from(tables.expenses).where(and(eq(tables.expenses.companyId, companyId), inArray(tables.expenses.supplierId, ids))),
    ])
    for (const r of [...sales, ...expenses]) if (r.id) used.add(r.id)
  }
  const recurrings = await db.select({ template: tables.recurrings.template }).from(tables.recurrings).where(eq(tables.recurrings.companyId, companyId))
  for (const r of recurrings) if (r.template?.contactId) used.add(r.template.contactId)
  const removable = created.filter(id => !used.has(id))
  let removed = 0
  for (let i = 0; i < removable.length; i += 1000) removed += (await deleteContacts(companyId, removable.slice(i, i + 1000))).deleted.length

  let restored = 0
  const same = (a: unknown, b: unknown) => (a instanceof Date ? a.toISOString() : a ?? null) === (typeof b === 'string' && a instanceof Date ? new Date(b).toISOString() : b ?? null)
  for (const u of data.updated ?? []) {
    const [cur] = await db.select().from(tables.contacts).where(and(eq(tables.contacts.id, u.id), eq(tables.contacts.companyId, companyId)))
    if (!cur) continue
    const row = cur as unknown as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(u.after)) {
      if (!same(row[k], v)) continue
      const prev = u.before[k] ?? null
      patch[k] = k === 'archivedAt' && typeof prev === 'string' ? new Date(prev) : prev
    }
    if (!Object.keys(patch).length) continue
    await db.update(tables.contacts).set(patch).where(eq(tables.contacts.id, u.id))
    restored++
  }
  await db.update(tables.auditLog).set({ data: { ...data, undoneAt: new Date().toISOString(), undo: { removed, kept: created.length - removable.length, restored } } }).where(eq(tables.auditLog.id, entry.id))
  return { removed, kept: created.length - removable.length, restored }
}
