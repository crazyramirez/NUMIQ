import type { Db } from './db'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** Categorías de gasto habituales con su cuenta del PGC */
const EXPENSE_CATEGORIES: Array<{ name: string, accountCode: string, icon: string, color: string, deductiblePct?: number }> = [
  { name: 'Compras y mercaderías', accountCode: '600', icon: 'ph:package', color: '#6366f1' },
  { name: 'Alquiler', accountCode: '621', icon: 'ph:buildings', color: '#0ea5e9' },
  { name: 'Reparaciones y mantenimiento', accountCode: '622', icon: 'ph:wrench', color: '#64748b' },
  { name: 'Gestoría y profesionales', accountCode: '623', icon: 'ph:briefcase', color: '#8b5cf6' },
  { name: 'Transporte y envíos', accountCode: '624', icon: 'ph:truck', color: '#f97316' },
  { name: 'Seguros', accountCode: '625', icon: 'ph:shield-check', color: '#14b8a6' },
  { name: 'Comisiones bancarias', accountCode: '626', icon: 'ph:bank', color: '#78716c' },
  { name: 'Publicidad y marketing', accountCode: '627', icon: 'ph:megaphone', color: '#ec4899' },
  { name: 'Suministros', accountCode: '628', icon: 'ph:lightning', color: '#eab308' },
  { name: 'Software y suscripciones', accountCode: '629', icon: 'ph:app-window', color: '#3b82f6' },
  { name: 'Material de oficina', accountCode: '629', icon: 'ph:paperclip', color: '#a3a3a3' },
  { name: 'Viajes y dietas', accountCode: '629', icon: 'ph:airplane-tilt', color: '#06b6d4' },
  { name: 'Vehículo y combustible', accountCode: '629', icon: 'ph:car', color: '#ef4444', deductiblePct: 50 },
  { name: 'Formación', accountCode: '629', icon: 'ph:graduation-cap', color: '#22c55e' },
  { name: 'Cuota de autónomos', accountCode: '642', icon: 'ph:identification-card', color: '#10b981' },
  { name: 'Sueldos y salarios', accountCode: '640', icon: 'ph:users-three', color: '#0891b2' },
  { name: 'Tributos', accountCode: '631', icon: 'ph:scales', color: '#9333ea' },
  { name: 'Equipos e inversiones', accountCode: '217', icon: 'ph:desktop', color: '#475569' },
  { name: 'Otros gastos', accountCode: '629', icon: 'ph:dots-three-circle', color: '#94a3b8' },
]

const INCOME_CATEGORIES = [
  { name: 'Prestación de servicios', accountCode: '705', icon: 'ph:handshake', color: '#4f46e5' },
  { name: 'Venta de productos', accountCode: '700', icon: 'ph:shopping-bag', color: '#0ea5e9' },
  { name: 'Otros ingresos', accountCode: '759', icon: 'ph:coins', color: '#10b981' },
]

/** Lo que necesita una empresa nueva para empezar a facturar */
export async function seedCompanyDefaults(tx: Tx, companyId: number) {
  await tx.insert(tables.series).values([
    { companyId, kind: 'invoice', name: 'Facturas', prefix: 'F', isDefault: true },
    { companyId, kind: 'rectifying', name: 'Rectificativas', prefix: 'R', isDefault: true },
    { companyId, kind: 'quote', name: 'Presupuestos', prefix: 'P', isDefault: true },
    { companyId, kind: 'proforma', name: 'Proformas', prefix: 'PF', isDefault: true },
  ])
  await tx.insert(tables.categories).values([
    ...EXPENSE_CATEGORIES.map(c => ({ ...c, companyId, kind: 'expense' as const, deductiblePct: c.deductiblePct ?? 100 })),
    ...INCOME_CATEGORIES.map(c => ({ ...c, companyId, kind: 'income' as const })),
  ])
}
