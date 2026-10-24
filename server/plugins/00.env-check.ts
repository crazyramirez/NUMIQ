/** Avisa al arrancar si falta configuración imprescindible */
export default defineNitroPlugin(() => {
  if (import.meta.prerender) return
  const c = useRuntimeConfig()
  if (!c.session?.password || c.session.password.length < 32) {
    console.error('[config] Falta NUXT_SESSION_PASSWORD (32+ caracteres): sin ella no funciona ninguna sesión. Mira .env.example')
  }
})
