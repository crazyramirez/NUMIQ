import { createSharedComposable } from '@vueuse/core'

/**
 * Cuántas importaciones esperan confirmación (contador de Documentos en el menú). Se refresca
 * al navegar, como mucho cada 30 segundos.
 */
export const useInboxCount = createSharedComposable(() => {
  const count = useState('inboxCount', () => 0)
  let last = 0

  async function refresh(force = false) {
    if (!force && Date.now() - last < 30_000) return
    last = Date.now()
    try {
      count.value = (await $fetch<{ total: number }>('/api/inbox/count')).total
    }
    catch {
      // Sin contador no pasa nada: Documentos sigue ahí
    }
  }

  return { count, refresh }
})
