/**
 * «Volver» coherente en toda la app: una ficha vuelve a donde estabas. Si llegaste desde su propia lista,
 * a la lista tal como la dejaste; si llegaste desde otra parte (calendario, Inicio, banco, otra ficha,
 * el buscador…), a esa pantalla, que viaja en `?from=`. El plugin `back-from` lo añade solo.
 */

/** Ficha de detalle y la lista a la que pertenece; null si la ruta no es una ficha */
export function detailOf(path: string, query: Record<string, unknown> = {}): { list: string } | null {
  const m = /^\/(facturas|presupuestos|clientes|proveedores)\/\d+$/.exec(path)
  if (m) return { list: `/${m[1]}` }
  if (/^\/documentos\/importacion\/\d+$/.test(path)) return { list: '/documentos' }
  // Fichas que se abren encima de su lista (?ver=ID)
  if (['/gastos', '/gastos/fijos', '/recurrentes'].includes(path) && query.ver) return { list: path }
  return null
}

/** Nombre corto de una pantalla para el botón «Volver» (← Calendario, ← Cliente…) */
export function backPlace(url: string): string {
  const path = url.split(/[?#]/)[0] ?? '/'
  const ver = /[?&]ver=/.test(url)
  if (path === '/') return 'Inicio'
  if (/^\/facturas\/\d+/.test(path)) return 'Factura'
  if (/^\/presupuestos\/\d+/.test(path)) return 'Presupuesto'
  if (/^\/clientes\/\d+/.test(path)) return 'Cliente'
  if (/^\/proveedores\/\d+/.test(path)) return 'Proveedor'
  if (/^\/documentos\/importacion\/\d+/.test(path)) return 'Importación'
  if (path === '/gastos') return ver ? 'Gasto' : 'Gastos'
  if (path === '/gastos/fijos') return ver ? 'Gasto fijo' : 'Gastos fijos'
  if (path === '/recurrentes') return ver ? 'Factura recurrente' : 'Recurrentes'
  if (path === '/impuestos/cerrar') return 'Cerrar el trimestre'
  const PLACES: Array<[string, string]> = [
    ['/calendario', 'Calendario'],
    ['/banco', 'Banco'],
    ['/facturas', 'Facturas'],
    ['/presupuestos', 'Presupuestos'],
    ['/clientes', 'Clientes'],
    ['/proveedores', 'Proveedores'],
    ['/documentos', 'Documentos'],
    ['/impuestos', 'Impuestos'],
    ['/informes', 'Informes'],
    ['/asistente', 'Asistente'],
    ['/ajustes', 'Ajustes'],
    ['/productos', 'Productos'],
  ]
  return PLACES.find(([p]) => path === p || path.startsWith(`${p}/`))?.[1] ?? 'Atrás'
}

/** Dirección para abrir `to` recordando la pantalla actual (con `extra` en su query para reabrir lo que había abierto) */
export function linkWithReturn(to: string, here: { path: string, query: Record<string, unknown> }, extra: Record<string, string> = {}) {
  const query = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...here.query, ...extra })) {
    if (typeof v === 'string' && v) query.set(k, v)
  }
  const from = `${here.path}${query.size ? `?${query}` : ''}`
  const [path, search = ''] = to.split('?')
  const target = new URLSearchParams(search)
  target.set('from', from)
  return `${path}?${target}`
}
