import { and, asc, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm'

/**
 * Asistente financiero: responde con las cifras reales de la empresa. El modelo no ve la base de
 * datos: pide datos con herramientas de solo lectura, siempre filtradas por la empresa activa.
 */

type Company = typeof tables.companies.$inferSelect

// ─── Herramientas ────────────────────────────────────────────────────────────

const int = { type: ['integer', 'null'] }

function toolDefs() {
  const fn = (name: string, description: string, properties: Record<string, unknown> = {}) => ({
    type: 'function',
    name,
    description,
    strict: true,
    parameters: { type: 'object', additionalProperties: false, required: Object.keys(properties), properties },
  })
  return [
    fn('resumen_periodo', 'Cuenta de resultados de un año, trimestre o mes: ingresos, gastos, beneficio, margen, IVA repercutido y soportado, retenciones (111, 115), estimación del 130, mejores clientes y proveedores, gastos por categoría y comparación con el periodo anterior y el mismo del año pasado.', {
      anio: { type: 'integer', description: 'Año, p. ej. 2026' },
      trimestre: { ...int, description: '1 a 4, o null para el año o un mes' },
      mes: { ...int, description: '1 a 12, o null' },
    }),
    fn('cobros_pendientes', 'Facturas emitidas pendientes de cobro con cliente, importe pendiente, vencimiento y días de retraso.'),
    fn('pagos_pendientes', 'Gastos y facturas recibidas pendientes de pago.'),
    fn('banco', 'Saldo de las cuentas bancarias importadas, últimos movimientos y cuántos quedan por conciliar.'),
    fn('calendario_fiscal', 'Próximos plazos de impuestos (303, 130, 111, 115, 390, 190, 180, 347, renta…) con el importe estimado de cada modelo trimestral y si ya consta presentado.'),
    fn('evolucion_mensual', 'Ingresos, gastos y beneficio mes a mes de los últimos meses.', {
      meses: { type: 'integer', description: 'Cuántos meses hacia atrás (1 a 36), incluido el actual' },
    }),
    fn('buscar', 'Busca clientes, proveedores, facturas emitidas y gastos por nombre, NIF, número o concepto.', {
      texto: { type: 'string' },
    }),
    fn('detalle_factura', 'Detalle completo de una factura emitida o recibida por su número (líneas, importes, estado, cobros).', {
      numero: { type: 'string' },
    }),
    fn('crear_borrador', 'Crea un BORRADOR de factura o presupuesto para un cliente que ya existe (no se emite ni se envía: el usuario lo revisa y lo emite él). Úsalo solo cuando el usuario pida preparar una factura o un presupuesto. Si faltan el cliente o los conceptos, pregúntalos antes.', {
      tipo: { type: 'string', enum: ['factura', 'presupuesto'] },
      cliente: { type: 'string', description: 'Nombre o NIF del cliente tal como lo dice el usuario' },
      lineas: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['concepto', 'cantidad', 'precio', 'iva'],
          properties: {
            concepto: { type: 'string' },
            cantidad: { type: 'number' },
            precio: { type: ['number', 'null'], description: 'Precio unitario sin IVA; null para usar el del catálogo' },
            iva: { type: ['number', 'null'], description: 'Tipo de IVA; null para el habitual' },
          },
        },
      },
      fecha: { type: ['string', 'null'], description: 'AAAA-MM-DD; null = hoy' },
      notas: { type: ['string', 'null'] },
    }),
    fn('clasificar_movimientos_banco', 'Busca cargos o movimientos bancarios de gasto por nombre de proveedor, ordenante o concepto (p. ej. "Paloma García", "Endesa", "Repsol") y los clasifica y asigna como gasto a una categoría contable (p. ej. "Asesoría y gestión", "Suministros", "Combustible"). Si ya estaban conciliados previamente, los reclasifica a la nueva categoría. Úsalo cuando el usuario te pida cambiar, asignar o clasificar movimientos del banco.', {
      filtro_texto: { type: 'string', description: 'Nombre del proveedor, ordenante o texto del concepto a buscar (p. ej. "Paloma García")' },
      categoria: { type: 'string', description: 'Nombre o subcuenta de la categoría de gasto donde asignar (p. ej. "Asesoría y gestión", "Suministros", "Combustible", "623")' },
      proveedor: { type: ['string', 'null'], description: 'Nombre limpio del proveedor o comercio; null para usar el texto del filtro o el ordenante' },
      tipo_iva: { type: ['number', 'null'], description: 'Tipo de IVA (21, 10, 4, 0); null para el habitual de la categoría o 21 %' },
      tipo_gasto: { type: ['string', 'null'], enum: ['ticket', 'invoice', 'payroll', 'social_security', 'other', null], description: 'Tipo de gasto: ticket o invoice por defecto' },
    }),
  ]
}

export const TOOL_LABELS: Record<string, string> = {
  resumen_periodo: 'Revisando tus cifras',
  cobros_pendientes: 'Mirando los cobros pendientes',
  pagos_pendientes: 'Mirando los pagos pendientes',
  calendario_fiscal: 'Calculando tus impuestos',
  evolucion_mensual: 'Analizando la evolución',
  buscar: 'Buscando en tus datos',
  detalle_factura: 'Abriendo la factura',
  crear_borrador: 'Preparando el borrador',
  clasificar_movimientos_banco: 'Asignando movimientos del banco',
  banco: 'Mirando el banco',
}

/** Saldos y últimos movimientos del banco */
async function bancoResumen(company: Company) {
  const db = useDb()
  const t = tables.bankTransactions
  const [accounts, recent, pending] = await Promise.all([
    db.select().from(tables.bankAccounts).where(eq(tables.bankAccounts.companyId, company.id)),
    db.select({ fecha: t.date, importe: t.amount, concepto: t.description, estado: t.status }).from(t).where(eq(t.companyId, company.id)).orderBy(desc(t.date), desc(t.id)).limit(15),
    db.select({ n: sql<number>`COUNT(*)`.mapWith(Number) }).from(t).where(and(eq(t.companyId, company.id), eq(t.status, 'pending'))),
  ])
  if (!accounts.length) return { aviso: 'Aún no hay extractos importados: se suben en Banco (/banco) en formato Norma 43, Excel o CSV.' }
  return {
    cuentas: accounts.map(a => ({ nombre: a.name, iban: a.iban ? `${a.iban.slice(0, 4)}···${a.iban.slice(-4)}` : null, saldo: a.balance, saldoA: a.balanceAt })),
    saldoTotal: round2(accounts.reduce((s, a) => s + a.balance, 0)),
    porConciliar: pending[0]?.n ?? 0,
    ultimosMovimientos: recent,
    enlace: '/banco',
  }
}

const r2 = (n: number | null | undefined) => (n == null ? null : round2(n))

async function resumenPeriodo(company: Company, a: { anio: number, trimestre: number | null, mes: number | null }) {
  const period = resolveReportPeriod(a.anio, a.trimestre && a.trimestre >= 1 && a.trimestre <= 4 ? a.trimestre : null, a.mes && a.mes >= 1 && a.mes <= 12 ? a.mes : null)
  const r = await buildReport(company, period)
  return {
    periodo: r.period.label,
    desde: r.period.from,
    hasta: r.period.to,
    en_curso: r.period.partial,
    cuenta_resultados: r.pnl,
    iva: r.vat.totals,
    iva_repercutido_por_tipo: r.vat.charged,
    retenciones: { soportadas_en_mis_facturas: r.irpf.withheld.amount, modelo_111: r.irpf.m111, modelo_115: r.irpf.m115, modelo_130_estimado: r.irpf.m130 },
    comparacion: r.compare,
    mejores_clientes: r.topClients.slice(0, 6).map(c => ({ ...c, url: c.id ? `/clientes/${c.id}` : null })),
    mayores_proveedores: r.topSuppliers.slice(0, 6).map(c => ({ ...c, url: c.id ? `/proveedores/${c.id}` : null })),
    gastos_por_categoria: r.expensesByCategory.slice(0, 10),
    por_columnas: r.columns.map(c => ({ periodo: c.label, ingresos: c.metrics.income, gastos: c.metrics.expenses, beneficio: c.profit, iva: c.vatResult, m130: c.m130, futuro: c.future })),
    cobros_pendientes: r.receivables,
    pagos_pendientes: r.payables,
  }
}

async function cobrosPendientes(company: Company) {
  const s = tables.salesDocuments
  const c = tables.contacts
  const today = toISODate(new Date())
  const rows = await useDb().select({
    id: s.id, number: s.number, issueDate: s.issueDate, dueDate: s.dueDate, total: s.total, paid: s.paidTotal, status: s.status,
    client: sql<string>`COALESCE(${c.name}, JSON_UNQUOTE(JSON_EXTRACT(${s.customer}, '$.name')))`, email: c.email,
  }).from(s).leftJoin(c, eq(c.id, s.contactId))
    .where(and(eq(s.companyId, company.id), inArray(s.kind, ['invoice', 'rectifying']), inArray(s.status, [...OPEN_STATUSES])))
    .orderBy(asc(s.dueDate)).limit(60)
  const list = rows.map(r => ({
    factura: r.number,
    cliente: r.client,
    email_cliente: r.email,
    emitida: r.issueDate,
    vence: r.dueDate,
    pendiente: round2(r.total - r.paid),
    dias_vencida: r.dueDate && r.dueDate < today ? Math.round((Date.now() - new Date(`${r.dueDate}T12:00:00`).getTime()) / 86_400_000) : 0,
    estado: r.status,
    url: `/facturas/${r.id}`,
  }))
  return {
    total_pendiente: round2(list.reduce((s, x) => s + x.pendiente, 0)),
    total_vencido: round2(list.filter(x => x.dias_vencida > 0).reduce((s, x) => s + x.pendiente, 0)),
    facturas: list,
  }
}

async function pagosPendientes(company: Company) {
  const e = tables.expenses
  const rows = await useDb().select({ id: e.id, number: e.number, issueDate: e.issueDate, dueDate: e.dueDate, total: e.total, paid: e.paidTotal, supplier: e.supplier, description: e.description })
    .from(e).where(and(eq(e.companyId, company.id), inArray(e.status, ['pending', 'partial'])))
    .orderBy(asc(e.dueDate)).limit(60)
  const list = rows.map(r => ({ proveedor: r.supplier?.name ?? null, numero: r.number, concepto: r.description, fecha: r.issueDate, vence: r.dueDate, pendiente: round2(r.total - r.paid), url: `/gastos?ver=${r.id}` }))
  return { total_pendiente: round2(list.reduce((s, x) => s + x.pendiente, 0)), gastos: list }
}

async function calendarioFiscal(company: Company) {
  const now = new Date()
  const upcoming = upcomingDeadlines(now, company.kind, 6)
  const filings = await useDb().select({ model: tables.taxFilings.model, year: tables.taxFilings.year, period: tables.taxFilings.period, status: tables.taxFilings.status, result: tables.taxFilings.result })
    .from(tables.taxFilings).where(eq(tables.taxFilings.companyId, company.id))
  const applies130 = company.kind === 'autonomo' && company.taxRegime !== 'modulos'
  const out = []
  for (const d of upcoming) {
    const m = d.period.match(/^([1-4])T (\d{4})$/)
    let estimates: Record<string, unknown> | null = null
    if (m) {
      const q = Number(m[1]) as Quarter
      const y = Number(m[2])
      const { from, to } = quarterRange(y, q)
      const [m303, m130, w] = await Promise.all([estimate303(company.id, y, q), applies130 ? estimate130(company.id, y, q) : Promise.resolve(null), withholdings(company.id, from, to)])
      estimates = { '303': m303, ...(m130 ? { '130': m130 } : {}), '111': w.m111, '115': w.m115 }
    }
    out.push({
      modelos: d.models,
      concepto: d.title,
      periodo: d.period,
      plazo_desde: d.start,
      plazo_hasta: d.end,
      estimaciones: estimates,
      presentado: filings.filter(f => d.models.includes(f.model) && d.period.includes(String(f.year))).map(f => ({ modelo: f.model, estado: f.status, resultado: f.result })),
    })
  }
  return { hoy: toISODate(now), plazos: out, url_impuestos: '/impuestos' }
}

async function buscar(company: Company, texto: string) {
  const term = `%${texto.trim().slice(0, 80)}%`
  const db = useDb()
  const c = tables.contacts
  const s = tables.salesDocuments
  const e = tables.expenses
  const [contacts, docs, exps] = await Promise.all([
    db.select({ id: c.id, name: c.name, nif: c.nif, email: c.email, isClient: c.isClient, isSupplier: c.isSupplier }).from(c)
      .where(and(eq(c.companyId, company.id), isNull(c.archivedAt), or(like(c.name, term), like(c.tradeName, term), like(c.nif, term), like(c.email, term)))).limit(8),
    db.select({ id: s.id, kind: s.kind, number: s.number, status: s.status, total: s.total, date: s.issueDate, client: sql<string>`COALESCE(${c.name}, JSON_UNQUOTE(JSON_EXTRACT(${s.customer}, '$.name')))` })
      .from(s).leftJoin(c, eq(c.id, s.contactId))
      .where(and(eq(s.companyId, company.id), or(like(s.number, term), like(c.name, term)))).orderBy(desc(s.issueDate)).limit(10),
    db.select({ id: e.id, number: e.number, description: e.description, total: e.total, date: e.issueDate, supplier: c.name }).from(e).leftJoin(c, eq(c.id, e.supplierId))
      .where(and(eq(e.companyId, company.id), or(like(e.number, term), like(e.description, term), like(c.name, term)))).orderBy(desc(e.issueDate)).limit(10),
  ])
  return {
    contactos: contacts.map(x => ({ ...x, url: x.isClient ? `/clientes/${x.id}` : `/proveedores/${x.id}` })),
    documentos: docs.map(x => ({ ...x, url: x.kind === 'quote' || x.kind === 'proforma' ? `/presupuestos/${x.id}` : `/facturas/${x.id}` })),
    gastos: exps.map(x => ({ ...x, url: `/gastos?ver=${x.id}` })),
  }
}

async function detalleFactura(company: Company, numero: string) {
  const db = useDb()
  const n = numero.trim()
  const [doc] = await db.select({ id: tables.salesDocuments.id }).from(tables.salesDocuments)
    .where(and(eq(tables.salesDocuments.companyId, company.id), eq(tables.salesDocuments.number, n))).limit(1)
  if (doc) {
    const d = await loadSalesDocument(company.id, doc.id)
    return {
      tipo: d.kind, numero: d.number, estado: d.status, fecha: d.issueDate, vence: d.dueDate, cliente: d.customer?.name ?? d.contact?.name ?? null,
      lineas: d.lines.map(l => ({ concepto: l.description, cantidad: l.quantity, precio: l.unitPrice, descuento: l.discountPct, iva: l.vatRate, base: l.base })),
      base: d.taxBase, iva: d.vatTotal, recargo: d.surchargeTotal, irpf: d.irpfTotal, total: d.total, cobrado: d.paidTotal,
      cobros: d.payments.map(p => ({ fecha: p.date, importe: p.amount, forma: p.method })),
      importada: d.imported,
      url: `/facturas/${d.id}`,
    }
  }
  const [exp] = await db.select().from(tables.expenses).where(and(eq(tables.expenses.companyId, company.id), eq(tables.expenses.number, n))).limit(1)
  if (exp) {
    return { tipo: 'gasto', numero: exp.number, proveedor: exp.supplier?.name ?? null, fecha: exp.issueDate, concepto: exp.description, base: exp.taxBase, iva: exp.vatTotal, irpf: exp.irpfTotal, total: exp.total, pagado: exp.paidTotal, estado: exp.status, url: `/gastos?ver=${exp.id}` }
  }
  return { error: `No hay ninguna factura con el número ${n}` }
}

interface DraftLine { concepto: string, cantidad: number, precio: number | null, iva: number | null }

const STOP_WORDS = new Set(['del', 'las', 'los', 'para', 'por', 'con', 'una', 'uno', 'mes', 'mensual', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre', 'servicio', 'servicios'])

/** Borrador de factura o presupuesto pedido en el chat: cliente existente, precios del catálogo si no se dan */
async function crearBorrador(company: Company, actor: Actor, a: { tipo: string, cliente: string, lineas: DraftLine[], fecha: string | null, notas: string | null }) {
  if (actor.role === 'advisor') return { error: 'Tu rol (gestor) solo permite consultar: no puedes crear documentos' }
  const db = useDb()
  const q = a.cliente.trim()
  if (!q) return { error: 'Falta el cliente' }
  if (!a.lineas.length) return { error: 'Faltan los conceptos' }
  const contacts = await db.select().from(tables.contacts).where(and(eq(tables.contacts.companyId, company.id), isNull(tables.contacts.archivedAt)))
  const nif = normalizeNif(q)
  const target = comparableName(q)
  let matches = contacts.filter(c => c.nif && normalizeNif(c.nif) === nif)
  if (!matches.length) matches = contacts.filter(c => comparableName(c.name) === target || (c.tradeName && comparableName(c.tradeName) === target))
  if (!matches.length) matches = contacts.filter(c => comparableName(c.name).includes(target) || (c.tradeName && comparableName(c.tradeName).includes(target)))
  if (!matches.length) return { error: `No hay ningún cliente que coincida con "${q}". Puede crearlo en Clientes (/clientes?nuevo=1) o decirte otro nombre.` }
  if (matches.length > 1) return { error: 'Hay varios clientes que coinciden: pregunta cuál', candidatos: matches.slice(0, 6).map(c => ({ nombre: c.name, nif: c.nif })) }
  const client = matches[0]!
  const catalog = await db.select().from(tables.items).where(and(eq(tables.items.companyId, company.id), isNull(tables.items.archivedAt)))
  // Producto del catálogo por palabras significativas ("mantenimiento web de noviembre" → "Mantenimiento web y hosting")
  const words = (s: string) => comparableName(s).split(' ').filter(w => w.length > 2 && !STOP_WORDS.has(w))
  const bestItem = (concept: string) => {
    const a = new Set(words(concept))
    let best: { item: typeof catalog[number], score: number } | null = null
    for (const item of catalog) {
      const b = words(item.name)
      if (!a.size || !b.length) continue
      const shared = b.filter(w => a.has(w)).length
      const score = shared / Math.min(a.size, b.length)
      if (shared >= 1 && score >= 0.6 && (!best || score > best.score)) best = { item, score }
    }
    return best?.item
  }
  const lines = a.lineas.slice(0, 50).map((l) => {
    const name = comparableName(l.concepto)
    const item = catalog.find(i => comparableName(i.name) === name) ?? bestItem(l.concepto)
    return {
      itemId: item?.id ?? null,
      description: l.concepto.trim().slice(0, 2000) || item?.name || 'Concepto',
      quantity: l.cantidad || 1,
      unitPrice: l.precio ?? item?.unitPrice ?? 0,
      discountPct: 0,
      vatRate: l.iva ?? item?.vatRate ?? company.defaultVatRate ?? 21,
      surchargeRate: client.equivalenceSurcharge ? SURCHARGE_BY_VAT[l.iva ?? item?.vatRate ?? 21] ?? 0 : 0,
      irpfApplies: true,
    }
  })
  const issueDate = a.fecha && /^\d{4}-\d{2}-\d{2}$/.test(a.fecha) ? a.fecha : toISODate(new Date())
  const terms = client.paymentTermsDays ?? company.paymentTermsDays
  const due = new Date(`${issueDate}T12:00:00`)
  due.setDate(due.getDate() + terms)
  const kind = a.tipo === 'presupuesto' ? 'quote' as const : 'invoice' as const
  // Retención: la del cliente o, si es empresa o profesional, la habitual de la empresa
  const irpfRate = kind === 'invoice' ? (client.irpfRate ?? (client.kind === 'company' && company.kind === 'autonomo' ? company.defaultIrpfRate : 0)) : 0
  const id = await saveSalesDraft(company.id, actor.id, {
    kind,
    contactId: client.id,
    issueDate,
    dueDate: toISODate(due),
    irpfRate,
    paymentMethod: 'transfer',
    notes: a.notas,
    lines,
  } as SalesInput)
  const totals = computeTotals(lines, irpfRate)
  const missingPrice = lines.some(l => !l.unitPrice)
  return {
    creado: true,
    tipo: a.tipo,
    cliente: client.name,
    base: totals.taxBase,
    iva: totals.vatTotal,
    retencion: totals.irpfTotal,
    total: totals.total,
    lineas: lines.map(l => ({ concepto: l.description, cantidad: l.quantity, precio: l.unitPrice, iva: l.vatRate })),
    aviso: missingPrice ? 'Alguna línea quedó sin precio: que lo complete al revisar' : null,
    url: kind === 'quote' ? `/presupuestos/${id}/editar` : `/facturas/${id}/editar`,
  }
}

/** Reclasifica y asigna movimientos bancarios a una categoría de gasto a petición del usuario */
async function clasificarMovimientosBanco(company: Company, actor: Actor, a: {
  filtro_texto: string
  categoria: string
  proveedor?: string | null
  tipo_iva?: number | null
  tipo_gasto?: 'ticket' | 'invoice' | 'payroll' | 'social_security' | 'other' | null
}) {
  if (actor.role === 'advisor') return { error: 'Tu rol (gestor) solo permite consultar: no puedes modificar movimientos ni gastos' }
  const db = useDb()
  const filterNorm = comparableName(a.filtro_texto)
  if (!filterNorm) return { error: 'Debes indicar el texto o nombre a buscar en los movimientos' }

  // 1. Localizar la categoría de gasto en la empresa
  const allCategories = await db.select().from(tables.categories)
    .where(and(eq(tables.categories.companyId, company.id), eq(tables.categories.kind, 'expense')))

  const catTarget = comparableName(a.categoria)
  let category = allCategories.find(c => comparableName(c.name) === catTarget || c.accountCode === a.categoria)
    ?? allCategories.find(c => comparableName(c.name).includes(catTarget) || catTarget.includes(comparableName(c.name)))

  if (!category) {
    if (/asesor|gestor|abogad|notar|profesional/i.test(catTarget)) {
      category = allCategories.find(c => c.accountCode === '623' || /asesor|profesional/i.test(c.name))
    }
    else if (/suministro|luz|agua|gas|electric/i.test(catTarget)) {
      category = allCategories.find(c => c.accountCode === '628' || /suministro/i.test(c.name))
    }
    else if (/nomina|sueldo|salario/i.test(catTarget)) {
      category = allCategories.find(c => c.accountCode === '640' || /sueldo|n[oó]mina/i.test(c.name))
    }
    else if (/seguridad social|reta|autonomo/i.test(catTarget)) {
      category = allCategories.find(c => c.accountCode === '642' || /seguridad social|aut[oó]nomo/i.test(c.name))
    }
    else if (/banco|comision/i.test(catTarget)) {
      category = allCategories.find(c => c.accountCode === '626' || /bancari/i.test(c.name))
    }
    else if (/combustible|gasolina|gasoil/i.test(catTarget)) {
      category = allCategories.find(c => /combustible|transporte/i.test(c.name))
    }
    else if (/software|informatic|servidor|hosting/i.test(catTarget)) {
      category = allCategories.find(c => /software|inform[aá]tic|suministro/i.test(c.name))
    }
  }

  // 2. Buscar movimientos bancarios que sean cargos (amount < 0)
  const txs = await db.select().from(tables.bankTransactions)
    .where(and(eq(tables.bankTransactions.companyId, company.id), sql`${tables.bankTransactions.amount} < 0`))
    .orderBy(desc(tables.bankTransactions.date))

  const filterWords = filterNorm.split(' ').filter(w => w.length > 2)
  const matches = txs.filter((tx) => {
    const text = comparableName(`${tx.description} ${tx.counterparty ?? ''} ${tx.reference ?? ''}`)
    if (text.includes(filterNorm)) return true
    return filterWords.length > 0 && filterWords.every(w => text.includes(w))
  })

  if (!matches.length) {
    return {
      aviso: `No he encontrado cargos bancarios que contengan "${a.filtro_texto}". Revisa si en el extracto bancario el proveedor o concepto aparece con otro texto.`,
      enlace: '/banco',
    }
  }

  // 3. Determinar proveedor e IVA
  const supplier = a.proveedor?.trim() || matches[0]?.counterparty || a.filtro_texto.trim()
  const vatRate = a.tipo_iva != null && [0, 4, 5, 10, 21].includes(a.tipo_iva)
    ? a.tipo_iva
    : category?.accountCode === '640' || category?.accountCode === '642' ? 0 : 21

  const kind = a.tipo_gasto ?? (category?.accountCode === '640' ? 'payroll' : category?.accountCode === '642' ? 'social_security' : 'ticket')

  const processed: Array<{ id: number, fecha: string, importe: number, concepto: string, gastoId: number }> = []

  for (const tx of matches) {
    // Si ya estaba conciliado con otro documento, deshacer para reclasificar limpiamente
    if (tx.status === 'matched') {
      await unmatch(company, tx.id)
    }
    const expenseId = await expenseFromTx(company, actor.id, tx.id, {
      kind,
      categoryId: category?.id ?? null,
      supplier,
      vatRate,
      description: tx.description,
    })
    processed.push({ id: tx.id, fecha: tx.date, importe: Math.abs(tx.amount), concepto: tx.description, gastoId: expenseId })
  }

  const total = round2(processed.reduce((s, p) => s + p.importe, 0))

  return {
    asignados: processed.length,
    importeTotal: total,
    categoria: category?.name ?? a.categoria,
    cuentaContable: category?.accountCode ?? null,
    proveedor: supplier,
    iva: `${vatRate} %`,
    movimientos: processed.slice(0, 10).map(p => ({
      fecha: p.fecha,
      importe: p.importe,
      concepto: p.concepto,
      url: `/gastos?ver=${p.gastoId}`,
    })),
    masMovimientos: processed.length > 10 ? processed.length - 10 : 0,
    enlace: '/banco',
  }
}

async function runTool(company: Company, actor: Actor, name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'crear_borrador': return crearBorrador(company, actor, args as unknown as Parameters<typeof crearBorrador>[2])
    case 'clasificar_movimientos_banco': return clasificarMovimientosBanco(company, actor, args as unknown as Parameters<typeof clasificarMovimientosBanco>[2])
    case 'resumen_periodo': return resumenPeriodo(company, { anio: Number(args.anio) || new Date().getFullYear(), trimestre: (args.trimestre as number | null) ?? null, mes: (args.mes as number | null) ?? null })
    case 'cobros_pendientes': return cobrosPendientes(company)
    case 'pagos_pendientes': return pagosPendientes(company)
    case 'banco': return bancoResumen(company)
    case 'calendario_fiscal': return calendarioFiscal(company)
    case 'evolucion_mensual': return monthlySeries(company.id, Math.min(Math.max(Number(args.meses) || 12, 1), 36))
    case 'buscar': return buscar(company, String(args.texto ?? ''))
    case 'detalle_factura': return detalleFactura(company, String(args.numero ?? ''))
    default: return { error: 'Herramienta desconocida' }
  }
}

// ─── Instrucciones ───────────────────────────────────────────────────────────

const REGIMES: Record<string, string> = { directa_simplificada: 'estimación directa simplificada', directa_normal: 'estimación directa normal', modulos: 'módulos', sociedades: 'Impuesto sobre Sociedades' }
const VAT: Record<string, string> = { general: 'régimen general', recargo_equivalencia: 'recargo de equivalencia', criterio_caja: 'criterio de caja', exento: 'exento' }

function systemPrompt(company: Company, userName: string) {
  const today = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return `Eres el asistente financiero y fiscal de NUMIQ, la app de gestión de ${company.tradeName || company.legalName} (${company.kind === 'autonomo' ? 'autónomo' : 'sociedad'}, NIF ${company.nif}, ${REGIMES[company.taxRegime] ?? company.taxRegime}, IVA en ${VAT[company.vatRegime] ?? company.vatRegime}${company.activityDescription ? `, actividad: ${company.activityDescription}` : ''}${company.activityStartDate ? `, alta el ${company.activityStartDate}` : ''}, retención habitual en sus facturas ${company.defaultIrpfRate} %). Hablas con ${userName}. Hoy es ${today}.

Cómo respondes:
- En español de España, claro, cercano y directo. Primero la respuesta; después, si ayuda, el detalle.
- Para cualquier dato de la empresa usa SIEMPRE las herramientas. Nunca inventes ni estimes cifras que puedas consultar. Si un dato no existe, dilo.
- Importes con formato español (1.234,56 €). Los importes de las herramientas son bases imponibles salvo que se diga otra cosa.
- Enlaza facturas, clientes y gastos con los enlaces que devuelven las herramientas, en Markdown: [F2026-0012](/facturas/12).
- Usa listas o tablas Markdown cortas cuando aclaren. Sin títulos grandes. Máximo unas 250 palabras salvo que pidan más detalle.
- Eres experto en fiscalidad española de autónomos y pymes (IVA, IRPF, modelos 303, 130, 111, 115, 349, 390, 190, 180, 347, Renta y Sociedades, gastos deducibles, plazos, VeriFactu). Da consejos prácticos y concretos para esta empresa. En decisiones con riesgo fiscal, recomienda confirmarlo con su asesor en una sola frase.
- Las cifras de impuestos de NUMIQ son estimaciones a partir de lo registrado: dilo si es relevante.
- Puedes preparar BORRADORES de facturas y presupuestos con la herramienta crear_borrador cuando te lo pidan: confirma cliente y conceptos si no están claros, resume lo creado con su total y enlázalo para que lo revise y lo emita. Nunca digas que está emitido o enviado.
- Puedes clasificar, asignar y crear gastos de movimientos del extracto bancario con clasificar_movimientos_banco cuando el usuario te pida asignar o cambiar cargos bancarios (p. ej. "todos los movimientos de Paloma García ponlos como Asesoría" o "asigna los cargos de Repsol a combustible"). Resume cuántos movimientos has asignado con el total y enlaza a Banco (/banco) o a los gastos creados.`
}

// ─── Conversación con streaming ──────────────────────────────────────────────

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export type ChatEvent =
  | { type: 'delta', text: string }
  | { type: 'tool', name: string, label: string }

interface StreamResult {
  text: string
  output: Array<Record<string, unknown>>
  calls: Array<{ name: string, arguments: string, call_id: string }>
}

function chatModel() {
  return String(useRuntimeConfig().openaiChatModel || 'gpt-5.5')
}

async function streamOnce(input: unknown[], tools: unknown[], onDelta: (t: string) => void, signal: AbortSignal): Promise<StreamResult> {
  const s = aiSettings()
  const model = chatModel()
  const reasoning = /^(gpt-5|gpt-6|o\d)/.test(model)
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'authorization': `Bearer ${s.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      input,
      tools,
      stream: true,
      store: false,
      max_output_tokens: 6000,
      ...(reasoning ? { reasoning: { effort: 'low' }, include: ['reasoning.encrypted_content'] } : {}),
    }),
    signal,
  })
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null) as { error?: { message?: string, code?: string } } | null
    if (res.status === 401) throw new AiError('La clave de OpenAI no es válida', 503)
    if (res.status === 429) throw new AiError(body?.error?.code === 'insufficient_quota' ? 'La cuenta de OpenAI no tiene saldo' : 'La IA está saturada: inténtalo en unos segundos', 429)
    throw new AiError(body?.error?.message ?? 'El servicio de IA no responde', 502)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let output: Array<Record<string, unknown>> = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('')
      if (!data || data === '[DONE]') continue
      let ev: { type?: string, delta?: string, response?: { output?: Array<Record<string, unknown>>, error?: { message?: string } }, error?: { message?: string } }
      try {
        ev = JSON.parse(data)
      }
      catch {
        continue
      }
      if (ev.type === 'response.output_text.delta' && ev.delta) {
        text += ev.delta
        onDelta(ev.delta)
      }
      else if (ev.type === 'response.completed' || ev.type === 'response.incomplete') {
        output = ev.response?.output ?? []
      }
      else if (ev.type === 'response.failed' || ev.type === 'error') {
        throw new AiError(ev.response?.error?.message ?? ev.error?.message ?? 'La IA no pudo responder', 502)
      }
    }
  }
  const calls = output.filter(o => o.type === 'function_call') as unknown as StreamResult['calls']
  return { text, output, calls }
}

/**
 * Responde a la última pregunta. Las llamadas a herramientas se resuelven en el servidor y se
 * vuelve a preguntar al modelo hasta que contesta con texto (máximo 6 rondas).
 */
export interface Actor {
  id: number
  name: string
  role: string
}

export async function answer(company: Company, actor: Actor, history: ChatTurn[], emit: (e: ChatEvent) => void, signal: AbortSignal) {
  const userName = actor.name
  const tools = toolDefs()
  let input: unknown[] = [
    { role: 'developer', content: systemPrompt(company, userName) },
    ...history.map(h => ({ role: h.role, content: h.content })),
  ]
  const used: string[] = []
  let text = ''
  for (let round = 0; round < 6; round++) {
    const r = await streamOnce(input, tools, (t) => {
      text += t
      emit({ type: 'delta', text: t })
    }, signal)
    if (!r.calls.length) return { text, tools: used, model: chatModel() }
    const outputs = []
    for (const call of r.calls) {
      if (!used.includes(call.name)) used.push(call.name)
      emit({ type: 'tool', name: call.name, label: TOOL_LABELS[call.name] ?? 'Consultando tus datos' })
      let result: unknown
      try {
        result = await runTool(company, actor, call.name, JSON.parse(call.arguments || '{}'))
      }
      catch (err) {
        console.error('[assistant] herramienta', call.name, err)
        result = { error: 'No se pudo consultar ese dato' }
      }
      outputs.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) })
    }
    input = [...input, ...r.output, ...outputs]
  }
  return { text: text || 'No he podido completar la respuesta. ¿Puedes reformular la pregunta?', tools: used, model: chatModel() }
}

/** Título corto de una conversación a partir de la primera pregunta */
export function conversationTitle(q: string) {
  const t = q.replace(/\s+/g, ' ').trim()
  return t.length > 70 ? `${t.slice(0, 67).replace(/\s\S*$/, '')}…` : t
}
