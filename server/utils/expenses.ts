import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { findSimilarContact } from '../../shared/utils/duplicate-matching'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha con formato AAAA-MM-DD')

export const expenseInputSchema = z.object({
  kind: z.enum(['invoice', 'ticket', 'payroll', 'social_security', 'tax', 'other']).default('invoice'),
  supplierId: z.number().int().positive().nullish(),
  number: z.string().trim().max(60).nullish(),
  issueDate: isoDate,
  dueDate: isoDate.nullish(),
  categoryId: z.number().int().positive().nullish(),
  description: z.string().trim().max(255).nullish(),
  /** Desglose por tipo de IVA; la cuota se recalcula si no viene */
  taxLines: z.array(z.object({
    base: z.number().finite(),
    vatRate: z.number().min(0).max(100),
    vatAmount: z.number().finite().nullish(),
    surchargeRate: z.number().min(0).max(100).default(0),
  })).min(1).max(10),
  irpfRate: z.number().min(0).max(100).default(0),
  deductiblePct: z.number().min(0).max(100).default(100),
  vatDeductiblePct: z.number().min(0).max(100).default(100),
  reverseCharge: z.boolean().default(false),
  isInvestment: z.boolean().default(false),
  paymentMethod: z.enum(['transfer', 'card', 'cash', 'direct_debit', 'bizum', 'other']).nullish(),
  paid: z.boolean().default(false),
  notes: z.string().max(5000).nullish(),
  /** Escaneo con IA: documento original y proveedor que aún no existe (se crea al guardar) */
  fileId: z.number().int().positive().nullish(),
  newSupplier: importPartySchema.nullish(),
  aiConfidence: z.number().int().min(0).max(100).nullish(),
  /** El usuario confirmó que no es un duplicado: solo frena una coincidencia segura (mismo número, mismo archivo…) */
  allowDuplicate: z.boolean().optional(),
})

export type ExpenseInput = z.infer<typeof expenseInputSchema>

export function expenseTotals(input: Pick<ExpenseInput, 'taxLines' | 'irpfRate'>) {
  const lines = input.taxLines.map((l) => {
    const base = round2(l.base)
    // Respeta la cuota que figura en la factura (puede diferir en céntimos del cálculo)
    const vatAmount = l.vatAmount != null ? round2(l.vatAmount) : pctOf(base, l.vatRate)
    const surchargeAmount = pctOf(base, l.surchargeRate ?? 0)
    return { base, vatRate: l.vatRate, vatAmount, surchargeRate: l.surchargeRate ?? 0, surchargeAmount }
  })
  const taxBase = round2(lines.reduce((s, l) => s + l.base, 0))
  const vatTotal = round2(lines.reduce((s, l) => s + l.vatAmount, 0))
  const surchargeTotal = round2(lines.reduce((s, l) => s + l.surchargeAmount, 0))
  const irpfTotal = pctOf(taxBase, input.irpfRate)
  return { lines, taxBase, vatTotal, surchargeTotal, irpfTotal, total: round2(taxBase + vatTotal + surchargeTotal - irpfTotal) }
}

/**
 * Crea o actualiza un gasto. Uno nuevo se compara antes con los ya registrados (número, proveedor, fecha,
 * importe y concepto) y no se guarda si ya está: 409 con `data.duplicate`. `checkDuplicates: false` solo
 * para quien ya lo ha comprobado a su manera (el banco: cada cargo es un pago distinto).
 */
export async function saveExpense(companyId: number, userId: number, input: ExpenseInput, id?: number, opts: { checkDuplicates?: boolean } = {}) {
  return id ? saveExpenseLocked(companyId, userId, input, id) : withImportLock(companyId, () => saveExpenseLocked(companyId, userId, input, undefined, opts.checkDuplicates ?? true))
}

async function saveExpenseLocked(companyId: number, userId: number, input: ExpenseInput, id?: number, checkDuplicates = false) {
  const db = useDb()
  let supplier = null
  const file = id ? null : await claimScanFile(companyId, input.fileId)
  if (input.supplierId) {
    const [c] = await db.select().from(tables.contacts)
      .where(and(eq(tables.contacts.id, input.supplierId), eq(tables.contacts.companyId, companyId)))
    if (!c) throw createError({ statusCode: 400, statusMessage: 'Proveedor no encontrado' })
    supplier = contactSnapshot(c)
  }
  const t = expenseTotals(input)
  if (!id && checkDuplicates) {
    const duplicate = await findSavedImportDuplicate(companyId, { type: 'expense', kind: input.kind, party: supplier ?? input.newSupplier, number: input.number, issueDate: input.issueDate, total: t.total, description: input.description }, input.fileId, { certainOnly: !!input.allowDuplicate })
    if (duplicate) throw createError({ statusCode: 409, statusMessage: duplicate.label, data: { duplicate } })
  }
  if (!input.supplierId && input.newSupplier) {
    input = { ...input, supplierId: await ensureSupplier(companyId, input.newSupplier) }
    const [c] = await db.select().from(tables.contacts).where(and(eq(tables.contacts.id, input.supplierId!), eq(tables.contacts.companyId, companyId)))
    supplier = c ? contactSnapshot(c) : null
  }
  const values = {
    kind: input.kind,
    supplierId: input.supplierId ?? null,
    supplier,
    number: input.number || null,
    issueDate: input.issueDate,
    dueDate: input.dueDate ?? null,
    categoryId: input.categoryId ?? null,
    description: input.description || null,
    taxBase: t.taxBase,
    vatTotal: t.vatTotal,
    surchargeTotal: t.surchargeTotal,
    irpfRate: input.irpfRate,
    irpfTotal: t.irpfTotal,
    total: t.total,
    deductiblePct: input.deductiblePct,
    vatDeductiblePct: input.vatDeductiblePct,
    reverseCharge: input.reverseCharge,
    isInvestment: input.isInvestment,
    paymentMethod: input.paymentMethod ?? null,
    status: input.paid ? 'paid' as const : 'pending' as const,
    paidTotal: input.paid ? t.total : 0,
    paidAt: input.paid ? new Date() : null,
    notes: input.notes ?? null,
  }
  const expenseId = await db.transaction(async (tx) => {
    let expenseId = id
    if (expenseId) {
      const [e] = await tx.select({ id: tables.expenses.id }).from(tables.expenses)
        .where(and(eq(tables.expenses.id, expenseId), eq(tables.expenses.companyId, companyId)))
      if (!e) throw createError({ statusCode: 404, statusMessage: 'Gasto no encontrado' })
      // Guardarlo es darlo por revisado
      await tx.update(tables.expenses).set({ ...values, reviewed: true, reviewNotes: null }).where(eq(tables.expenses.id, expenseId))
      await tx.delete(tables.expenseTaxLines).where(eq(tables.expenseTaxLines.expenseId, expenseId))
    }
    else {
      const [res] = await tx.insert(tables.expenses).values({ ...values, companyId, createdBy: userId, fileId: file?.id ?? null, aiConfidence: file ? input.aiConfidence ?? null : null }).$returningId()
      expenseId = res!.id
    }
    await tx.insert(tables.expenseTaxLines).values(t.lines.map(l => ({ ...l, expenseId: expenseId! })))
    return expenseId!
  })
  if (file) await db.update(tables.files).set({ linkedType: 'expense', linkedId: expenseId }).where(eq(tables.files.id, file.id))
  // Dar por bueno un gasto de este proveedor resuelve las dudas de los demás suyos
  if (id && input.supplierId) await recheckExpenseReviews(companyId, { supplierId: input.supplierId })
  return expenseId
}

/**
 * Adjunta el documento escaneado a un gasto ya registrado sin él (creado desde el banco, a mano…) en vez
 * de crear otro: completa su número, vencimiento y los datos del proveedor que faltaban. Si el gasto salió
 * de un cargo del banco (fecha del pago, IVA estimado) y el total cuadra, toma la fecha y el desglose de
 * IVA y retención de la factura, que son los que valen para los impuestos.
 */
export async function attachExpenseDocument(companyId: number, expenseId: number, input: {
  fileId: number
  number?: string | null
  dueDate?: string | null
  party?: z.infer<typeof importPartySchema> | null
  issueDate?: string | null
  taxLines?: ExpenseInput['taxLines'] | null
  irpfRate?: number | null
}) {
  return withImportLock(companyId, async () => {
    const db = useDb()
    const [e] = await db.select().from(tables.expenses).where(and(eq(tables.expenses.id, expenseId), eq(tables.expenses.companyId, companyId)))
    if (!e) throw createError({ statusCode: 404, statusMessage: 'Gasto no encontrado' })
    if (e.fileId) throw createError({ statusCode: 409, statusMessage: 'Este gasto ya tiene su documento' })
    const file = (await claimScanFile(companyId, input.fileId))!
    let supplierId = e.supplierId
    if (input.party) {
      if (supplierId) await fillContactGaps(companyId, supplierId, input.party)
      else supplierId = await ensureSupplier(companyId, input.party)
    }
    const [c] = supplierId ? await db.select().from(tables.contacts).where(eq(tables.contacts.id, supplierId)) : []
    const fromBank = !!e.notes?.startsWith('Creado desde el banco')
    const doc = fromBank && input.taxLines?.length ? expenseTotals({ taxLines: input.taxLines, irpfRate: input.irpfRate ?? 0 }) : null
    const fiscal = doc && Math.abs(doc.total - e.total) <= 0.01 ? doc : null
    await db.transaction(async (tx) => {
      await tx.update(tables.expenses).set({
        fileId: file.id,
        number: e.number || input.number?.slice(0, 60) || null,
        dueDate: e.dueDate ?? input.dueDate ?? null,
        supplierId,
        supplier: c ? contactSnapshot(c) : e.supplier,
        ...(fiscal
          ? {
              issueDate: input.issueDate ?? e.issueDate,
              taxBase: fiscal.taxBase,
              vatTotal: fiscal.vatTotal,
              surchargeTotal: fiscal.surchargeTotal,
              irpfRate: input.irpfRate ?? 0,
              irpfTotal: fiscal.irpfTotal,
            }
          : {}),
      }).where(eq(tables.expenses.id, e.id))
      if (fiscal) {
        await tx.delete(tables.expenseTaxLines).where(eq(tables.expenseTaxLines.expenseId, e.id))
        await tx.insert(tables.expenseTaxLines).values(fiscal.lines.map(l => ({ ...l, expenseId: e.id })))
      }
    })
    await db.update(tables.files).set({ linkedType: 'expense', linkedId: e.id }).where(eq(tables.files.id, file.id))
    return { fiscal: !!fiscal }
  })
}

export interface DeductibleGuess {
  deductiblePct: number
  vatDeductiblePct: number
  /** supplier: lo que se marcó la última vez con ese proveedor · category: el % de la categoría */
  source: 'supplier' | 'category' | 'default'
}

/**
 * Deducibilidad que se propone para un gasto nuevo. Manda lo que el usuario marcó la última vez con
 * el mismo proveedor cuando se apartó del % de su categoría (p. ej. «el súper no es deducible»);
 * si no, el % de la categoría elegida y, sin categoría, el último del proveedor o el 100 %.
 */
export async function deductibleGuesser(companyId: number) {
  const db = useDb()
  const e = tables.expenses
  const c = tables.contacts
  const [history, cats] = await Promise.all([
    db.select({
      supplierId: e.supplierId,
      name: sql<string | null>`COALESCE(${c.name}, JSON_UNQUOTE(JSON_EXTRACT(${e.supplier}, '$.name')))`,
      categoryId: e.categoryId,
      deductiblePct: e.deductiblePct,
      vatDeductiblePct: e.vatDeductiblePct,
    }).from(e).leftJoin(c, eq(c.id, e.supplierId))
      .where(eq(e.companyId, companyId))
      .orderBy(desc(e.issueDate), desc(e.id))
      .limit(5000),
    db.select({ id: tables.categories.id, deductiblePct: tables.categories.deductiblePct }).from(tables.categories)
      .where(eq(tables.categories.companyId, companyId)),
  ])
  const catPct = new Map(cats.map(x => [x.id, x.deductiblePct]))
  type Past = { deductiblePct: number, vatDeductiblePct: number, deviates: boolean }
  const bySupplier = new Map<number, Past>()
  const byName = new Map<string, Past>()
  for (const h of history) {
    const usual = (h.categoryId ? catPct.get(h.categoryId) : undefined) ?? 100
    // IVA al 100 % con gasto al 50 % es lo normal en cargos sin IVA: no cuenta como decisión del usuario
    const past = { deductiblePct: h.deductiblePct, vatDeductiblePct: h.vatDeductiblePct, deviates: h.deductiblePct !== usual || h.vatDeductiblePct < usual }
    if (h.supplierId && !bySupplier.has(h.supplierId)) bySupplier.set(h.supplierId, past)
    const key = comparableName(h.name)
    if (key && !byName.has(key)) byName.set(key, past)
  }
  return (q: { supplierId?: number | null, supplierName?: string | null, categoryId?: number | null }): DeductibleGuess => {
    const past = (q.supplierId ? bySupplier.get(q.supplierId) : undefined) ?? (q.supplierName ? byName.get(comparableName(q.supplierName)) : undefined)
    const category = q.categoryId ? catPct.get(q.categoryId) : undefined
    if (past && (past.deviates || category == null)) return { deductiblePct: past.deductiblePct, vatDeductiblePct: past.vatDeductiblePct, source: 'supplier' }
    if (category != null) return { deductiblePct: category, vatDeductiblePct: category, source: 'category' }
    return { deductiblePct: 100, vatDeductiblePct: 100, source: 'default' }
  }
}

/**
 * Proveedor leído de un escaneo, del banco o del asistente: el existente con ese NIF, datos o un nombre
 * parecido («Endesa» y «Endesa Energía, S.A.U.»), completando lo que le falte; si no hay, uno nuevo.
 */
export async function ensureSupplier(companyId: number, p: z.infer<typeof importPartySchema>, notes = 'Creado al escanear una factura') {
  const db = useDb()
  const contacts = await db.select()
    .from(tables.contacts).where(eq(tables.contacts.companyId, companyId))
  const hit = findSimilarContact(contacts, p)
  if (hit) {
    if (!hit.isSupplier) await db.update(tables.contacts).set({ isSupplier: true }).where(eq(tables.contacts.id, hit.id))
    await fillContactGaps(companyId, hit.id, p)
    return hit.id
  }
  const [res] = await db.insert(tables.contacts).values({
    companyId,
    isSupplier: true,
    kind: p.isPerson ? 'person' : 'company',
    name: p.name,
    nif: p.nif,
    nifType: p.nif && !validateNif(p.nif).valid && looksLikeEuVat(p.nif) ? 'vat_eu' : 'nif',
    email: p.email,
    phone: p.phone,
    address: p.address,
    postalCode: p.postalCode,
    city: p.city,
    province: p.province,
    country: p.country,
    notes,
  }).$returningId()
  return res!.id
}
