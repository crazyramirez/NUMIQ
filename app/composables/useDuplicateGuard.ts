import type { ImportDuplicate } from '#shared/types/import'

/** El registro que ya existía, si el servidor rechazó guardar por duplicado (409 con data.duplicate) */
export function errorDuplicate(err: unknown): ImportDuplicate | null {
  return (err as { data?: { data?: { duplicate?: ImportDuplicate } } })?.data?.data?.duplicate ?? null
}

/** Dónde ver la factura o el gasto que ya estaba registrado */
export function duplicateUrl(d: ImportDuplicate | null | undefined) {
  if (!d?.id) return null
  return d.type === 'sales' ? `/facturas/${d.id}` : d.type === 'expense' ? `/gastos?ver=${d.id}` : null
}

/**
 * Guardar sin duplicar: si ya estaba registrado sin lugar a dudas (mismo número, mismo archivo…) se avisa
 * con un enlace; si solo es muy probable (fecha cercana, nombre parecido) se pregunta antes de guardarlo
 * igualmente. `save` recibe si el usuario confirmó que no es un duplicado; devuelve null si no se guardó.
 */
export function useDuplicateGuard() {
  const { confirm } = useConfirm()
  const toast = useToast()
  const router = useRouter()
  return async function guard<T>(save: (allowDuplicate: boolean) => Promise<T>): Promise<T | null> {
    try {
      return await save(false)
    }
    catch (err) {
      const dup = errorDuplicate(err)
      if (!dup) throw err
      if (dup.certain === false) {
        const ok = await confirm({ title: '¿Ya lo tienes registrado?', body: `${dup.label}. Si es otro distinto, guárdalo igualmente.`, confirmLabel: 'Guardar igualmente', cancelLabel: 'No guardar' })
        return ok ? await save(true) : null
      }
      const url = duplicateUrl(dup)
      toast.push({ tone: 'info', title: 'Ya estaba registrado', body: dup.label, action: url ? { label: 'Ver', run: () => router.push(url) } : undefined }, 9000)
      return null
    }
  }
}
