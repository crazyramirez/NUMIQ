import type { MenuItem } from '~/components/ui/Menu.vue'

/** Opción de un menú contextual: la de UiMenu más submenús y opciones apagadas */
export interface CtxItem extends MenuItem {
  children?: CtxItem[]
  disabled?: boolean
  /** Texto secundario bajo la etiqueta (p. ej. el importe que se copiará) */
  sub?: string
  /** Atajo de teclado que se muestra a la derecha: ['Ctrl', 'C'] */
  keys?: string[]
}

/** Lo que muestra un menú: opciones y, opcionalmente, una cabecera con lo que se está tocando */
export interface CtxSpec {
  items: CtxItem[]
  title?: string
  subtitle?: string
  icon?: string
  /** Nota al pie (p. ej. cómo abrir el menú del navegador) */
  footer?: string
}

/** Valor de `v-ctx`: opciones fijas o una función que las calcula al abrir (siempre al día) */
export type CtxSource = CtxItem[] | CtxSpec | ((e: MouseEvent) => CtxItem[] | CtxSpec | null | undefined) | null | undefined

export interface CtxState extends CtxSpec {
  x: number
  y: number
  /** Hoja inferior en pantallas táctiles (pulsación larga) en lugar del menú flotante */
  sheet: boolean
  /** Abierto con el teclado (tecla Menú o Mayús+F10): el foco va a la primera opción */
  keyboard: boolean
  /** Elemento sobre el que se abrió: queda resaltado mientras el menú está abierto */
  target: HTMLElement | null
  seq: number
}

// Un solo menú en toda la app; solo se abre en el cliente
const state = shallowRef<CtxState | null>(null)
let seq = 0

const toSpec = (v: CtxItem[] | CtxSpec): CtxSpec => (Array.isArray(v) ? { items: v } : v)

/** Quita separadores repetidos o en los extremos y títulos sin opciones debajo */
export function tidyItems(items: CtxItem[]): CtxItem[] {
  const out: CtxItem[] = []
  for (const it of items) {
    if (it.divider && (!out.length || out.at(-1)?.divider)) continue
    if (it.heading && out.at(-1)?.heading) out.pop()
    out.push(it.children ? { ...it, children: tidyItems(it.children) } : it)
  }
  while (out.length && (out.at(-1)?.divider || out.at(-1)?.heading)) out.pop()
  return out
}

/**
 * Menú contextual (clic derecho / pulsación larga). Normalmente se usa con la directiva `v-ctx`;
 * `openAt` sirve para abrirlo a mano (p. ej. desde un botón «⋯»).
 */
export function useContextMenu() {
  function openAt(e: MouseEvent | { clientX: number, clientY: number }, source: CtxItem[] | CtxSpec, opts: { sheet?: boolean, keyboard?: boolean, target?: HTMLElement | null } = {}) {
    const spec = toSpec(source)
    const items = tidyItems(spec.items)
    if (!items.length) return false
    state.value = {
      ...spec,
      items,
      x: e.clientX,
      y: e.clientY,
      sheet: !!opts.sheet,
      keyboard: !!opts.keyboard,
      target: opts.target ?? null,
      seq: ++seq,
    }
    return true
  }

  function close() {
    state.value = null
  }

  return { state, openAt, close }
}

/** Copia al portapapeles con aviso: «Número copiado» */
export async function copyText(text: string | null | undefined, what = 'Texto') {
  const toast = useToast()
  if (!text) return toast.info('No hay nada que copiar')
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copiado`, text.length > 60 ? `${text.slice(0, 60)}…` : text)
  }
  catch {
    toast.error('No se pudo copiar', 'El navegador no permite usar el portapapeles aquí.')
  }
}

/** Tecla modificadora del sistema para mostrar atajos */
export function modKey() {
  return import.meta.client && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
}

/** Importe como se pega en una hoja de cálculo española: 1234,50 */
export const plainAmount = (n: number) => n.toFixed(2).replace('.', ',')

/** Ratón de verdad (no táctil): las opciones que solo tienen sentido en escritorio, como abrir otra pestaña */
export const desktopCtx = () => import.meta.client && window.matchMedia('(hover: hover) and (pointer: fine)').matches
