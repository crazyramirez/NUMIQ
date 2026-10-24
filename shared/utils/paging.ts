/** Elementos por página en todos los listados de la app (los paginados en el servidor y en el cliente) */
export const PAGE_SIZE = 25

/** Cuántas páginas ocupan `total` elementos: siempre al menos una */
export function pageCount(total: number, size = PAGE_SIZE) {
  return Math.max(1, Math.ceil(total / size))
}
