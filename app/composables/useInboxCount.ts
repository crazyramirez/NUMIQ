import { createSharedComposable } from '@vueuse/core'

/**
 * Cuántas cosas esperan en la Bandeja (contador del menú). Se refresca al navegar, como mucho
 * cada 30 segundos, o al momento tras una acción en la propia bandeja.
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
      // Sin contador no pasa nada: la bandeja sigue ahí
    }
  }

  return { count, refresh }
})
