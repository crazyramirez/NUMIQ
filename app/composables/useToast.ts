export interface Toast {
  id: number
  tone: 'success' | 'error' | 'info'
  title: string
  body?: string
  action?: { label: string, run: () => void }
}

let seq = 0

export function useToast() {
  const toasts = useState<Toast[]>('toasts', () => [])

  function dismiss(id: number) {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }

  function push(t: Omit<Toast, 'id'>, ms = 4200) {
    const id = ++seq
    toasts.value = [...toasts.value.slice(-3), { ...t, id }]
    if (ms) setTimeout(() => dismiss(id), ms)
    return id
  }

  return {
    toasts,
    dismiss,
    success: (title: string, body?: string) => push({ tone: 'success', title, body }),
    error: (title: string, body?: string) => push({ tone: 'error', title, body }, 6500),
    info: (title: string, body?: string) => push({ tone: 'info', title, body }),
    push,
  }
}

/** Campo del formulario al que se refiere un error de validación del servidor (readInput) */
export function errorField(err: unknown): string | undefined {
  return (err as { data?: { data?: { field?: string } } })?.data?.data?.field || undefined
}

/** Mensaje legible de un error de $fetch */
export function errorMessage(err: unknown, fallback = 'Algo ha fallado. Inténtalo de nuevo.') {
  const e = err as { data?: { statusMessage?: string, message?: string }, statusMessage?: string, message?: string }
  return e?.data?.statusMessage || e?.statusMessage || e?.data?.message || fallback
}
