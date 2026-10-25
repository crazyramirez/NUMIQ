import pdfmake from 'pdfmake'
import type { PartySnapshot } from '../db/schema'

/**
 * PDF de facturas y presupuestos con pdfmake (JavaScript puro: sin Chrome en el servidor, funciona
 * en Plesk). A4, multipágina: la cabecera de la tabla se repite, las filas no se parten, el bloque
 * de totales nunca queda cortado y cada hoja lleva "Página x de y".
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any

// Manrope no tiene cursiva: se usa la de Inter (muy parecida). Lora, de momento, sin cursiva propia
const FONT_FILES: Record<DesignFont, { regular: string, semi: string, bold: string, italic: string }> = {
  Inter: { regular: 'inter-400', semi: 'inter-600', bold: 'inter-700', italic: 'inter-400i' },
  Lora: { regular: 'lora-400', semi: 'lora-600', bold: 'lora-700', italic: 'lora-400' },
  Manrope: { regular: 'manrope-400', semi: 'manrope-600', bold: 'manrope-700', italic: 'inter-400i' },
}

let fontsReady: Promise<void> | undefined

/** Carga las fuentes (assets del servidor) en el sistema de archivos virtual de pdfmake, una vez */
function ensureFonts() {
  fontsReady ??= (async () => {
    const storage = useStorage('assets:server')
    const fonts: Record<string, { normal: string, bold: string, italics: string, bolditalics: string }> = {}
    for (const [family, f] of Object.entries(FONT_FILES)) {
      for (const file of new Set(Object.values(f))) {
        const raw = await storage.getItemRaw(`fonts/${file}.woff`)
        if (!raw) throw new Error(`Falta la fuente ${file}.woff en server/assets/fonts`)
        pdfmake.virtualfs.writeFileSync(`${file}.woff`, Buffer.from(raw as Uint8Array))
      }
      fonts[family] = { normal: `${f.regular}.woff`, bold: `${f.bold}.woff`, italics: `${f.italic}.woff`, bolditalics: `${f.bold}.woff` }
      fonts[`${family}Semi`] = { normal: `${f.semi}.woff`, bold: `${f.bold}.woff`, italics: `${f.semi}.woff`, bolditalics: `${f.bold}.woff` }
    }
    pdfmake.setFonts(fonts)
    // Solo datos en línea: ni descargas ni lectura de archivos del servidor desde un documento
    pdfmake.setUrlAccessPolicy(() => false)
    pdfmake.setLocalAccessPolicy(() => false)
  })().catch((err) => {
    fontsReady = undefined
    throw err
  })
  return fontsReady
}

export async function renderPdf(definition: Record<string, unknown>) {
  await ensureFonts()
  return pdfmake.createPdf(definition).getBuffer()
}

// ─── Datos de entrada ───────────────────────────────────────────────────────

export interface PdfLine {
  description: string
  quantity: number
  unitPrice: number
  discountPct: number
  vatRate: number
  surchargeRate: number
  irpfApplies: boolean
  base: number
  sku?: string | null
}

export interface PdfDocument {
  kind: string
  status: string
  number: string | null
  issueDate: string
  dueDate: string | null
  operationDate: string | null
  paymentMethod: string | null
  /** Descripción con formato antes de los conceptos */
  description?: RichDoc | null
  notes: string | null
  terms: string | null
  irpfRate: number
  rectificationCode: string | null
  rectificationReason: string | null
  rectifiedNumber?: string | null
  customerReference?: string | null
  issuer: PartySnapshot
  customer: PartySnapshot | null
  lines: PdfLine[]
  verifactu: { qrUrl: string, hash: string } | null
  /** Firma estampada (PNG transparente) con el texto de encima y el nombre de quien firma */
  signature?: { dataUrl: string, label: string, signer: string } | null
}

export interface PdfCompany {
  legalName: string
  tradeName: string | null
  nif: string
  email: string | null
  phone: string | null
  website: string | null
  iban: string | null
  invoiceFooter: string | null
}

export interface PdfLogo {
  dataUrl: string
  svg: string | null
}

// ─── Formato ────────────────────────────────────────────────────────────────

const eurFmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })
const numFmt = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 4, useGrouping: 'always' })
const eur = (n: number) => eurFmt.format(n)
const num = (n: number) => numFmt.format(n)
const date = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—')

const PAYMENT: Record<string, string> = {
  transfer: 'Transferencia', card: 'Tarjeta', cash: 'Efectivo', direct_debit: 'Domiciliación', bizum: 'Bizum', other: 'Otro',
}

const TITLES: Record<string, string> = {
  invoice: 'Factura', rectifying: 'Factura rectificativa', quote: 'Presupuesto', proforma: 'Factura proforma',
}

// ─── Temas: cada estructura cambia cabecera, tabla y totales ────────────────

const INK = '#161a22'
const INK_2 = '#454c5b'
const MUTED = '#7b8291'
const LINE = '#e3e6ec'
const SOFT = '#f5f6f8'

interface Theme {
  header: 'split' | 'centered' | 'band'
  meta: 'boxes' | 'inline'
  partiesBoxed: boolean
  table: { headFill: string | null, headColor: string, headRule: number, rowRule: number, grid: boolean, zebra: string | null }
  total: { fill: string | null, color: string, size: number }
  titleColor: string
  accentBar: boolean
}

function themeFor(d: InvoiceDesign): Theme {
  const a = d.accentColor
  switch (d.layout) {
    case 'classic':
      return {
        header: 'centered', meta: 'boxes', partiesBoxed: true,
        table: { headFill: tint(a, 0.88), headColor: INK, headRule: 0.6, rowRule: 0.6, grid: true, zebra: null },
        total: { fill: a, color: onColor(a), size: 13 }, titleColor: a, accentBar: false,
      }
    case 'minimal':
      return {
        header: 'split', meta: 'inline', partiesBoxed: false,
        table: { headFill: null, headColor: MUTED, headRule: 0.5, rowRule: 0.4, grid: false, zebra: null },
        total: { fill: null, color: a, size: 16 }, titleColor: a, accentBar: false,
      }
    case 'bold':
      return {
        header: 'band', meta: 'boxes', partiesBoxed: false,
        table: { headFill: a, headColor: onColor(a), headRule: 0, rowRule: 0, grid: false, zebra: tint(a, 0.95) },
        total: { fill: a, color: onColor(a), size: 14 }, titleColor: onColor(a), accentBar: false,
      }
    default:
      return {
        header: 'split', meta: 'boxes', partiesBoxed: false,
        table: { headFill: null, headColor: MUTED, headRule: 1.2, rowRule: 0.5, grid: false, zebra: null },
        total: { fill: tint(a, 0.92), color: INK, size: 14 }, titleColor: INK, accentBar: true,
      }
  }
}

// ─── Bloques ────────────────────────────────────────────────────────────────

const label = (text: string, color = MUTED): Node => ({ text: text.toUpperCase(), style: 'label', color })

function partyLines(p: PartySnapshot, extra: Array<string | null | undefined> = []) {
  const place = [[p.postalCode, p.city].filter(Boolean).join(' '), p.province ? `(${p.province})` : ''].filter(Boolean).join(' ')
  return [
    p.nif ? `NIF ${p.nif}` : null,
    p.address,
    place || null,
    p.country && p.country !== 'ES' ? p.country : null,
    ...extra,
  ].filter(Boolean) as string[]
}

function brandBlock(company: PdfCompany, logo: PdfLogo | null, design: InvoiceDesign, color: string, align: 'left' | 'center' = 'left', plate = false): Node {
  const brand = company.tradeName || company.legalName
  if (logo && design.showLogo) {
    const img = logo.svg ? { svg: logo.svg, fit: [150, 56] } : { image: logo.dataUrl, fit: [150, 56] }
    if (!plate) return { ...img, alignment: align, margin: [0, 0, 0, 2] }
    // Sobre una banda de color el logo va en una placa blanca: sus colores siempre se leen
    return {
      table: { widths: ['auto'], body: [[img]] },
      layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => '#ffffff', paddingLeft: () => 10, paddingRight: () => 10, paddingTop: () => 7, paddingBottom: () => 7 },
    }
  }
  return {
    stack: [
      { text: brand, style: 'brand', color },
      company.tradeName ? { text: company.legalName, fontSize: 8.5, color: color === INK ? MUTED : color, margin: [0, 2, 0, 0] } : null,
    ].filter(Boolean),
    alignment: align,
  }
}

function qrBlock(doc: PdfDocument, color: string, semi: string, align: 'left' | 'right' = 'right'): Node | null {
  if (!doc.verifactu) return null
  const text = {
    stack: [
      { text: 'VERI*FACTU', font: semi, fontSize: 8, characterSpacing: 0.6, color },
      { text: 'Factura verificable en la sede electrónica de la AEAT', fontSize: 6.8, color, margin: [0, 2, 0, 0] },
    ],
    width: 96,
    alignment: align,
    margin: [0, 24, 0, 0],
  }
  const qr = { qr: doc.verifactu.qrUrl, fit: 86, eccLevel: 'M', foreground: '#11141b', background: '#ffffff', width: 'auto' }
  return { columns: align === 'right' ? [text, qr] : [qr, text], columnGap: 8, width: 'auto' }
}

export function buildInvoicePdf(doc: PdfDocument, company: PdfCompany, design: InvoiceDesign, logo: PdfLogo | null) {
  const t = themeFor(design)
  const a = design.accentColor
  const F = design.font
  const SEMI = `${F}Semi`
  const isQuote = doc.kind === 'quote' || doc.kind === 'proforma'
  const title = TITLES[doc.kind] ?? 'Factura'
  const brand = company.tradeName || company.legalName
  const totals = computeTotals(doc.lines, doc.irpfRate)
  const show = lineColumns(design, doc.lines)
  const hasSku = design.showItemCodes && doc.lines.some(l => l.sku)
  const numberText = doc.number ?? 'Borrador'

  // Cabecera de la primera página
  let header: Node
  if (t.header === 'band') {
    const fg = onColor(a)
    const qr = doc.verifactu
      ? {
          table: { widths: ['auto'], body: [[{ qr: doc.verifactu.qrUrl, fit: 70, eccLevel: 'M', foreground: '#11141b', background: '#ffffff' }]] },
          layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => '#ffffff', paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 4, paddingBottom: () => 4 },
          width: 'auto',
        }
      : null
    header = {
      columns: [
        { width: '*', stack: [brandBlock(company, logo, design, fg, 'left', true), { text: partyLines(doc.issuer).slice(0, 1).join(''), fontSize: 8.5, color: fg, margin: [0, 6, 0, 0] }] },
        {
          width: 'auto',
          stack: [
            { text: title.toUpperCase(), font: SEMI, fontSize: 22, characterSpacing: 1.2, color: fg, alignment: 'right' },
            { text: numberText, fontSize: 11, color: fg, alignment: 'right', margin: [0, 4, 0, 0] },
            doc.verifactu ? { text: 'VERI*FACTU · verificable en la AEAT', fontSize: 6.8, color: fg, alignment: 'right', margin: [0, 8, 0, 0] } : null,
          ].filter(Boolean),
        },
        qr,
      ].filter(Boolean),
      columnGap: 14,
      margin: [0, 6, 0, 0],
    }
  }
  else if (t.header === 'centered') {
    header = {
      stack: [
        brandBlock(company, logo, design, INK, 'center'),
        { text: [company.legalName, `NIF ${company.nif}`, ...partyLines(doc.issuer).slice(1, 3)].filter(Boolean).join('  ·  '), fontSize: 8, color: MUTED, alignment: 'center', margin: [0, 6, 0, 0] },
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 507, y2: 0, lineWidth: 1.6, lineColor: a }, { type: 'line', x1: 0, y1: 4, x2: 507, y2: 4, lineWidth: 0.5, lineColor: a }], margin: [0, 12, 0, 14] },
        {
          columns: [
            { width: '*', stack: [{ text: title.toUpperCase(), font: SEMI, fontSize: 18, characterSpacing: 1.5, color: t.titleColor }, { text: numberText, fontSize: 11, color: INK_2, margin: [0, 3, 0, 0] }] },
            qrBlock(doc, MUTED, SEMI),
          ].filter(Boolean),
        },
      ],
    }
  }
  else {
    const minimal = design.layout === 'minimal'
    header = {
      columns: [
        { width: '*', stack: [brandBlock(company, logo, design, INK)] },
        {
          width: 'auto',
          stack: [
            minimal
              ? { text: title, fontSize: 26, color: t.titleColor, alignment: 'right' }
              : { text: title.toUpperCase(), font: SEMI, fontSize: 22, characterSpacing: 1.2, color: t.titleColor, alignment: 'right' },
            { text: numberText, font: SEMI, fontSize: 11, color: doc.number ? INK_2 : MUTED, alignment: 'right', margin: [0, 3, 0, 8] },
            qrBlock(doc, MUTED, SEMI),
          ].filter(Boolean),
        },
      ],
    }
  }

  // Fechas y forma de pago
  const metaItems: Array<[string, string]> = [
    ['Fecha', date(doc.issueDate)],
    [isQuote ? 'Válido hasta' : 'Vencimiento', date(doc.dueDate)],
    ...(doc.operationDate ? [['Fecha de operación', date(doc.operationDate)] as [string, string]] : []),
    ['Forma de pago', PAYMENT[doc.paymentMethod ?? ''] ?? '—'],
    ...(doc.customerReference ? [[design.customerReferenceLabel?.trim() || 'Orden de Pedido', doc.customerReference] as [string, string]] : []),
  ]
  const meta: Node = t.meta === 'boxes'
    ? {
        table: {
          widths: metaItems.map(() => '*'),
          body: [metaItems.map(([k, v]) => ({ stack: [label(k), { text: v, font: SEMI, fontSize: 10, margin: [0, 2, 0, 0] }] }))],
        },
        layout: {
          hLineWidth: () => (design.layout === 'classic' ? 0.6 : 0),
          vLineWidth: (i: number, node: Node) => (design.layout === 'classic' || (i > 0 && i < node.table.widths.length) ? 0.6 : 0),
          hLineColor: () => LINE,
          vLineColor: () => (design.layout === 'classic' ? LINE : '#ffffff'),
          fillColor: () => (design.layout === 'classic' ? null : SOFT),
          paddingLeft: () => 10, paddingRight: () => 10, paddingTop: () => 8, paddingBottom: () => 8,
        },
        margin: [0, t.header === 'band' ? 52 : 26, 0, 0],
      }
    : {
        columns: metaItems.map(([k, v]) => ({ width: 'auto', stack: [label(k), { text: v, fontSize: 10, margin: [0, 2, 0, 0] }] })),
        columnGap: 34,
        margin: [0, 30, 0, 0],
      }

  // Emisor y cliente
  const party = (title: string, p: PartySnapshot | null, extra: Array<string | null | undefined>) => ({
    stack: p
      ? [label(title), { text: p.name, font: SEMI, fontSize: 10.5, margin: [0, 3, 0, 2] }, ...partyLines(p, extra).map(l => ({ text: l, color: INK_2 }))]
      : [label(title), { text: 'Sin cliente', color: MUTED, margin: [0, 3, 0, 0] }],
  })
  const issuerExtra = [[company.email, company.phone].filter(Boolean).join(' · ') || null, company.website]
  const parties: Node = t.partiesBoxed
    ? {
        table: { widths: ['*', '*'], body: [[party('Emisor', doc.issuer, issuerExtra), party('Cliente', doc.customer, [doc.customer?.email])]] },
        layout: { hLineWidth: () => 0.6, vLineWidth: () => 0.6, hLineColor: () => LINE, vLineColor: () => LINE, paddingLeft: () => 12, paddingRight: () => 12, paddingTop: () => 10, paddingBottom: () => 10 },
        margin: [0, 18, 0, 0],
      }
    : { columns: [party('Emisor', doc.issuer, issuerExtra), party('Cliente', doc.customer, [doc.customer?.email])], columnGap: 40, margin: [0, 24, 0, 0] }

  const rectNote: Node | null = doc.kind === 'rectifying'
    ? {
        table: { widths: ['*'], body: [[{ text: [{ text: `Rectificativa ${doc.rectificationCode ?? ''}`, font: SEMI }, doc.rectifiedNumber ? ` de la factura ${doc.rectifiedNumber}` : '', doc.rectificationReason ? ` · ${doc.rectificationReason}` : ''], color: '#9a3412' }]] },
        layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => '#fff7ed', paddingLeft: () => 10, paddingRight: () => 10, paddingTop: () => 7, paddingBottom: () => 7 },
        margin: [0, 18, 0, 0],
      }
    : null

  // Descripción con formato (párrafos, subtítulos y listas) antes de los conceptos
  const runs = (spans: RichSpan[]) => (spans.length
    ? spans.map(s => ({ text: s.t, ...(s.b ? { bold: true } : {}), ...(s.i ? { italics: true } : {}), ...(s.u ? { decoration: 'underline' } : {}) }))
    : ' ')
  const description: Node | null = doc.description?.length
    ? {
        stack: doc.description.map((b, n): Node => {
          const top = n ? 5 : 0
          if (b.k === 'h') return { text: runs(b.c), font: SEMI, fontSize: 10.5, color: INK, margin: [0, n ? 9 : 0, 0, 0] }
          if (b.k === 'p') return { text: runs(b.c), color: INK_2, lineHeight: 1.25, margin: [0, top, 0, 0] }
          const items = b.items.map(it => ({ text: runs(it), color: INK_2, lineHeight: 1.25, margin: [0, 1, 0, 1] }))
          return b.k === 'ul' ? { ul: items, markerColor: a, margin: [0, top, 0, 0] } : { ol: items, markerColor: a, margin: [0, top, 0, 0] }
        }),
        margin: [0, 22, 0, 0],
      }
    : null

  // Tabla de conceptos (no la hay en las facturas «solo descripción»: la descripción explica el trabajo)
  const cols: Array<{ title: string, width: number | string, align: 'left' | 'right', cell: (l: PdfLine) => Node }> = [
    ...(hasSku ? [{ title: 'Ref.', width: 48, align: 'left' as const, cell: (l: PdfLine) => ({ text: l.sku ?? '', color: MUTED, fontSize: 8.5 }) }] : []),
    {
      title: 'Concepto', width: '*', align: 'left',
      cell: (l) => {
        const [first, ...rest] = l.description.split('\n')
        return {
          stack: [
            { text: first, color: INK },
            rest.join('\n').trim() ? { text: rest.join('\n').trim(), fontSize: 8.3, color: MUTED, margin: [0, 2, 0, 0] } : null,
            !l.irpfApplies && doc.irpfRate ? { text: 'Sin retención', fontSize: 7.5, color: MUTED, margin: [0, 2, 0, 0] } : null,
          ].filter(Boolean),
        }
      },
    },
    ...(show.quantity ? [{ title: 'Cant.', width: 38, align: 'right' as const, cell: (l: PdfLine) => ({ text: num(l.quantity) }) }] : []),
    ...(show.price ? [{ title: 'Precio', width: 66, align: 'right' as const, cell: (l: PdfLine) => ({ text: eur(l.unitPrice) }) }] : []),
    ...(show.discount ? [{ title: 'Dto.', width: 34, align: 'right' as const, cell: (l: PdfLine) => ({ text: l.discountPct ? `${num(l.discountPct)} %` : '' }) }] : []),
    ...(show.vat ? [{ title: 'IVA', width: 34, align: 'right' as const, cell: (l: PdfLine) => ({ text: `${num(l.vatRate)} %` }) }] : []),
    ...(show.amount ? [{ title: 'Importe', width: 70, align: 'right' as const, cell: (l: PdfLine) => ({ text: eur(l.base), font: SEMI }) }] : []),
  ]
  const lineTable: Node | null = isConceptless(doc.lines) ? null : {
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: cols.map(c => c.width),
      body: [
        cols.map(c => ({ text: c.title.toUpperCase(), style: 'label', color: t.table.headColor, alignment: c.align })),
        ...doc.lines.map(l => cols.map(c => ({ ...c.cell(l), alignment: c.align }))),
      ],
    },
    layout: {
      hLineWidth: (i: number, node: Node) => {
        if (t.table.grid) return 0.6
        if (i === 0) return 0
        if (i === 1) return t.table.headRule
        return i === node.table.body.length ? (t.table.rowRule ? t.table.rowRule : 0) : t.table.rowRule
      },
      vLineWidth: () => (t.table.grid ? 0.6 : 0),
      hLineColor: (i: number) => (i === 1 && !t.table.grid && design.layout === 'modern' ? INK : LINE),
      vLineColor: () => LINE,
      fillColor: (row: number) => (row === 0 ? t.table.headFill : t.table.zebra && row % 2 === 0 ? t.table.zebra : null),
      paddingLeft: (i: number) => (i === 0 && !t.table.grid && !t.table.headFill ? 0 : 7),
      paddingRight: (i: number, node: Node) => (i === node.table.widths.length - 1 && !t.table.grid && !t.table.headFill ? 0 : 7),
      paddingTop: (row: number) => (row === 0 ? 7 : 6.5),
      paddingBottom: (row: number) => (row === 0 ? 7 : 6.5),
    },
    margin: [0, 26, 0, 0],
  }

  // Totales
  const totalRows: Node[] = [
    [{ text: 'Base imponible', color: INK_2 }, { text: eur(totals.taxBase), alignment: 'right' }],
    ...totals.groups.map(g => [
      { text: [`IVA ${num(g.vatRate)} %`, totals.groups.length > 1 ? { text: `  s/ ${eur(g.base)}`, fontSize: 8, color: MUTED } : ''], color: INK_2 },
      { text: eur(g.vat), alignment: 'right' },
    ]),
    ...(totals.surchargeTotal ? [[{ text: 'Recargo de equivalencia', color: INK_2 }, { text: eur(totals.surchargeTotal), alignment: 'right' }]] : []),
    ...(doc.irpfRate ? [[{ text: `Retención IRPF ${num(doc.irpfRate)} %`, color: '#b42318' }, { text: `${totals.irpfTotal ? '−' : ''}${eur(totals.irpfTotal)}`, alignment: 'right', color: '#b42318' }]] : []),
  ]
  const totalBox: Node = {
    table: {
      widths: ['*', 'auto'],
      body: [[
        { text: 'Total', font: SEMI, fontSize: 11, color: t.total.color, margin: [0, 2, 0, 0] },
        { text: eur(totals.total), font: SEMI, fontSize: t.total.size, color: t.total.color, alignment: 'right' },
      ]],
    },
    layout: {
      hLineWidth: (i: number) => (t.total.fill ? 0 : i === 0 ? 1 : 0),
      vLineWidth: () => 0,
      hLineColor: () => INK,
      fillColor: () => t.total.fill,
      paddingLeft: () => (t.total.fill ? 12 : 0), paddingRight: () => (t.total.fill ? 12 : 0), paddingTop: () => 9, paddingBottom: () => 9,
    },
    margin: [0, 6, 0, 0],
  }
  const totalsBlock: Node = {
    stack: [
      { table: { widths: ['*', 'auto'], body: totalRows }, layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 3, paddingBottom: () => 3 } },
      totalBox,
    ],
  }

  const left: Node[] = []
  const notes = isQuote ? doc.terms : doc.notes
  const notesTitle = (isQuote ? design.termsLabel : design.notesLabel).trim()
  if (notes) left.push({ stack: [...(notesTitle ? [label(notesTitle)] : []), { text: notes, color: INK_2, margin: [0, notesTitle ? 3 : 0, 0, 0] }] })
  if (doc.signature) {
    left.push({
      stack: [
        ...(doc.signature.label ? [label(doc.signature.label)] : []),
        { image: doc.signature.dataUrl, fit: [170, 60], margin: [0, 6, 0, 0] },
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 190, y2: 0, lineWidth: 0.6, lineColor: LINE }], margin: [0, 4, 0, 0] },
        { text: doc.signature.signer, fontSize: 8, color: MUTED, margin: [0, 4, 0, 0] },
      ],
      margin: [0, notes ? 18 : 0, 0, 0],
    })
  }

  const bottom: Node = {
    columns: [{ width: '*', stack: left }, { width: 230, stack: [totalsBlock] }],
    columnGap: 36,
    margin: [0, 22, 0, 0],
    unbreakable: true,
  }

  let paymentNode: Node = null
  if (!isQuote && design.showPaymentInfo) {
    const pay: Node[] = []
    if (design.paymentText) pay.push({ text: design.paymentText, color: INK_2 })
    if (company.iban && (!doc.paymentMethod || doc.paymentMethod === 'transfer')) {
      const cleanIban = company.iban.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()
      pay.push({ text: cleanIban, font: SEMI, color: INK, margin: [0, 2, 0, 0] })
    }
    if (pay.length) {
      paymentNode = {
        stack: [label('Datos de pago'), ...pay.map(p => ({ ...p, margin: [0, 2, 0, 0] }))],
        margin: [0, 18, 0, 0],
        unbreakable: true,
      }
    }
  }

  const legal = design.footerText || company.invoiceFooter || [company.legalName, `NIF ${company.nif}`, company.email, company.website].filter(Boolean).join(' · ')

  const definition: Record<string, unknown> = {
    pageSize: 'A4',
    pageMargins: [44, 50, 44, 62],
    info: { title: `${title} ${numberText} · ${brand}`, author: brand, creator: 'NUMIQ', producer: 'NUMIQ' },
    defaultStyle: { font: F, fontSize: 9.4, color: INK, lineHeight: 1.22 },
    styles: {
      label: { font: SEMI, fontSize: 6.8, characterSpacing: 0.7 },
      brand: { font: SEMI, fontSize: 15, characterSpacing: -0.2 },
    },
    background: (page: number, size: { width: number }) => {
      if (page !== 1) return null
      if (t.header === 'band') return { canvas: [{ type: 'rect', x: 0, y: 0, w: size.width, h: 150, color: a }] }
      if (t.accentBar) return { canvas: [{ type: 'rect', x: 0, y: 0, w: size.width, h: 6, color: a }] }
      return null
    },
    header: (page: number) => (page === 1
      ? null
      : { columns: [{ text: brand, font: SEMI, fontSize: 8, color: MUTED }, { text: `${title} ${numberText}`, fontSize: 8, color: MUTED, alignment: 'right' }], margin: [44, 22, 44, 0] }),
    footer: (page: number, pages: number) => ({
      stack: [
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 507, y2: 0, lineWidth: 0.5, lineColor: LINE }] },
        {
          columns: [
            { text: legal, fontSize: 7, color: MUTED, width: '*' },
            { text: `Página ${page} de ${pages}`, fontSize: 7, color: MUTED, alignment: 'right', width: 70 },
          ],
          margin: [0, 6, 0, 0],
        },
        page === pages && doc.verifactu ? { text: `Huella ${doc.verifactu.hash}`, fontSize: 5.8, color: '#a3a9b5', margin: [0, 3, 0, 0] } : null,
      ].filter(Boolean),
      margin: [44, 16, 44, 0],
    }),
    watermark: doc.status === 'draft' ? { text: 'BORRADOR', color: '#9aa1ae', opacity: 0.08, bold: true, font: F } : undefined,
    content: [header, meta, parties, rectNote, description, lineTable, bottom, paymentNode].filter(Boolean),
  }
  return definition
}
