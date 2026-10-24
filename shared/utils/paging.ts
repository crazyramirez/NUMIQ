/** Elementos por página en todos los listados de la app (los paginados en el servidor y, por defecto, en el cliente) */
export const PAGE_SIZE = 50

/** Tamaños de página que se pueden elegir al pie de los listados paginados en el cliente */
export const PAGE_SIZES = [25, 50, 100, 200] as const

/** Cuántas páginas ocupan `total` elementos: siempre al menos una */
export function pageCount(total: number, size = PAGE_SIZE) {
  return Math.max(1, Math.ceil(total / size))
}
