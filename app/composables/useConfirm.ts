export interface ConfirmOptions {
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface ConfirmState extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

/** Diálogo de confirmación como promesa: `if (await confirm({ ... }))` */
export function useConfirm() {
  const state = useState<ConfirmState | null>('confirm', () => null)

  function confirm(opts: ConfirmOptions) {
    return new Promise<boolean>((resolve) => {
      state.value = { ...opts, resolve }
    })
  }

  function settle(ok: boolean) {
    state.value?.resolve(ok)
    state.value = null
  }

  return { state, confirm, settle }
}
