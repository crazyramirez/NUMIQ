export interface NavItem {
  label: string
  to: string
  icon: string
  /** Palabras para encontrarlo en la paleta de comandos */
  keywords?: string
  soon?: boolean
}

export interface NavSection {
  title?: string
  items: NavItem[]
}

export const NAV: NavSection[] = [
  {
    items: [
      { label: 'Inicio', to: '/', icon: 'ph:squares-four', keywords: 'panel dashboard resumen' },
      { label: 'Asistente IA', to: '/asistente', icon: 'ph:sparkle', keywords: 'ia chat preguntar consejo asesor' },
    ],
  },
  {
    title: 'Ventas',
    items: [
      { label: 'Facturas', to: '/facturas', icon: 'ph:receipt', keywords: 'emitidas ventas cobros' },
      { label: 'Presupuestos', to: '/presupuestos', icon: 'ph:file-text', keywords: 'ofertas cotizaciones' },
      { label: 'Clientes', to: '/clientes', icon: 'ph:users', keywords: 'contactos' },
      { label: 'Productos y servicios', to: '/productos', icon: 'ph:package', keywords: 'catálogo tarifas precios' },
    ],
  },
  {
    title: 'Compras',
    items: [
      { label: 'Gastos', to: '/gastos', icon: 'ph:wallet', keywords: 'facturas recibidas tickets compras' },
      { label: 'Proveedores', to: '/proveedores', icon: 'ph:storefront', keywords: 'contactos acreedores' },
    ],
  },
  {
    title: 'Finanzas',
    items: [
      { label: 'Banco', to: '/banco', icon: 'ph:piggy-bank', keywords: 'extracto movimientos conciliar conciliación norma 43 cuenta saldo cobros pagos' },
      { label: 'Impuestos', to: '/impuestos', icon: 'ph:bank', keywords: 'modelos 303 130 111 115 iva irpf aeat hacienda trimestre' },
      { label: 'Documentos', to: '/documentos', icon: 'ph:scan', keywords: 'escanear ocr ia subir importar archivo trimestre gestor pedidos albaranes' },
      { label: 'Informes', to: '/informes', icon: 'ph:chart-line-up', keywords: 'estadísticas análisis trimestre año libro registro excel pdf' },
      { label: 'Recurrentes', to: '/recurrentes', icon: 'ph:arrows-clockwise', keywords: 'suscripciones cuotas periódicos automático mensual' },
    ],
  },
]

export const SETTINGS_NAV: NavItem = { label: 'Ajustes', to: '/ajustes', icon: 'ph:gear-six', keywords: 'empresa configuración series certificado' }

export const ALL_NAV = [...NAV.flatMap(s => s.items), SETTINGS_NAV]

/** Acciones de creación rápida (botón Nuevo y paleta) */
export const CREATE_ACTIONS = [
  { label: 'Nueva factura', icon: 'ph:receipt', to: '/facturas/nueva', hint: 'F', keywords: 'emitir facturar' },
  { label: 'Nuevo presupuesto', icon: 'ph:file-text', to: '/presupuestos/nuevo', hint: 'P', keywords: 'oferta' },
  { label: 'Añadir gasto', icon: 'ph:wallet', to: '/gastos?nuevo=1', hint: 'G', keywords: 'ticket compra factura recibida' },
  { label: 'Escanear factura o ticket', icon: 'ph:scan', to: '?escanear=1', hint: 'E', keywords: 'ocr ia foto leer documento' },
  { label: 'Nuevo cliente', icon: 'ph:user-plus', to: '/clientes?nuevo=1', hint: 'C', keywords: 'contacto' },
  { label: 'Nuevo proveedor', icon: 'ph:storefront', to: '/proveedores?nuevo=1', keywords: 'contacto' },
]
