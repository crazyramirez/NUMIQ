/**
 * NUMIQ de escritorio (Electron): la misma app web, con su servidor (Nitro) y su base de datos
 * (MySQL 8.4) dentro del propio ordenador. Nada sale del equipo salvo lo que el usuario pide:
 * correos que envía, la IA con su clave de OpenAI y mapas o calendarios externos.
 *
 *   1. Ventana de arranque mientras se abre la base de datos (la primera vez se crea).
 *   2. Servidor de NUMIQ en un proceso aparte (utilityProcess) en http://localhost:<puerto>.
 *   3. Ventana principal con la app; los enlaces de fuera se abren en el navegador.
 *   4. Al salir: servidor parado y base de datos cerrada en orden.
 */
import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, Notification, screen, session, shell, utilityProcess } from 'electron'
import { freePort, portOpen, startDatabase } from './database.mjs'
import { serverEnv } from './server-env.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEV = !app.isPackaged
const VERSION = app.getVersion()
const RELEASES = 'https://github.com/crazyramirez/NUMIQ/releases'

app.setName('NUMIQ')
if (process.platform === 'win32') app.setAppUserModelId('es.numiq.desktop')

// Una sola copia abierta: la base de datos no admite dos servidores sobre la misma carpeta
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// ─── Rutas ───────────────────────────────────────────────────────────────────────────────────
const USER = app.getPath('userData')
const DATA = process.env.NUMIQ_DATA_DIR || join(USER, 'data')
const LOGS = join(USER, 'logs')
const CONFIG = join(USER, 'numiq-desktop.json')
const RES = DEV ? join(HERE, '..') : process.resourcesPath
const SERVER_DIR = process.env.NUMIQ_SERVER_DIR || (DEV ? join(RES, '.server') : join(RES, 'server'))
const MYSQL_DIR = DEV ? join(RES, 'vendor', 'mysql', `${process.platform}-${process.arch}`) : join(RES, 'mysql')
const ICON = join(HERE, '..', 'build', 'icon.png')

for (const d of [DATA, LOGS]) mkdirSync(d, { recursive: true })
/** Carpeta que se abre desde el menú: la de NUMIQ entera (datos y numiq-desktop.json), salvo datos en otro sitio */
const dataFolder = () => (DATA.startsWith(USER) ? USER : DATA)

/** Registro con fecha; rota a los 5 MB (se guarda el anterior como .old) */
function logTo(name) {
  const file = join(LOGS, name)
  try {
    if (existsSync(file) && statSync(file).size > 5 * 1024 * 1024) renameSync(file, `${file}.old`)
  }
  catch { /* sin rotar */ }
  return (text) => {
    try {
      appendFileSync(file, String(text).split(/\r?\n/).filter(Boolean).map(l => `${new Date().toISOString()} ${l}\n`).join(''))
    }
    catch { /* disco lleno o sin permisos: la app sigue */ }
  }
}
const log = logTo('app.log')
process.on('uncaughtException', err => log(`[error] ${err.stack || err.message}`))
process.on('unhandledRejection', err => log(`[error] ${err?.stack || err}`))
const serverLog = logTo('server.log')

// ─── Configuración propia: secretos y puertos ────────────────────────────────────────────────
// Se crea una vez con secretos aleatorios. Sin ella no se descifran las sesiones, las claves de
// OpenAI ni la contraseña del correo, y la base de datos no deja entrar: va en la copia de seguridad.
function loadConfig() {
  let c = {}
  try {
    if (existsSync(CONFIG)) c = JSON.parse(readFileSync(CONFIG, 'utf8'))
  }
  catch (err) {
    log(`[config] ilegible: ${err.message}`)
    throw new Error(`El archivo de configuración ${CONFIG} está dañado. Restáuralo desde una copia o bórralo para empezar de cero (perderías el acceso a los datos cifrados).`)
  }
  const secret = () => randomBytes(32).toString('hex')
  const fresh = { sessionPassword: secret(), certSecret: secret(), dbPassword: randomBytes(24).toString('base64url') }
  const merged = { ...fresh, ...c }
  if (JSON.stringify(merged) !== JSON.stringify(c)) saveConfig(merged)
  return merged
}
function saveConfig(c) {
  writeFileSync(`${CONFIG}.tmp`, JSON.stringify(c, null, 2), { mode: 0o600 })
  renameSync(`${CONFIG}.tmp`, CONFIG)
}

let config
let db = null
let server = null
let origin = ''
let mainWindow = null
let splash = null
let quitting = false
/** Secreto de esta sesión de la app: solo lo conoce la ventana (acciones locales sin correo) */
const windowToken = randomBytes(32).toString('hex')

// ─── Ventanas ────────────────────────────────────────────────────────────────────────────────
function createSplash() {
  splash = new BrowserWindow({
    width: 420,
    height: 300,
    frame: false,
    resizable: false,
    show: false,
    center: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0c10' : '#f5f6f8',
    icon: ICON,
    webPreferences: { sandbox: true, contextIsolation: true },
  })
  splash.loadFile(join(HERE, 'splash.html'))
  splash.once('ready-to-show', () => splash?.show())
  splash.on('closed', () => (splash = null))
}

function splashStatus(text) {
  log(`[arranque] ${text}`)
  splash?.webContents.executeJavaScript(`setStatus(${JSON.stringify(text)})`).catch(() => {})
}

function windowBounds() {
  const b = config?.window
  const fallback = { width: 1360, height: 880 }
  if (!b?.width) return fallback
  // Que siga cabiendo en alguna pantalla (monitor desconectado)
  const visible = screen.getAllDisplays().some(d => b.x >= d.workArea.x - 50 && b.y >= d.workArea.y - 50 && b.x < d.workArea.x + d.workArea.width - 100 && b.y < d.workArea.y + d.workArea.height - 100)
  return visible ? b : { width: b.width, height: b.height }
}

const sameOrigin = (url) => {
  try {
    return new URL(url).origin === origin
  }
  catch {
    return false
  }
}

function openOutside(url) {
  if (/^(https?|mailto|tel|webcal):/i.test(url)) shell.openExternal(url).catch(() => {})
}

/** Enlaces y ventanas nuevas: lo de NUMIQ dentro de la app, lo de fuera en el navegador */
function guard(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (!sameOrigin(url)) {
      openOutside(url)
      return { action: 'deny' }
    }
    // Descargas (PDF, ZIP, Excel): directamente al disco, sin ventana en blanco
    if (/[?&]download=1\b/.test(url)) {
      contents.downloadURL(url)
      return { action: 'deny' }
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 1100,
        height: 820,
        autoHideMenuBar: true,
        icon: ICON,
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0c10' : '#f5f6f8',
        webPreferences: { sandbox: true, contextIsolation: true },
      },
    }
  })
  contents.on('will-navigate', (e, url) => {
    if (!sameOrigin(url) && !url.startsWith('file:')) {
      e.preventDefault()
      openOutside(url)
    }
  })
  contents.on('did-create-window', win => guard(win.webContents))
}

function createMainWindow() {
  const bounds = windowBounds()
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 380,
    minHeight: 520,
    show: false,
    title: 'NUMIQ',
    icon: ICON,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0c10' : '#f5f6f8',
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: join(HERE, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      spellcheck: true,
      additionalArguments: [`--numiq-version=${VERSION}`],
    },
  })
  if (config.window?.maximized) mainWindow.maximize()
  guard(mainWindow.webContents)
  mainWindow.webContents.session.setSpellCheckerLanguages(['es-ES'])

  const remember = () => {
    if (!mainWindow || mainWindow.isMinimized()) return
    config.window = { ...(mainWindow.isMaximized() ? config.window : mainWindow.getBounds()), maximized: mainWindow.isMaximized() }
    saveConfig(config)
  }
  mainWindow.on('close', remember)
  mainWindow.on('closed', () => (mainWindow = null))
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    splash?.close()
  })
  // La app no carga (servidor caído): se reintenta en vez de dejar la ventana en blanco
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    if (code === -3 || !sameOrigin(url)) return
    log(`[ventana] fallo al cargar ${url}: ${desc} (${code})`)
    setTimeout(() => mainWindow?.loadURL(url), 1500)
  })
  mainWindow.webContents.on('render-process-gone', (_e, d) => {
    log(`[ventana] proceso de la ventana terminado: ${d.reason}`)
    if (d.reason !== 'clean-exit') mainWindow?.reload()
  })
  mainWindow.loadURL(`${origin}/`)
}

function showMain(path) {
  if (!mainWindow) {
    if (!origin) return
    createMainWindow()
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  if (path) mainWindow.webContents.send('desktop:navigate', path)
}

// ─── Servidor de NUMIQ ───────────────────────────────────────────────────────────────────────
function startServer(port) {
  const entry = join(SERVER_DIR, 'server', 'index.mjs')
  if (!existsSync(entry)) throw new Error(`No se encuentra el servidor de NUMIQ (${entry}). ¿Falta «npm run app» en desktop/?`)
  const env = serverEnv({ port, dbUrl: db.url, dataDir: DATA, serverDir: SERVER_DIR, config, windowToken })

  const child = utilityProcess.fork(entry, [], { cwd: DATA, env, stdio: 'pipe', serviceName: 'NUMIQ (servidor)' })
  child.stdout?.on('data', d => serverLog(d.toString()))
  child.stderr?.on('data', d => serverLog(d.toString()))
  child.on('message', (m) => {
    if (m?.type === 'notify') notify(m)
  })
  child.on('exit', (code) => {
    serverLog(`[servidor] terminado con código ${code}`)
    if (server === child) server = null
    // Durante el arranque el error lo cuenta la ventana de arranque (waitForServer)
    if (!quitting && mainWindow) crashed(`El servidor de NUMIQ se ha detenido (código ${code}).`)
  })
  return child
}

/** Espera a que la API responda tras aplicar las migraciones (401 = lista, sin sesión) */
async function waitForServer(port, child) {
  const until = Date.now() + 180_000
  let last = ''
  while (Date.now() < until) {
    if (!server || server !== child) throw new Error('El servidor de NUMIQ se cerró al arrancar. Mira el registro server.log')
    try {
      const res = await net.fetch(`http://127.0.0.1:${port}/api/me`, { bypassCustomProtocolHandlers: true })
      if (res.status < 500) return
      last = `${res.status} ${await res.text().catch(() => '')}`.slice(0, 400)
      if (res.status === 503) throw new Error(last)
    }
    catch (err) {
      if (String(err.message).startsWith('503')) throw new Error(`La base de datos no está lista: ${last}`)
    }
    await new Promise(r => setTimeout(r, 300))
  }
  throw new Error(`El servidor de NUMIQ no respondió a tiempo. ${last}`)
}

function notify(m) {
  if (!Notification.isSupported()) return
  const n = new Notification({ title: String(m.title || 'NUMIQ'), body: m.body ? String(m.body) : '', icon: ICON, silent: false })
  n.on('click', () => showMain(typeof m.url === 'string' && m.url.startsWith('/') ? m.url : null))
  n.show()
}

async function crashed(message) {
  log(`[error] ${message}`)
  if (quitting) return
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: 'NUMIQ',
    message,
    detail: `Los registros están en ${LOGS}`,
    buttons: ['Reiniciar NUMIQ', 'Ver registros', 'Salir'],
    defaultId: 0,
    cancelId: 2,
  })
  if (response === 1) await shell.openPath(LOGS)
  if (response === 0) {
    app.relaunch()
  }
  await shutdown()
  app.exit(0)
}

// ─── Arranque ────────────────────────────────────────────────────────────────────────────────
async function boot() {
  config = loadConfig()
  log(`[arranque] NUMIQ ${VERSION} · ${process.platform}-${process.arch} · datos en ${DATA}`)
  const firstRun = !existsSync(join(DATA, 'mysql'))

  const dbOptions = port => ({
    basedir: MYSQL_DIR,
    datadir: join(DATA, 'mysql'),
    port,
    password: config.dbPassword,
    logFile: join(LOGS, 'mysql.log'),
    onStatus: splashStatus,
  })
  let dbPort = config.dbPort || await freePort(47306)
  try {
    db = await startDatabase(dbOptions(dbPort))
  }
  catch (err) {
    if (err.code !== 'PORT_IN_USE') throw err
    dbPort = await freePort(0)
    db = await startDatabase(dbOptions(dbPort))
  }
  if (config.dbPort !== dbPort) saveConfig({ ...config, dbPort })
  config.dbPort = dbPort

  splashStatus(firstRun ? 'Preparando NUMIQ por primera vez (tarda unos segundos más)…' : 'Preparando NUMIQ…')
  // Mismo puerto siempre que se pueda: el navegador guarda las preferencias por dirección
  let appPort = config.appPort || 47300
  if (await portOpen(appPort)) appPort = await freePort(0)
  if (config.appPort !== appPort) saveConfig({ ...config, appPort })
  config.appPort = appPort
  origin = `http://localhost:${appPort}`

  server = startServer(appPort)
  await waitForServer(appPort, server)
  splashStatus('Listo')
  createMainWindow()
  setTimeout(checkForUpdates, 15_000)
}

async function shutdown() {
  quitting = true
  const s = server
  server = null
  if (s) {
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 5000)
      s.once('exit', () => {
        clearTimeout(t)
        resolve()
      })
      s.kill()
    })
  }
  if (db) {
    const d = db
    db = null
    await d.stop().catch(err => log(`[cierre] base de datos: ${err.message}`))
  }
}

// ─── Novedades: aviso si hay una versión nueva publicada (no se envía ningún dato) ────────────
export function isNewer(a, b) {
  const pa = a.split('.').map(n => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map(n => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}

async function checkForUpdates(manual = false) {
  try {
    const res = await net.fetch('https://api.github.com/repos/crazyramirez/NUMIQ/releases/latest', { headers: { 'accept': 'application/vnd.github+json', 'user-agent': 'NUMIQ-Desktop' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const latest = String((await res.json()).tag_name ?? '').replace(/^\D+/, '')
    if (latest && isNewer(latest, VERSION)) {
      const n = new Notification({ title: `NUMIQ ${latest} disponible`, body: 'Pulsa para descargar la nueva versión. Tus datos se conservan al actualizar.', icon: ICON })
      n.on('click', () => shell.openExternal(RELEASES))
      n.show()
    }
    else if (manual) {
      dialog.showMessageBox({ type: 'info', title: 'NUMIQ', message: 'Tienes la última versión', detail: `NUMIQ ${VERSION}` })
    }
  }
  catch (err) {
    log(`[novedades] ${err.message}`)
    if (manual) dialog.showMessageBox({ type: 'warning', title: 'NUMIQ', message: 'No se pudo comprobar si hay una versión nueva', detail: 'Revisa tu conexión a internet.' })
  }
}

// ─── Menú ────────────────────────────────────────────────────────────────────────────────────
function buildMenu() {
  const go = path => () => showMain(path)
  const mac = process.platform === 'darwin'
  const template = [
    ...(mac
      ? [{
          label: 'NUMIQ',
          submenu: [
            { role: 'about', label: 'Acerca de NUMIQ' },
            { type: 'separator' },
            { label: 'Ajustes…', accelerator: 'Cmd+,', click: go('/ajustes') },
            { type: 'separator' },
            { role: 'hide', label: 'Ocultar NUMIQ' },
            { role: 'hideOthers', label: 'Ocultar otros' },
            { role: 'unhide', label: 'Mostrar todo' },
            { type: 'separator' },
            { role: 'quit', label: 'Salir de NUMIQ' },
          ],
        }]
      : []),
    {
      label: 'Archivo',
      submenu: [
        { label: 'Nueva factura', accelerator: 'CmdOrCtrl+N', click: go('/facturas/nueva') },
        { label: 'Nuevo presupuesto', click: go('/presupuestos/nuevo') },
        { type: 'separator' },
        { label: 'Copia de seguridad…', click: go('/ajustes?s=copia') },
        { label: 'Abrir la carpeta de datos', click: () => shell.openPath(dataFolder()) },
        { label: 'Ver registros', click: () => shell.openPath(LOGS) },
        ...(mac ? [] : [{ type: 'separator' }, { label: 'Ajustes', accelerator: 'Ctrl+,', click: go('/ajustes') }, { type: 'separator' }, { role: 'quit', label: 'Salir' }]),
      ],
    },
    {
      label: 'Edición',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'pasteAndMatchStyle', label: 'Pegar sin formato' },
        { role: 'selectAll', label: 'Seleccionar todo' },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { label: 'Inicio', accelerator: 'CmdOrCtrl+1', click: go('/') },
        { label: 'Calendario', accelerator: 'CmdOrCtrl+2', click: go('/calendario') },
        { type: 'separator' },
        { role: 'reload', label: 'Recargar' },
        { role: 'resetZoom', label: 'Tamaño real' },
        { role: 'zoomIn', label: 'Ampliar' },
        { role: 'zoomOut', label: 'Reducir' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
        { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
      ],
    },
    {
      label: 'Ventana',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        { role: 'zoom', label: 'Zoom' },
        ...(mac ? [{ type: 'separator' }, { role: 'front', label: 'Traer todo al frente' }] : [{ role: 'close', label: 'Cerrar' }]),
      ],
    },
    {
      role: 'help',
      label: 'Ayuda',
      submenu: [
        { label: 'Novedades de NUMIQ', click: go('/ajustes?s=novedades') },
        { label: 'Buscar actualizaciones…', click: () => checkForUpdates(true) },
        { label: 'Descargas de NUMIQ', click: () => shell.openExternal(RELEASES) },
        ...(mac ? [] : [{ type: 'separator' }, { label: `NUMIQ ${VERSION}`, enabled: false }]),
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ─── Puente con la ventana ───────────────────────────────────────────────────────────────────
function fromApp(e) {
  return sameOrigin(e.senderFrame?.url ?? '')
}
ipcMain.handle('desktop:token', e => (fromApp(e) ? windowToken : ''))
ipcMain.handle('desktop:open-data', async e => (fromApp(e) ? shell.openPath(dataFolder()) : ''))
ipcMain.handle('desktop:open-logs', async e => (fromApp(e) ? shell.openPath(LOGS) : ''))

// ─── Ciclo de vida ───────────────────────────────────────────────────────────────────────────
app.on('second-instance', () => showMain())

app.whenReady().then(async () => {
  app.setAboutPanelOptions({ applicationName: 'NUMIQ', applicationVersion: VERSION, copyright: 'Facturación, gastos e impuestos para autónomos y pymes', website: RELEASES })
  buildMenu()
  // Permisos del navegador: notificaciones, portapapeles y cámara (escanear tickets); nada más
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    cb(sameOrigin(details.requestingUrl ?? wc.getURL()) && ['notifications', 'clipboard-read', 'clipboard-sanitized-write', 'media', 'fullscreen', 'geolocation'].includes(permission))
  })
  createSplash()
  try {
    await boot()
  }
  catch (err) {
    log(`[error] ${err.stack || err.message}`)
    await shutdown()
    quitting = false
    const text = `${err.message}\n\nRegistros: ${LOGS}`
    if (splash) {
      await splash.webContents.executeJavaScript(`fail(${JSON.stringify(text)})`).catch(() => {})
      const { response } = await dialog.showMessageBox(splash, { type: 'error', title: 'NUMIQ', message: 'No se pudo abrir NUMIQ', detail: text, buttons: ['Salir', 'Ver registros'], defaultId: 0 })
      if (response === 1) await shell.openPath(LOGS)
    }
    app.exit(1)
  }
})

app.on('activate', () => {
  if (origin && !mainWindow) createMainWindow()
})

app.on('window-all-closed', () => {
  // macOS: la app sigue en el Dock hasta Cmd+Q, como el resto de apps del sistema
  if (process.platform !== 'darwin' || !origin) app.quit()
})

let closing = false
app.on('before-quit', (e) => {
  if (closing) return
  e.preventDefault()
  closing = true
  shutdown().finally(() => app.exit(0))
})

// Ctrl+C en la terminal (desarrollo): cierre ordenado igual que desde el menú
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.quit())
