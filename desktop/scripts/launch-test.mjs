#!/usr/bin/env node
/**
 * Arranca la app de escritorio YA EMPAQUETADA (dist/…), espera a que la ventana cargue NUMIQ, comprueba
 * la API desde la propia ventana y la cierra, verificando que MySQL se apaga en orden.
 *
 *   node scripts/launch-test.mjs <ruta al ejecutable>
 *     Windows: dist/win-unpacked/NUMIQ.exe
 *     macOS:   dist/mac-arm64/NUMIQ.app/Contents/MacOS/NUMIQ
 *     Linux:   dist/linux-unpacked/numiq   (con xvfb-run en un servidor sin pantalla)
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const exe = process.argv[2]
if (!exe || !existsSync(exe)) {
  console.error(`No existe el ejecutable: ${exe}`)
  process.exit(1)
}
const userData = process.platform === 'win32'
  ? join(process.env.APPDATA, 'NUMIQ')
  : process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'NUMIQ')
    : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'NUMIQ')
const appLog = join(userData, 'logs', 'app.log')
const mysqlLog = join(userData, 'logs', 'mysql.log')
const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [])
const fromLog = lines(appLog).length
const fromMysql = lines(mysqlLog).length

const data = mkdtempSync(join(tmpdir(), 'numiq-launch-'))
const PORT = 9555
const env = { ...process.env, NUMIQ_DATA_DIR: join(data, 'data') }
delete env.ELECTRON_RUN_AS_NODE
const args = [`--remote-debugging-port=${PORT}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])]
const t0 = Date.now()
const child = spawn(exe, args, { env, stdio: 'inherit' })
let exited = null
child.on('exit', (code) => {
  exited = code
})

const sleep = ms => new Promise(r => setTimeout(r, ms))
let failed = false
const fail = (m) => {
  failed = true
  console.log(`  ✘ ${m}`)
}

async function cdp(wsUrl, method, params = {}) {
  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', rej)
  })
  const out = await new Promise((res) => {
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data)
      if (m.id === 1) res(m)
    })
    ws.send(JSON.stringify({ id: 1, method, params }))
  })
  ws.close()
  return out
}

try {
  // 1. Ventana principal con NUMIQ cargado (no la de arranque)
  let page = null
  while (Date.now() - t0 < 240_000 && exited === null) {
    const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json()).catch(() => [])
    page = list.find(p => p.type === 'page' && /^http:\/\/localhost:\d+\//.test(p.url))
    if (page) break
    await sleep(500)
  }
  if (!page) throw new Error(`La ventana de NUMIQ no apareció${exited !== null ? ` (la app se cerró con código ${exited})` : ''}`)
  console.log(`  ✔ Ventana de NUMIQ en ${((Date.now() - t0) / 1000).toFixed(1)} s: ${page.url}`)

  // 2. Desde la ventana: la app en modo escritorio, la API y el puente con la app
  await sleep(1500)
  const r = await cdp(page.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression: `(async () => {
      const me = await fetch('/api/me')
      const st = await (await fetch('/api/desktop/status')).json()
      return { me: me.status, desktop: !!window.__NUXT__?.config?.public?.desktop, bridge: typeof window.numiqDesktop?.token, token: (await window.numiqDesktop?.token?.())?.length ?? 0, accounts: st.hasAccounts }
    })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  const v = r.result?.result?.value
  if (v?.me === 401 && v.desktop && v.bridge === 'function' && v.token === 64 && v.accounts === false) console.log('  ✔ Modo escritorio, API, puente con la app y primer arranque sin cuentas')
  else fail(`Comprobación desde la ventana: ${JSON.stringify(v ?? r)}`)

  // 3. Cierre como desde el menú: servidor parado y MySQL apagado en orden
  const ver = await fetch(`http://127.0.0.1:${PORT}/json/version`).then(res => res.json())
  // Sin esperar respuesta: la app se cierra antes de contestar
  const bws = new WebSocket(ver.webSocketDebuggerUrl)
  await new Promise(res => bws.addEventListener('open', res))
  bws.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
  const keepAlive = setInterval(() => {}, 1000)
  const until = Date.now() + 60_000
  while (exited === null && Date.now() < until) await sleep(300)
  if (exited === null) fail('La app no se cerró')
  await sleep(1500)
  clearInterval(keepAlive)
  const shut = lines(mysqlLog).slice(fromMysql).some(l => /Shutdown complete/.test(l))
  shut ? console.log('  ✔ Cierre ordenado de la base de datos') : fail('MySQL no registró un cierre ordenado')
}
catch (err) {
  fail(err.message)
}

const log = lines(appLog).slice(fromLog).filter(Boolean)
console.log(`\n• app.log:\n  ${log.join('\n  ')}`)
if (failed) {
  console.log(`\n• mysql.log:\n  ${lines(mysqlLog).slice(fromMysql).slice(-30).join('\n  ')}`)
  const server = join(userData, 'logs', 'server.log')
  console.log(`\n• server.log:\n  ${lines(server).slice(-30).join('\n  ')}`)
}
if (exited === null) child.kill()
rmSync(data, { recursive: true, force: true })
console.log(failed ? '\n✘ La app empaquetada falla' : '\n✔ La app empaquetada arranca, funciona y se cierra bien')
process.exit(failed ? 1 : 0)
