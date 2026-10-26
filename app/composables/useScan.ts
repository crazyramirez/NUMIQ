/** Escaneo rápido global (botón de la barra superior, paleta de comandos y ?escanear=1 en cualquier página) */
export function useScan() {
  const state = useState<{ open: boolean, direction: 'auto' | 'issued' | 'received' }>('scan', () => ({ open: false, direction: 'auto' }))
  const { readOnly } = useMe()
  return {
    state,
    open: (direction: 'auto' | 'issued' | 'received' = 'auto') => {
      // Escanear crea gastos y facturas: el gestor está en modo consulta
      if (readOnly.value) return
      state.value = { open: true, direction }
    },
    close: () => {
      state.value = { ...state.value, open: false }
    },
  }
}
