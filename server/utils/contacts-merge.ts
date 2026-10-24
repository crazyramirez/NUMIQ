import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { nameSimilarity, sameImportParty, taxIdKey } from '../../shared/utils/duplicate-matching'

type Contact = typeof tables.contacts.$inferSelect

export interface DuplicateGroupMember {
  id: number
  name: string
  tradeName: string | null
  nif: string | null
  email: string | null
  phone: string | null
  city: string | null
  isClient: boolean
  isSupplier: boolean
  archived: boolean
  sales: number
  expenses: number
  createdAt: string | null
}

export interface DuplicateGroup {
  /** El mismo NIF: es seguro que son la misma ficha */
  certain: boolean
  reason: string
  /** Propuesta de ficha que se conserva: la que más documentos tiene y, a igualdad, la más completa */
  keepId: number
  members: DuplicateGroupMember[]
}

/** Par de fichas, en orden: «12-40» */
export const pairKey = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`
/** Pares que el usuario marcó como contactos distintos (companies.settings.contactsNotDuplicate) */
export const notDuplicatePairs = (settings: Record<string, unknown> | null) => (Array.isArray(settings?.contactsNotDuplicate) ? settings.contactsNotDuplicate as string[] : [])

const filled = (c: Contact) => ['nif', 'email', 'phone', 'address', 'city', 'iban', 'tradeName', 'website'].filter(k => (c as unknown as Record<string, unknown>)[k]).length

/** ¿Son la misma ficha? El mismo NIF; sin NIF que lo contradiga, el mismo email o teléfono y dirección, o casi el mismo nombre */
function samePair(a: Contact, b: Contact): { certain: boolean, reason: string } | null {
  const na = taxIdKey(a.nif), nb = taxIdKey(b.nif)
  if (na && nb) return na === nb ? { certain: true, reason: `Mismo NIF (${a.nif})` } : null
  if (sameImportParty(a, b)) {
    const email = a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()
    return { certain: false, reason: email ? 'Mismo email' : 'Mismo nombre o mismos datos de contacto' }
  }
  const score = Math.max(nameSimilarity(a.name, b.name), nameSimilarity(a.tradeName, b.name), nameSimilarity(a.name, b.tradeName))
  return score >= 0.75 ? { certain: false, reason: 'Nombre casi igual' } : null
}

/**
 * Fichas que parecen la misma: por NIF, email, teléfono con dirección o un nombre casi igual (erratas,
 * otro orden, siglas). Se agrupan en cadena: si A≈B y B≈C, las tres van juntas.
 */
export async function findDuplicateContacts(companyId: number, ignored: string[] = []): Promise<DuplicateGroup[]> {
  const db = useDb()
  const skip = new Set(ignored)
  const c = tables.contacts
  const contacts = await db.select().from(c).where(eq(c.companyId, companyId))
  const parent = new Map<number, number>(contacts.map(x => [x.id, x.id]))
  const root = (id: number): number => {
    const p = parent.get(id)!
    if (p === id) return id
    const r = root(p)
    parent.set(id, r)
    return r
  }
  const reasons = new Map<string, { certain: boolean, reason: string }>()
  // Por bloques de la primera palabra significativa, NIF y email: no se compara cada ficha con todas
  const buckets = new Map<string, Contact[]>()
  const put = (key: string, x: Contact) => buckets.set(key, [...(buckets.get(key) ?? []), x])
  for (const x of contacts) {
    if (taxIdKey(x.nif)) put(`nif:${taxIdKey(x.nif)}`, x)
    if (x.email) put(`email:${x.email.toLowerCase()}`, x)
    for (const n of [x.name, x.tradeName]) {
      const first = (n ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[a-z0-9]{3,}/g) ?? []
      // Las tres primeras palabras: «García López María» y «María García López» comparten alguna
      for (const w of first.slice(0, 3)) put(`w:${w.slice(0, 4)}`, x)
    }
  }
  for (const list of buckets.values()) {
    if (list.length < 2 || list.length > 400) continue
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!, b = list[j]!
        if (a.id === b.id || root(a.id) === root(b.id) || skip.has(pairKey(a.id, b.id))) continue
        const same = samePair(a, b)
        if (!same) continue
        parent.set(root(a.id), root(b.id))
        reasons.set(pairKey(a.id, b.id), same)
      }
    }
  }
  const groups = new Map<number, Contact[]>()
  for (const x of contacts) {
    const r = root(x.id)
    groups.set(r, [...(groups.get(r) ?? []), x])
  }
  const multi = [...groups.values()].filter(g => g.length > 1)
  if (!multi.length) return []

  const ids = multi.flat().map(x => x.id)
  const [sales, expenses] = await Promise.all([
    db.select({ id: tables.salesDocuments.contactId, n: sql<number>`COUNT(*)`.mapWith(Number) }).from(tables.salesDocuments)
      .where(and(eq(tables.salesDocuments.companyId, companyId), inArray(tables.salesDocuments.contactId, ids))).groupBy(tables.salesDocuments.contactId),
    db.select({ id: tables.expenses.supplierId, n: sql<number>`COUNT(*)`.mapWith(Number) }).from(tables.expenses)
      .where(and(eq(tables.expenses.companyId, companyId), inArray(tables.expenses.supplierId, ids))).groupBy(tables.expenses.supplierId),
  ])
  const salesBy = new Map(sales.map(r => [r.id!, r.n]))
  const expensesBy = new Map(expenses.map(r => [r.id!, r.n]))

  return multi.map((g) => {
    const pairs = [...reasons].filter(([k]) => { const [a, b] = k.split('-').map(Number); return g.some(x => x.id === a) && g.some(x => x.id === b) }).map(([, v]) => v)
    const certain = pairs.some(p => p.certain)
    const docs = (x: Contact) => (salesBy.get(x.id) ?? 0) + (expensesBy.get(x.id) ?? 0)
    const keep = [...g].sort((a, b) => Number(!!a.archivedAt) - Number(!!b.archivedAt) || docs(b) - docs(a) || filled(b) - filled(a) || a.id - b.id)[0]!
    return {
      certain,
      reason: [...new Set(pairs.map(p => p.reason))].join(' · '),
      keepId: keep.id,
      members: g.map(x => ({
        id: x.id, name: x.name, tradeName: x.tradeName, nif: x.nif, email: x.email, phone: x.phone, city: x.city,
        isClient: x.isClient, isSupplier: x.isSupplier, archived: !!x.archivedAt,
        sales: salesBy.get(x.id) ?? 0, expenses: expensesBy.get(x.id) ?? 0, createdAt: x.createdAt ? new Date(x.createdAt).toISOString() : null,
      })).sort((a, b) => Number(b.id === keep.id) - Number(a.id === keep.id) || a.id - b.id),
    }
  }).sort((a, b) => Number(b.certain) - Number(a.certain) || a.members[0]!.name.localeCompare(b.members[0]!.name, 'es'))
}

/** Campos que la ficha que se conserva toma de las otras si no los tiene */
const GAP_FIELDS = ['tradeName', 'contactPerson', 'nif', 'nifType', 'email', 'phone', 'website', 'iban', 'paymentTermsDays', 'irpfRate', 'defaultCategoryId', 'logoPath'] as const
const ADDRESS_FIELDS = ['address', 'postalCode', 'city', 'province', 'country'] as const

/**
 * Une varias fichas en una: sus facturas, presupuestos, gastos, recurrentes e importaciones pasan a la que
 * se conserva, que se completa con lo que le faltaba (NIF, email, dirección…) y suma sus papeles de cliente
 * y proveedor. Dos NIF distintos no se unen nunca. Devuelve lo necesario para deshacerlo.
 */
export async function mergeContacts(companyId: number, keepId: number, mergeIds: number[]) {
  const db = useDb()
  const c = tables.contacts
  const ids = [...new Set(mergeIds.filter(id => id !== keepId))]
  if (!ids.length) throw createError({ statusCode: 400, statusMessage: 'Elige las fichas que quieres unir' })
  const rows = await db.select().from(c).where(and(eq(c.companyId, companyId), inArray(c.id, [keepId, ...ids])))
  const keep = rows.find(r => r.id === keepId)
  const others = rows.filter(r => r.id !== keepId)
  if (!keep || others.length !== ids.length) throw createError({ statusCode: 404, statusMessage: 'Contacto no encontrado' })
  const nifs = new Set(rows.map(r => taxIdKey(r.nif)).filter(Boolean))
  if (nifs.size > 1) throw createError({ statusCode: 409, statusMessage: 'Tienen NIF distintos: son contactos diferentes y no se pueden unir' })

  const patch: Partial<typeof c.$inferInsert> = {}
  const k = keep as unknown as Record<string, unknown>
  for (const o of others) {
    const v = o as unknown as Record<string, unknown>
    for (const f of GAP_FIELDS) if ((k[f] == null || k[f] === '') && (patch as Record<string, unknown>)[f] == null && v[f] != null && v[f] !== '') (patch as Record<string, unknown>)[f] = v[f]
    // La dirección va entera: no se mezcla la calle de una ficha con la ciudad de otra
    if (!keep.address && !keep.city && !patch.address && (o.address || o.city)) for (const f of ADDRESS_FIELDS) (patch as Record<string, unknown>)[f] = v[f]
    if (o.isClient && !keep.isClient) patch.isClient = true
    if (o.isSupplier && !keep.isSupplier) patch.isSupplier = true
    if (o.equivalenceSurcharge && !keep.equivalenceSurcharge) patch.equivalenceSurcharge = true
  }
  const notes = [keep.notes, ...others.map(o => o.notes)].filter((n): n is string => !!n?.trim())
  const uniqueNotes = [...new Set(notes)]
  if (uniqueNotes.length > (keep.notes ? 1 : 0)) patch.notes = uniqueNotes.join('\n').slice(0, 5000)
  const tags = [...new Set([...(keep.tags ?? []), ...others.flatMap(o => o.tags ?? [])])]
  if (tags.length !== (keep.tags ?? []).length) patch.tags = tags.slice(0, 20)

  const s = tables.salesDocuments
  const e = tables.expenses
  const ii = tables.importItems
  /** [documento, ficha de la que venía]: para deshacer la unión */
  const moved = { sales: [] as Array<[number, number]>, expenses: [] as Array<[number, number]>, importItems: [] as Array<[number, number]>, recurrings: [] as Array<[number, number]> }
  await db.transaction(async (tx) => {
    // Los documentos sin copia de los datos del contacto (borradores) se quedan con la suya antes de moverse
    for (const o of others) {
      await tx.update(s).set({ customer: contactSnapshot(o) }).where(and(eq(s.companyId, companyId), eq(s.contactId, o.id), isNull(s.customer)))
      await tx.update(e).set({ supplier: contactSnapshot(o) }).where(and(eq(e.companyId, companyId), eq(e.supplierId, o.id), isNull(e.supplier)))
    }
    moved.sales = (await tx.select({ id: s.id, from: s.contactId }).from(s).where(and(eq(s.companyId, companyId), inArray(s.contactId, ids)))).map(r => [r.id, r.from!])
    moved.expenses = (await tx.select({ id: e.id, from: e.supplierId }).from(e).where(and(eq(e.companyId, companyId), inArray(e.supplierId, ids)))).map(r => [r.id, r.from!])
    moved.importItems = (await tx.select({ id: ii.id, from: ii.contactId }).from(ii).where(and(eq(ii.companyId, companyId), inArray(ii.contactId, ids)))).map(r => [r.id, r.from!])
    if (moved.sales.length) await tx.update(s).set({ contactId: keepId }).where(inArray(s.id, moved.sales.map(m => m[0])))
    if (moved.expenses.length) await tx.update(e).set({ supplierId: keepId }).where(inArray(e.id, moved.expenses.map(m => m[0])))
    if (moved.importItems.length) await tx.update(ii).set({ contactId: keepId }).where(inArray(ii.id, moved.importItems.map(m => m[0])))
    const gone = new Set(ids)
    for (const rec of await tx.select().from(tables.recurrings).where(eq(tables.recurrings.companyId, companyId))) {
      if (rec.template?.contactId != null && gone.has(rec.template.contactId)) {
        moved.recurrings.push([rec.id, rec.template.contactId])
        await tx.update(tables.recurrings).set({ template: { ...rec.template, contactId: keepId } }).where(eq(tables.recurrings.id, rec.id))
      }
    }
    if (Object.keys(patch).length) await tx.update(c).set(patch).where(eq(c.id, keepId))
    await tx.delete(c).where(and(eq(c.companyId, companyId), inArray(c.id, ids)))
  })
  // El logotipo que no pasa a la ficha conservada no se borra: queda para deshacer la unión
  return { keep, merged: others, moved }
}

export type MergeUndo = Awaited<ReturnType<typeof mergeContacts>>

/**
 * Deshace una unión: vuelve a crear las fichas unidas con su id, devuelve a cada una sus documentos y deja
 * la conservada como estaba. Los documentos que se hayan creado después se quedan donde están.
 */
export async function unmergeContacts(companyId: number, data: MergeUndo) {
  const db = useDb()
  const c = tables.contacts
  const s = tables.salesDocuments
  const e = tables.expenses
  const ii = tables.importItems
  const ids = data.merged.map(m => m.id)
  await db.transaction(async (tx) => {
    const taken = await tx.select({ id: c.id }).from(c).where(inArray(c.id, ids))
    if (taken.length) throw createError({ statusCode: 409, statusMessage: 'Ya está deshecho' })
    const [kept] = await tx.select({ id: c.id }).from(c).where(and(eq(c.id, data.keep.id), eq(c.companyId, companyId)))
    if (!kept) throw createError({ statusCode: 409, statusMessage: 'La ficha que se conservó ya no existe' })
    const date = (v: unknown) => (v ? new Date(v as string) : null)
    for (const m of data.merged) {
      const { createdAt, updatedAt: _u, archivedAt, ...values } = m
      await tx.insert(c).values({ ...values, companyId, archivedAt: date(archivedAt), createdAt: date(createdAt) ?? new Date() })
    }
    const { id, createdAt: _c, updatedAt: _u, companyId: _co, archivedAt, ...before } = data.keep
    await tx.update(c).set({ ...before, archivedAt: date(archivedAt) }).where(eq(c.id, id))
    // Solo lo que sigue en la ficha conservada: si después se cambió a mano, se respeta
    for (const [doc, from] of data.moved.sales) await tx.update(s).set({ contactId: from }).where(and(eq(s.id, doc), eq(s.companyId, companyId), eq(s.contactId, id)))
    for (const [doc, from] of data.moved.expenses) await tx.update(e).set({ supplierId: from }).where(and(eq(e.id, doc), eq(e.companyId, companyId), eq(e.supplierId, id)))
    for (const [item, from] of data.moved.importItems) await tx.update(ii).set({ contactId: from }).where(and(eq(ii.id, item), eq(ii.contactId, id)))
    for (const [rec, from] of data.moved.recurrings) {
      const [r] = await tx.select().from(tables.recurrings).where(and(eq(tables.recurrings.id, rec), eq(tables.recurrings.companyId, companyId)))
      if (r?.template?.contactId === id) await tx.update(tables.recurrings).set({ template: { ...r.template, contactId: from } }).where(eq(tables.recurrings.id, rec))
    }
  })
}
