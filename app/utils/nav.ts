export interface NavItem {
  label: string
  to: string
  icon: string
  /** Palabras para encontrarlo en la paleta de comandos */
  keywords?: string
  soon?: boolean
}

/** Área de la app: una entrada en el menú; si agrupa varias pantallas, se reparten en pestañas */
export interface NavArea extends NavItem {
  key: string
  /** Pestañas del área (la primera es la pantalla por defecto) */
  tabs?: NavItem[]
}

/** Área y pestaña de una ruta: gana el prefijo más largo (/documentos/gestor es de Impuestos, no de Documentos) */
export function areaOf(path: string): { area: NavArea | null, tab: NavItem | null } {
  let best: { area: NavArea, tab: NavItem | null, len: number } | null = null
  const hit = (to: string) => (to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`))
  for (const area of NAV.flat()) {
    for (const item of [area, ...(area.tabs ?? [])]) {
      if (hit(item.to) && (!best || item.to.length >= best.len)) {
        best = { area, tab: area.tabs?.includes(item) ? item : null, len: item.to.length }
      }
    }
  }
  return best ? { area: best.area, tab: best.tab } : { area: null, tab: null }
}

/**
 * Pocas áreas y claras: lo de cada día arriba (cobrar, gastos, banco, impuestos) y el resto debajo.
 * Las rutas no cambian: solo cómo se agrupan para no saturar el menú.
 */
export const NAV: readonly NavArea[][] = Object.freeze([
  [
    { key: 'inicio', label: 'Inicio', to: '/', icon: 'ph:squares-four', keywords: 'panel dashboard resumen hoy tareas' },
    {
      key: 'ingresos',
      label: 'Ingresos',
      to: '/facturas',
      icon: 'ph:receipt',
      keywords: 'ventas facturas emitidas cobros',
      tabs: [
        { label: 'Facturas', to: '/facturas', icon: 'ph:receipt', keywords: 'emitidas ventas cobros' },
        { label: 'Presupuestos', to: '/presupuestos', icon: 'ph:file-text', keywords: 'ofertas cotizaciones' },
        { label: 'Recurrentes', to: '/recurrentes', icon: 'ph:arrows-clockwise', keywords: 'facturas recurrentes igualas cuotas mantenimiento periódicas automático mensual repetir' },
        { label: 'Productos', to: '/productos', icon: 'ph:package', keywords: 'catálogo tarifas precios servicios' },
      ],
    },
    {
      key: 'gastos',
      label: 'Gastos',
      to: '/gastos',
      icon: 'ph:wallet',
      keywords: 'facturas recibidas tickets compras',
      tabs: [
        { label: 'Gastos', to: '/gastos', icon: 'ph:wallet', keywords: 'facturas recibidas tickets compras' },
        { label: 'Gastos fijos', to: '/gastos/fijos', icon: 'ph:arrows-clockwise', keywords: 'recurrentes alquiler cuota autónomos suscripciones software mensual repetir' },
      ],
    },
    { key: 'banco', label: 'Banco', to: '/banco', icon: 'ph:piggy-bank', keywords: 'extracto movimientos conciliar conciliación norma 43 cuenta saldo cobros pagos' },
    {
      key: 'impuestos',
      label: 'Impuestos',
      to: '/impuestos',
      icon: 'ph:bank',
      keywords: 'modelos 303 130 111 115 iva irpf aeat hacienda trimestre',
      tabs: [
        { label: 'Impuestos', to: '/impuestos', icon: 'ph:bank', keywords: 'modelos 303 130 111 115 iva irpf aeat hacienda trimestre' },
        { label: 'Informes', to: '/informes', icon: 'ph:chart-line-up', keywords: 'estadísticas análisis trimestre año libro registro excel pdf cuenta de resultados' },
        { label: 'Gestoría', to: '/documentos/gestor', icon: 'ph:paper-plane-tilt', keywords: 'gestor asesor enviar trimestre zip' },
      ],
    },
  ],
  [
    {
      key: 'contactos',
      label: 'Contactos',
      to: '/clientes',
      icon: 'ph:users',
      keywords: 'clientes proveedores',
      tabs: [
        { label: 'Clientes', to: '/clientes', icon: 'ph:users', keywords: 'contactos' },
        { label: 'Proveedores', to: '/proveedores', icon: 'ph:storefront', keywords: 'contactos acreedores' },
      ],
    },
    {
      key: 'documentos',
      label: 'Documentos',
      to: '/documentos',
      icon: 'ph:folder-simple',
      keywords: 'documentos archivo importar subir',
      tabs: [
        { label: 'Importar', to: '/documentos', icon: 'ph:upload-simple', keywords: 'importar subir zip excel otro programa migrar' },
        { label: 'Archivo', to: '/documentos/archivo', icon: 'ph:folder-simple', keywords: 'archivo trimestre pedidos albaranes contratos documentos' },
      ],
    },
    { key: 'asistente', label: 'Asistente IA', to: '/asistente', icon: 'ph:sparkle', keywords: 'ia chat preguntar consejo asesor' },
  ],
])

export const SETTINGS_NAV: NavItem = { label: 'Ajustes', to: '/ajustes', icon: 'ph:gear-six', keywords: 'empresa configuración series certificado' }

/** Todas las pantallas a las que se puede ir (paleta de comandos) */
export const ALL_NAV: NavItem[] = (() => {
  const seen = new Set<string>()
  const out: NavItem[] = []
  for (const a of NAV.flat()) {
    for (const item of a.tabs ?? [a]) {
      if (seen.has(item.to)) continue
      seen.add(item.to)
      out.push(item)
    }
  }
  out.push(SETTINGS_NAV)
  return out
})()

/** Acciones de creación rápida (botón Nuevo, botón «+» del móvil y paleta) */
export const CREATE_ACTIONS = Object.freeze([
  { label: 'Nueva factura', icon: 'ph:receipt', to: '/facturas/nueva', hint: 'F', keywords: 'emitir facturar' },
  { label: 'Nuevo presupuesto', icon: 'ph:file-text', to: '/presupuestos/nuevo', hint: 'P', keywords: 'oferta' },
  { label: 'Añadir gasto', icon: 'ph:wallet', to: '/gastos?nuevo=1', hint: 'G', keywords: 'ticket compra factura recibida' },
  { label: 'Escanear factura o ticket', icon: 'ph:scan', to: '?escanear=1', hint: 'E', keywords: 'ocr ia foto leer documento' },
  { label: 'Nuevo cliente', icon: 'ph:user-plus', to: '/clientes?nuevo=1', hint: 'C', keywords: 'contacto' },
  { label: 'Nuevo proveedor', icon: 'ph:storefront', to: '/proveedores?nuevo=1', keywords: 'contacto' },
])
