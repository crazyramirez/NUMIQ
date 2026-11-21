/**
 * Icono de la app de escritorio (build/icon.png, 1024×1024) a partir de public/icon.svg, con el
 * margen que piden macOS y Windows (el símbolo ocupa ~80 %). Se ejecuta con Electron:
 *
 *   npx electron scripts/make-icon.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'

const DESKTOP = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(DESKTOP, '..', 'public', 'icon.svg'), 'utf8')
const SIZE = 1024
const INNER = 824

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } })
  const shadow = 'filter: drop-shadow(0 18px 28px rgba(30, 20, 120, .28));'
  const html = `<!doctype html><html><body style="margin:0;width:${SIZE}px;height:${SIZE}px;display:grid;place-items:center;background:transparent">
    <div style="width:${INNER}px;height:${INNER}px;${shadow}">${svg.replace('<svg ', `<svg width="${INNER}" height="${INNER}" `)}</div></body></html>`
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise(r => setTimeout(r, 400))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE })
  writeFileSync(join(DESKTOP, 'build', 'icon.png'), img.resize({ width: SIZE, height: SIZE }).toPNG())
  console.log('✔ build/icon.png')
  app.quit()
})
