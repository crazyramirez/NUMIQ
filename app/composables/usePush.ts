/** Avisos en este dispositivo (Web Push): activar, desactivar y saber si están activos */
export function usePush() {
  const supported = ref(false)
  const enabled = ref(false)
  const permission = ref<NotificationPermission | 'unsupported'>('unsupported')
  /** iPhone/iPad fuera de la app instalada: Safari solo da avisos a la app de la pantalla de inicio */
  const needsInstall = ref(false)

  const toKey = (base64: string) => {
    const pad = '='.repeat((4 - (base64.length % 4)) % 4)
    const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
    return Uint8Array.from(raw, c => c.charCodeAt(0))
  }

  async function registration() {
    return (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register('/sw.js', { scope: '/' })
  }

  async function refresh() {
    if (!import.meta.client) return
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
    needsInstall.value = ios && !standalone
    supported.value = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    if (!supported.value) return
    permission.value = Notification.permission
    const reg = await navigator.serviceWorker.getRegistration('/')
    enabled.value = !!(reg && await reg.pushManager.getSubscription())
  }

  async function enable() {
    const result = await Notification.requestPermission()
    permission.value = result
    if (result !== 'granted') throw new Error(result === 'denied' ? 'Has bloqueado los avisos en este navegador: actívalos en sus ajustes del sitio' : 'No has dado permiso para los avisos')
    const reg = await registration()
    await navigator.serviceWorker.ready
    const { publicKey } = await $fetch<{ publicKey: string }>('/api/push/key')
    const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) })
    await $fetch('/api/push/subscribe', { method: 'POST', body: sub.toJSON() })
    enabled.value = true
  }

  async function disable() {
    const reg = await navigator.serviceWorker.getRegistration('/')
    const sub = reg && await reg.pushManager.getSubscription()
    if (sub) {
      await $fetch('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {})
      await sub.unsubscribe()
    }
    enabled.value = false
  }

  onMounted(refresh)
  return { supported, enabled, permission, needsInstall, enable, disable, refresh }
}
