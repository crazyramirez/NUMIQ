/* NUMIQ · avisos (Web Push). Solo recibe y muestra avisos: no guarda nada en caché ni intercepta la red. */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  }
  catch {
    data = { title: 'NUMIQ', body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(self.registration.showNotification(data.title || 'NUMIQ', {
    body: data.body || '',
    icon: '/app-icons/icon-192.png',
    badge: '/app-icons/icon-192.png',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || '/' },
  }))
})

// Al tocar el aviso: a la pantalla que toca, en la ventana de NUMIQ que ya esté abierta si la hay
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        await client.focus()
        if ('navigate' in client) await client.navigate(url)
        return
      }
    }
    await self.clients.openWindow(url)
  })())
})
