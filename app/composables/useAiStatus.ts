// Una sola petición aunque se monten a la vez muchos campos con IA (la app no tiene SSR)
let loading: Promise<void> | null = null

/**
 * ¿Puede usar la IA quien está dentro (su clave de OpenAI o la que presta la empresa)? Se pregunta una
 * vez por sesión y empresa; Ajustes → IA llama a `refresh()` al guardar o quitar la clave.
 */
export function useAiStatus() {
  const state = useState<{ companyId: number | null, configured: boolean | null }>('ai-status', () => ({ companyId: null, configured: null }))
  const { me, readOnly } = useMe()

  async function refresh() {
    const companyId = me.value?.company?.id ?? null
    try {
      const r = await $fetch<{ configured: boolean }>('/api/ai/status')
      state.value = { companyId, configured: r.configured }
    }
    catch {
      state.value = { companyId, configured: false }
    }
  }

  if (import.meta.client) {
    watch(() => me.value?.company?.id, (id) => {
      if (id && state.value.companyId !== id && !loading) loading = refresh().finally(() => (loading = null))
    }, { immediate: true })
  }

  /** La IA se ofrece a quien puede escribir (el gestor solo consulta) y tiene clave */
  const available = computed(() => !!state.value.configured && !readOnly.value)
  return { available, refresh }
}
