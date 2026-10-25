/**
 * Al entrar en una ficha desde fuera de su lista, se guarda de dónde se viene (`?from=`) para que su
 * «Volver» regrese allí. Desde su propia lista, al crear/editar o recorriendo fichas de la misma sección
 * (anterior / siguiente) no hace falta: se conserva el origen que ya hubiera.
 */
export default defineNuxtPlugin(() => {
  const router = useRouter()
  router.beforeEach((to, from) => {
    if (!from.matched.length || typeof to.query.from === 'string') return
    const target = detailOf(to.path, to.query)
    if (!target) return
    // Es el «Volver» hacia el origen: no se apunta la ficha que se deja (si no, irían una a otra sin fin)
    const origin0 = typeof from.query.from === 'string' ? from.query.from : null
    if (origin0 && safeDecode(origin0) === safeDecode(to.fullPath)) return
    if (from.path === target.list && !detailOf(from.path, from.query)) return
    if (/\/(editar|nueva|nuevo|importar)$/.test(from.path)) return
    const origin = detailOf(from.path, from.query)?.list === target.list
      ? (typeof from.query.from === 'string' ? from.query.from : null)
      : from.fullPath
    if (!origin || origin === to.fullPath) return
    return { path: to.path, query: { ...to.query, from: origin }, hash: to.hash }
  })
})

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s)
  }
  catch {
    return s
  }
}
