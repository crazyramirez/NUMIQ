import { and, eq, inArray } from 'drizzle-orm'

type Company = typeof tables.companies.$inferSelect

const isSheetExt = (ext: string) => /^(xlsx?|ods|csv|tsv)$/.test(ext)

const BAD_FILE = 'No encontramos movimientos en el archivo. Descarga el extracto desde tu banca online en formato Norma 43 (AEB 43), Excel o CSV.'

/** Extracto con columnas que no reconocemos: la IA dice cuál es cada una */
async function columnsWithAi(sheets: SheetData[]): Promise<ParsedStatement | null> {
  const sheet = sheets[0]
  if (!sheet) return null
  const preview = sheet.rows.slice(0, 30).map((r, i) => `fila ${i}: ${r.map((c, j) => `[${j}] ${cellText(c).slice(0, 60)}`).join(' | ')}`).join('\n')
  const col = { type: ['integer', 'null'] }
  const { data } = await aiJson<{ found: boolean, headerRow: number, date: number, valueDate: number | null, description: number[], amount: number | null, debit: number | null, credit: number | null, balance: number | null, dateOrder: 'dmy' | 'mdy' | 'ymd' }>({
    name: 'bank_columns',
    effort: 'low',
    system: 'Identificas las columnas de un extracto bancario exportado a hoja de cálculo. Índices de columna empezando en 0. "amount" si hay una sola columna con signo; si no, "debit" (cargos) y "credit" (abonos). headerRow: fila de la cabecera (−1 si no hay). found=false si no es un extracto.',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['found', 'headerRow', 'date', 'valueDate', 'description', 'amount', 'debit', 'credit', 'balance', 'dateOrder'],
      properties: {
        found: { type: 'boolean' },
        headerRow: { type: 'integer' },
        date: { type: 'integer' },
        valueDate: col,
        description: { type: 'array', items: { type: 'integer' } },
        amount: col,
        debit: col,
        credit: col,
        balance: col,
        dateOrder: { type: 'string', enum: ['dmy', 'mdy', 'ymd'] },
      },
    },
    parts: [{ type: 'input_text', text: preview }],
  })
  if (!data.found || (data.amount == null && (data.debit == null || data.credit == null))) return null
  return statementFromColumns(sheet, {
    header: data.headerRow,
    date: data.date,
    valueDate: data.valueDate,
    description: data.description,
    amount: data.amount,
    debit: data.amount == null ? data.debit : null,
    credit: data.amount == null ? data.credit : null,
    balance: data.balance,
    reference: null,
  }, data.dateOrder)
}

export async function readStatement(file: { name: string, data: Buffer }): Promise<ParsedStatement> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!isSheetExt(ext) || ext === 'csv') {
    const text = decodeText(file.data)
    if (isNorma43(text)) {
      const parsed = parseNorma43(text)
      if (parsed.rows.length) return parsed
    }
  }
  let sheets: SheetData[]
  try {
    sheets = readSheets(file.data, isSheetExt(ext) ? ext : 'csv')
  }
  catch {
    throw createError({ statusCode: 422, statusMessage: BAD_FILE })
  }
  let parsed = parseBankSheets(sheets)
  if (!parsed && aiEnabled()) parsed = await columnsWithAi(sheets).catch(() => null)
  if (!parsed?.rows.length) throw createError({ statusCode: 422, statusMessage: BAD_FILE })
  return parsed
}

/**
 * Importa un extracto: identifica la cuenta (la elegida, la del IBAN o una nueva), descarta los movimientos
 * que ya estaban (extractos solapados), actualiza el saldo y busca a qué corresponde cada movimiento nuevo.
 */
export async function importStatement(company: Company, file: { name: string, data: Buffer }, opts: { accountId?: number | null, accountName?: string | null }) {
  const db = useDb()
  const parsed = await readStatement(file)
  const accounts = await db.select().from(tables.bankAccounts).where(eq(tables.bankAccounts.companyId, company.id))
  const clean = (s: string | null) => s?.replace(/\s/g, '').toUpperCase() ?? null
  let account = opts.accountId ? accounts.find(a => a.id === opts.accountId) ?? null : null
  if (opts.accountId && !account) throw createError({ statusCode: 404, statusMessage: 'Cuenta no encontrada' })
  if (account && parsed.iban && account.iban && clean(account.iban) !== parsed.iban) {
    throw createError({ statusCode: 409, statusMessage: `Este extracto es de otra cuenta (${parsed.iban.slice(0, 4)} ··· ${parsed.iban.slice(-4)}). Elige «Detectar la cuenta» o la cuenta correcta.` })
  }
  if (!account && parsed.iban) account = accounts.find(a => clean(a.iban) === parsed.iban) ?? null
  // Sin IBAN, o con un IBAN que aún no tiene ninguna cuenta: la cuenta que ya tiene estos movimientos
  // (un CSV importado antes y ahora el Norma 43 del mismo periodo). Nunca se duplica la cuenta entera.
  const overlap = accounts.length && (!account || !parsed.iban) ? await overlapByAccount(company.id, parsed.rows) : new Map<number, number>()
  const enough = Math.min(parsed.rows.length, Math.max(2, Math.ceil(parsed.rows.length * 0.3)))
  const owner = [...overlap].filter(([id, n]) => n >= enough && accounts.some(a => a.id === id && (!parsed.iban || !a.iban))).sort((a, b) => b[1] - a[1])[0]
  const ownerAccount = owner ? accounts.find(a => a.id === owner[0]) ?? null : null
  if (ownerAccount && ((account && !parsed.iban && ownerAccount.id !== account.id && !overlap.get(account.id)) || (!account && opts.accountName))) {
    throw createError({ statusCode: 409, statusMessage: `Estos movimientos ya están en la cuenta «${ownerAccount.name}». Elige esa cuenta o «Detectar la cuenta».` })
  }
  if (!account && ownerAccount && !opts.accountName) account = ownerAccount
  if (!account && !opts.accountName && accounts.length === 1) {
    // Una sola cuenta: el extracto sin IBAN es suyo; con IBAN, si ella no tiene y el banco no contradice
    const only = accounts[0]!
    const bank = parsed.bankName ?? bankNameOf(parsed.iban)
    if (!parsed.iban || (!only.iban && (!only.bankName || !bank || only.bankName === bank))) account = only
  }
  if (!account) {
    const bankName = parsed.bankName ?? bankNameOf(parsed.iban)
    // "CaixaBank"; con dos cuentas del mismo banco, "CaixaBank ···1332"
    const twin = accounts.some(a => a.bankName && a.bankName === bankName)
    const name = opts.accountName?.trim() || (bankName ? `${bankName}${twin && parsed.iban ? ` ···${parsed.iban.slice(-4)}` : ''}` : 'Cuenta principal')
    const [res] = await db.insert(tables.bankAccounts).values({
      companyId: company.id, name: name.slice(0, 120), bankName, iban: parsed.iban, isDefault: accounts.length === 0,
    }).$returningId()
    const [created] = await db.select().from(tables.bankAccounts).where(eq(tables.bankAccounts.id, res!.id))
    account = created!
  }
  else if (!account.iban && parsed.iban) {
    await db.update(tables.bankAccounts).set({ iban: parsed.iban, bankName: account.bankName ?? parsed.bankName ?? bankNameOf(parsed.iban) }).where(eq(tables.bankAccounts.id, account.id))
  }

  const hashes = txHashes(account.id, parsed.rows)
  // Lo que ya estaba (mismo extracto, uno solapado o el mismo periodo en otro formato) no se vuelve a importar
  const known = await knownMovements(company.id, account.id, parsed.rows, hashes)
  const fresh = parsed.rows.map((r, i) => ({ r, hash: hashes[i]! })).filter((_, i) => !known[i])
  for (let i = 0; i < fresh.length; i += 500) {
    await db.insert(tables.bankTransactions).values(fresh.slice(i, i + 500).map(({ r, hash }) => ({
      companyId: company.id,
      accountId: account!.id,
      date: r.date,
      valueDate: r.valueDate,
      amount: r.amount,
      description: r.description,
      counterparty: r.counterparty,
      reference: r.reference,
      bankCode: r.bankCode,
      balance: r.balance,
      hash,
    })))
  }

  const dates = parsed.rows.map(r => r.date).sort()
  const from = dates[0]!
  const to = dates.at(-1)!
  // El saldo solo avanza: importar un extracto antiguo no pisa el actual
  const balanceDate = new Date(`${to}T23:59:00`)
  const update: Partial<typeof tables.bankAccounts.$inferInsert> = { lastImportAt: new Date() }
  if (parsed.closingBalance != null && (!account.balanceAt || balanceDate >= account.balanceAt)) {
    update.balance = parsed.closingBalance
    update.balanceAt = balanceDate
  }
  await db.update(tables.bankAccounts).set(update).where(eq(tables.bankAccounts.id, account.id))

  let suggested = 0
  if (fresh.length) {
    const ids = await db.select({ id: tables.bankTransactions.id }).from(tables.bankTransactions)
      .where(and(eq(tables.bankTransactions.companyId, company.id), inArray(tables.bankTransactions.hash, fresh.map(f => f.hash).slice(0, 2000))))
    suggested = await suggestMatches(company, ids.map(x => x.id))
  }
  return {
    accountId: account.id,
    accountName: account.name,
    format: parsed.format,
    imported: fresh.length,
    duplicates: parsed.rows.length - fresh.length,
    from,
    to,
    suggested,
  }
}
