/** Borrado definitivo de un producto o servicio, avisando de las facturas que lo usan. Devuelve si se borró */
export function useItemDelete() {
  const { confirm } = useConfirm()
  const toast = useToast()

  return async (item: { id: number, name: string }) => {
    try {
      const { documentsCount: n } = await $fetch<{ documentsCount: number }>(`/api/items/${item.id}`)
      const ok = await confirm({
        title: `¿Eliminar «${item.name}»?`,
        body: n
          ? `Aparece en ${n} ${n === 1 ? 'factura o presupuesto' : 'facturas y presupuestos'}. No cambian: conservan concepto, precio e IVA, pero dejarán de estar vinculados al catálogo.\n\nEsta acción no se puede deshacer.`
          : 'Se borrará del catálogo definitivamente. Esta acción no se puede deshacer.',
        confirmLabel: 'Eliminar definitivamente',
        danger: true,
      })
      if (!ok) return false
      const res = await $fetch<{ unlinkedDocuments: number }>(`/api/items/${item.id}`, { method: 'DELETE' })
      const u = res.unlinkedDocuments
      toast.success('Eliminado del catálogo', u ? `${item.name} · ${u} ${u === 1 ? 'documento desvinculado' : 'documentos desvinculados'}` : item.name)
      return true
    }
    catch (err) {
      toast.error('No se pudo eliminar', errorMessage(err))
      return false
    }
  }
}
