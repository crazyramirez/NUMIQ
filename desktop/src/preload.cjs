/**
 * Puente entre la ventana de NUMIQ y la app de escritorio (window.numiqDesktop).
 * Lo justo: el secreto para las acciones locales, abrir carpetas y navegar al pulsar un aviso.
 * Tipos en app/composables/useDesktop.ts.
 */
const { contextBridge, ipcRenderer } = require('electron')

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? ''

contextBridge.exposeInMainWorld('numiqDesktop', {
  token: () => ipcRenderer.invoke('desktop:token'),
  openDataFolder: () => ipcRenderer.invoke('desktop:open-data'),
  openLogs: () => ipcRenderer.invoke('desktop:open-logs'),
  onNavigate: (cb) => {
    const listener = (_e, url) => cb(url)
    ipcRenderer.on('desktop:navigate', listener)
    return () => ipcRenderer.removeListener('desktop:navigate', listener)
  },
  version: arg('numiq-version'),
  platform: process.platform,
})
