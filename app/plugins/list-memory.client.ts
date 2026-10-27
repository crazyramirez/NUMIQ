/**
 * Al entrar en un listado con un enlace sin filtros (el menú, las pestañas de la sección, el «Volver» de una
 * ficha tras recargar…), se abre con la búsqueda, los filtros y la página con que se dejó (`list-memory`).
 * Un enlace que ya trae alguno (avisos, Inicio, el buscador) manda; el del propio listado lo deja limpio.
 */
export default defineNuxtPlugin(() => {
  const { me } = useMe()
  useRouter().beforeEach((to, from) => {
    // La primera carga la pinta el servidor tal cual; en la misma página, el enlace es para limpiarla
    if (!from.matched.length || to.path === from.path) return
    const saved = savedListState(listScope(me.value), to.path)
    if (!saved || Object.keys(to.query).some(k => saved.keys.includes(k))) return
    return { path: to.path, query: { ...saved.values, ...to.query }, hash: to.hash }
  })
})
