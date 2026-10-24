import { eq } from 'drizzle-orm'

/**
 * Datos de ejemplo para explorar la app: un año de actividad de un estudio de diseño y desarrollo.
 * Las facturas pasan por la emisión real (numeración y cadena VeriFactu) en orden cronológico.
 */

/** Pseudoaleatorio con semilla: los mismos datos en cada instalación */
function rng(seed = 42) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function cif(letter: string, n: number) {
  const digits = String(n).padStart(7, '0')
  for (let d = 0; d <= 9; d++) {
    const v = `${letter}${digits}${d}`
    if (validateNif(v).valid) return v
  }
  return `${letter}${digits}0`
}
const dni = (n: number) => `${n}${'TRWAGMYFPDXBNJZSQVHLCKE'[n % 23]}`

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

const CLIENTS = [
  { name: 'Lumen Arquitectura SL', nif: cif('B', 8645123), city: 'Madrid', province: 'Madrid', postalCode: '28010', address: 'Calle de Fernando el Santo 14', email: 'admin@lumenarq.es', irpfRate: 15, weight: 5 },
  { name: 'Grupo Mareas Hostelería SL', nif: cif('B', 4612987), city: 'Valencia', province: 'Valencia', postalCode: '46004', address: 'Gran Vía Marqués del Turia 31', email: 'facturas@grupomareas.es', irpfRate: 15, weight: 4 },
  { name: 'Bodegas Altamira SA', nif: cif('A', 2603345), city: 'Logroño', province: 'La Rioja', postalCode: '26001', address: 'Avenida de la Paz 88', email: 'contabilidad@bodegasaltamira.es', irpfRate: 15, weight: 3 },
  { name: 'Clínica Dental Sonrisa SLP', nif: cif('B', 4129876), city: 'Sevilla', province: 'Sevilla', postalCode: '41001', address: 'Calle Sierpes 52', email: 'gestion@clinicasonrisa.es', irpfRate: 15, weight: 2 },
  { name: 'Ecomarket Natural SL', nif: cif('B', 5091234), city: 'Zaragoza', province: 'Zaragoza', postalCode: '50001', address: 'Paseo de la Independencia 20', email: 'hola@ecomarketnatural.es', irpfRate: 15, weight: 2 },
  { name: 'Fundación Horizonte', nif: cif('G', 4877120), city: 'Bilbao', province: 'Bizkaia', postalCode: '48001', address: 'Alameda de Recalde 9', email: 'admin@fundacionhorizonte.org', irpfRate: 15, weight: 1 },
  { name: 'Taller Creativo Brisa SL', nif: cif('B', 2955671), city: 'Málaga', province: 'Málaga', postalCode: '29005', address: 'Calle Larios 7', email: 'cuentas@tallerbrisa.es', irpfRate: 15, weight: 2 },
  { name: 'Laura Martín Ruiz', nif: dni(51234987), city: 'Barcelona', province: 'Barcelona', postalCode: '08013', address: 'Carrer de Provença 401', email: 'laura.martin@correo.es', irpfRate: 0, weight: 1, person: true },
]

const SUPPLIERS = [
  { key: 'coworking', name: 'Coworking Centro Activa SL', nif: cif('B', 8712345), city: 'Madrid', category: 'Alquiler' },
  { key: 'gestoria', name: 'Asesoría Fiscal Prado SL', nif: cif('B', 8790031), city: 'Madrid', category: 'Gestoría y profesionales' },
  { key: 'telecom', name: 'Telecom Conecta SL', nif: cif('B', 1234598), city: 'Madrid', category: 'Suministros' },
  { key: 'software', name: 'Nube Software Europa SL', nif: cif('B', 6543217), city: 'Barcelona', category: 'Software y suscripciones' },
  { key: 'seguros', name: 'Seguros Atlántico SA', nif: cif('A', 1588442), city: 'Madrid', category: 'Seguros' },
  { key: 'papeleria', name: 'Papelería Central SL', nif: cif('B', 2847753), city: 'Madrid', category: 'Material de oficina' },
  { key: 'equipos', name: 'Tecnoequipos Digital SL', nif: cif('B', 8234401), city: 'Madrid', category: 'Equipos e inversiones' },
]

const ITEMS = [
  { name: 'Diseño y desarrollo web corporativa', unitPrice: 2400, unit: 'proyecto' },
  { name: 'Mantenimiento web y hosting gestionado', unitPrice: 120, unit: 'mes' },
  { name: 'Consultoría estratégica digital', unitPrice: 75, unit: 'hora' },
  { name: 'Identidad visual y manual de marca', unitPrice: 1800, unit: 'proyecto' },
  { name: 'Gestión de campañas SEM', unitPrice: 450, unit: 'mes' },
  { name: 'Sesión fotográfica de producto', unitPrice: 600, unit: 'sesión' },
  { name: 'Auditoría SEO técnica', unitPrice: 890, unit: 'informe' },
]

export async function seedDemoData(companyId: number, userId: number) {
  const db = useDb()
  const rand = rng(7)
  const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)]!
  const today = toISODate(new Date())

  const cats = await db.select().from(tables.categories).where(eq(tables.categories.companyId, companyId))
  const catId = (name: string) => cats.find(c => c.name === name)?.id ?? null

  const itemIds: number[] = []
  for (const it of ITEMS) {
    const [r] = await db.insert(tables.items).values({ ...it, companyId, kind: 'service', vatRate: 21 }).$returningId()
    itemIds.push(r!.id)
  }

  const clientIds: Array<{ id: number, irpfRate: number, weight: number }> = []
  for (const c of CLIENTS) {
    const [r] = await db.insert(tables.contacts).values({
      companyId, isClient: true, kind: c.person ? 'person' : 'company', name: c.name, nif: c.nif, email: c.email,
      address: c.address, postalCode: c.postalCode, city: c.city, province: c.province, country: 'ES', paymentTermsDays: 30, irpfRate: c.irpfRate,
    }).$returningId()
    clientIds.push({ id: r!.id, irpfRate: c.irpfRate, weight: c.weight })
  }
  const weighted = clientIds.flatMap(c => Array(c.weight).fill(c) as typeof clientIds)

  const supplierIds: Record<string, number> = {}
  for (const sp of SUPPLIERS) {
    const [r] = await db.insert(tables.contacts).values({
      companyId, isSupplier: true, kind: 'company', name: sp.name, nif: sp.nif, city: sp.city, country: 'ES', defaultCategoryId: catId(sp.category),
    }).$returningId()
    supplierIds[sp.key] = r!.id
  }

  // ─── Facturas: 12 meses hacia atrás, en orden cronológico ──────────────────
  const now = new Date()
  const invoiceDates: string[] = []
  for (let m = 11; m >= 0; m--) {
    const base = new Date(now.getFullYear(), now.getMonth() - m, 1)
    const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate()
    const growth = 1 + (11 - m) * 0.06
    const count = Math.round((3 + rand() * 2) * growth)
    for (let i = 0; i < count; i++) {
      const day = 1 + Math.floor(rand() * daysInMonth)
      const iso = toISODate(new Date(base.getFullYear(), base.getMonth(), day))
      if (iso <= today) invoiceDates.push(iso)
    }
  }
  invoiceDates.sort()

  for (const [idx, issueDate] of invoiceDates.entries()) {
    const client = pick(weighted)
    const nLines = rand() < 0.6 ? 1 : 2
    const lines = Array.from({ length: nLines }, () => {
      const i = Math.floor(rand() * ITEMS.length)
      const it = ITEMS[i]!
      const quantity = it.unit === 'hora' ? 4 + Math.floor(rand() * 16) : it.unit === 'mes' ? 1 + Math.floor(rand() * 2) : 1
      return { itemId: itemIds[i], description: it.name, quantity, unitPrice: it.unitPrice, discountPct: rand() < 0.15 ? 10 : 0, vatRate: 21, surchargeRate: 0, irpfApplies: true }
    })
    const id = await saveSalesDraft(companyId, userId, {
      kind: 'invoice', contactId: client.id, issueDate, dueDate: addDays(issueDate, 30), irpfRate: client.irpfRate, paymentMethod: 'transfer', lines,
    })
    // El último, borrador sin emitir
    if (idx === invoiceDates.length - 1) continue
    await issueSalesDocument(companyId, id)

    const age = (Date.now() - new Date(`${issueDate}T12:00:00`).getTime()) / 86_400_000
    // Cobradas casi todas las antiguas; dos vencidas de ejemplo
    const paid = age > 50 ? rand() > 0.06 : age > 25 ? rand() > 0.45 : rand() > 0.85
    if (paid) {
      const [doc] = await db.select({ total: tables.salesDocuments.total }).from(tables.salesDocuments).where(eq(tables.salesDocuments.id, id))
      const payDate = addDays(issueDate, 10 + Math.floor(rand() * 30))
      await db.insert(tables.payments).values({ companyId, direction: 'in', salesDocumentId: id, amount: doc!.total, date: payDate > today ? today : payDate, method: 'transfer' })
      await refreshPaidStatus(id)
    }
  }

  // ─── Presupuestos ──────────────────────────────────────────────────────────
  const quotes: Array<{ status: 'accepted' | 'sent' | 'rejected', daysAgo: number, item: number, client: number }> = [
    { status: 'sent', daysAgo: 4, item: 0, client: 4 },
    { status: 'sent', daysAgo: 11, item: 3, client: 6 },
    { status: 'accepted', daysAgo: 20, item: 6, client: 0 },
    { status: 'rejected', daysAgo: 45, item: 5, client: 5 },
  ]
  for (const q of quotes) {
    const issueDate = addDays(today, -q.daysAgo)
    const it = ITEMS[q.item]!
    const id = await saveSalesDraft(companyId, userId, {
      kind: 'quote', contactId: clientIds[q.client]!.id, issueDate, dueDate: addDays(issueDate, 30), irpfRate: clientIds[q.client]!.irpfRate, paymentMethod: 'transfer',
      lines: [{ itemId: itemIds[q.item], description: it.name, quantity: 1, unitPrice: it.unitPrice, discountPct: 0, vatRate: 21, surchargeRate: 0, irpfApplies: true }],
    })
    await issueSalesDocument(companyId, id)
    await db.update(tables.salesDocuments).set({ status: q.status }).where(eq(tables.salesDocuments.id, id))
  }

  // ─── Gastos ────────────────────────────────────────────────────────────────
  const expense = async (e: { supplier?: string, category: string, kind?: 'invoice' | 'ticket' | 'social_security', date: string, base: number, vat: number, irpf?: number, description: string, number?: string, deductiblePct?: number, vatDeductiblePct?: number, isInvestment?: boolean }) => {
    const paid = e.date < addDays(today, -5)
    await saveExpense(companyId, userId, {
      kind: e.kind ?? 'invoice',
      supplierId: e.supplier ? supplierIds[e.supplier] : null,
      number: e.number ?? null,
      issueDate: e.date,
      dueDate: e.date,
      categoryId: catId(e.category),
      description: e.description,
      taxLines: [{ base: e.base, vatRate: e.vat, surchargeRate: 0 }],
      irpfRate: e.irpf ?? 0,
      deductiblePct: e.deductiblePct ?? 100,
      vatDeductiblePct: e.vatDeductiblePct ?? 100,
      reverseCharge: false,
      isInvestment: e.isInvestment ?? false,
      paymentMethod: e.kind === 'ticket' ? 'card' : 'direct_debit',
      paid,
    }, undefined, { checkDuplicates: false })
  }

  for (let m = 11; m >= 0; m--) {
    const y = new Date(now.getFullYear(), now.getMonth() - m, 1)
    const ym = toISODate(y).slice(0, 7)
    const d = (day: number) => `${ym}-${String(day).padStart(2, '0')}`
    const n = String(12 - m).padStart(3, '0')
    if (d(1) > today) continue
    await expense({ supplier: 'coworking', category: 'Alquiler', date: d(1), base: 280, vat: 21, irpf: 19, description: 'Puesto fijo coworking', number: `CA-${ym}-${n}` })
    if (d(28) <= today) await expense({ category: 'Cuota de autónomos', kind: 'social_security', date: d(28), base: 310.5, vat: 0, description: 'Cuota RETA (Seguridad Social)' })
    if (d(5) <= today) await expense({ supplier: 'telecom', category: 'Suministros', date: d(5), base: 49.5, vat: 21, description: 'Fibra y línea móvil', number: `TC${ym.replace('-', '')}${n}` })
    if (d(8) <= today) await expense({ supplier: 'software', category: 'Software y suscripciones', date: d(8), base: 72 + Math.round(rand() * 30), vat: 21, description: 'Suscripciones de diseño y nube', number: `NS-${n}${Math.floor(rand() * 900 + 100)}` })
    if (d(10) <= today) await expense({ supplier: 'gestoria', category: 'Gestoría y profesionales', date: d(10), base: 85, vat: 21, irpf: 15, description: 'Honorarios gestoría', number: `AFP/${ym}/${n}` })
    if (rand() < 0.45 && d(14) <= today) await expense({ category: 'Viajes y dietas', kind: 'ticket', date: d(14), base: round2(40 + rand() * 160), vat: 10, description: pick(['Comida con cliente', 'Tren AVE reunión', 'Taxi visita cliente', 'Hotel jornada de trabajo']) })
    if (rand() < 0.35 && d(18) <= today) await expense({ supplier: 'papeleria', category: 'Material de oficina', date: d(18), base: round2(15 + rand() * 60), vat: 21, description: 'Material de oficina' })
    if (rand() < 0.3 && d(20) <= today) await expense({ category: 'Publicidad y marketing', date: d(20), base: round2(100 + rand() * 250), vat: 21, description: 'Campaña en redes sociales' })
    if (rand() < 0.4 && d(22) <= today) await expense({ category: 'Vehículo y combustible', kind: 'ticket', date: d(22), base: round2(45 + rand() * 30), vat: 21, description: 'Combustible', deductiblePct: 50, vatDeductiblePct: 50 })
  }
  const seguro = toISODate(new Date(now.getFullYear(), now.getMonth() - 7, 12))
  await expense({ supplier: 'seguros', category: 'Seguros', date: seguro, base: 360, vat: 0, description: 'Seguro de responsabilidad civil profesional', number: `POL-${seguro.slice(0, 4)}-7781` })
  const portatil = toISODate(new Date(now.getFullYear(), now.getMonth() - 4, 9))
  await expense({ supplier: 'equipos', category: 'Equipos e inversiones', date: portatil, base: 1899, vat: 21, description: 'Portátil de trabajo', number: 'TD-24-1187', isInvestment: true })

  // ─── Recurrentes ───────────────────────────────────────────────────────────
  const nextMonth = toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 1))
  await db.insert(tables.recurrings).values([
    { companyId, kind: 'expense', name: 'Coworking', frequency: 'monthly', startDate: nextMonth, nextDate: nextMonth, autoIssue: true, template: { contactId: supplierIds.coworking, categoryId: catId('Alquiler'), expenseKind: 'invoice', taxLines: [{ base: 250, vatRate: 21 }], irpfRate: 19, paid: true, paymentMethod: 'direct_debit', base: 250, total: 255 } },
    { companyId, kind: 'expense', name: 'Cuota de autónomos', frequency: 'monthly', startDate: addDays(nextMonth, 27), nextDate: addDays(nextMonth, 27), autoIssue: true, template: { categoryId: catId('Cuota de autónomos'), expenseKind: 'social_security', taxLines: [{ base: 310.5, vatRate: 0 }], paid: true, paymentMethod: 'direct_debit', base: 310.5, total: 310.5 } },
    { companyId, kind: 'invoice', name: 'Mantenimiento web · Lumen', frequency: 'monthly', startDate: nextMonth, nextDate: nextMonth, autoIssue: false, template: { contactId: clientIds[0]!.id, irpfRate: 15, paymentMethod: 'transfer', lines: [{ description: ITEMS[1]!.name, quantity: 1, unitPrice: 120, vatRate: 21 }], base: 120, total: 127.2 } },
  ])
}
