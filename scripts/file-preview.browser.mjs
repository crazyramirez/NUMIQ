/** Comprueba los componentes reales sin iniciar sesión ni escribir en la base de datos. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { parse, compileScript } from '@vue/compiler-sfc'
import { zipSync, strToU8 } from 'fflate'
import * as XLSX from 'xlsx'

const require = createRequire(process.env.NUMIQ_BROWSER_MODULES ? path.join(process.env.NUMIQ_BROWSER_MODULES, 'package.json') : import.meta.url)
const { chromium } = require('playwright')
const root = process.cwd()
const compiled = await build({
  stdin: { contents: `
    import { createApp, ref } from 'vue';
    import FilePreview from './app/components/docs/FilePreview.vue';
    import OfficePreview from './app/components/docs/OfficePreview.vue';
    import UiSelect from './app/components/ui/Select.vue';
    window.$fetch = async (url, options) => { const r = await fetch(url, options); if(!r.ok) throw Error('Archivo'); return r.blob() };
    const app = createApp({ components: { FilePreview }, setup() { const file=ref(null), fileId=ref(null), name=ref(''); return { file, fileId, name, change(e){file.value=e.target.files[0];fileId.value=null}, stored(){file.value=null;fileId.value=1;name.value='guardado.xls'} } }, template: '<input type="file" @change="change"><button id="stored" @click="stored">Guardado</button><div style="width:850px;height:650px"><FilePreview :file="file" :file-id="fileId" :name="name" /></div>' });
    app.component('LazyDocsOfficePreview', OfficePreview); app.component('UiSelect', UiSelect);
    app.component('UiButton', { props:['disabled'], template:'<button :disabled="disabled"><slot /></button>' });
    app.component('Icon', { template:'<span />' }); app.mount('#app');`, resolveDir: root },
  bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"production"' },
  alias: { '~': path.join(root, 'app'), '#shared': path.join(root, 'shared'), vue: 'vue/dist/vue.esm-bundler.js' },
  plugins: [{ name: 'vue-test', setup(build) {
    build.onLoad({ filter: /\.vue$/ }, async ({ path: file }) => {
      const source = await readFile(file, 'utf8')
      const { descriptor } = parse(source, { filename: file })
      const script = compileScript(descriptor, { id: 'preview-test', inlineTemplate: true })
      const autoImports = `import { ref, shallowRef, computed, watch, onBeforeUnmount, useAttrs, useId } from 'vue';\n`
      return { contents: autoImports + script.content, loader: 'ts', resolveDir: path.dirname(file) }
    })
  } }],
})
const workbook = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(Array.from({ length: 205 }, (_, i) => [`Fila ${i}`, i * 10])), 'Datos')
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['<img src=x onerror=alert(1)>', 'Segunda hoja']]), 'Detalle')
const xls = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xls' }))
const paragraph = text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
const docx = Buffer.from(zipSync(Object.fromEntries(Object.entries({
  '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>',
  '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${paragraph('Presupuesto de prueba')}<w:tbl><w:tr><w:tc>${paragraph('Servicio')}</w:tc><w:tc>${paragraph('1.000 EUR + IVA')}</w:tc></w:tr></w:tbl><w:sectPr><w:headerReference w:type="default" r:id="header"/><w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`,
  'word/_rels/document.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="header" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="footer" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>',
  'word/header1.xml': `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${paragraph('Empresa de prueba')}</w:hdr>`,
  'word/footer1.xml': `<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${paragraph('Pie fiscal de prueba')}</w:ftr>`,
}).map(([name, text]) => [name, strToU8(text)]))))
const server = createServer((req, res) => {
  if (req.url === '/bundle.js') { res.setHeader('content-type', 'text/javascript'); res.end(compiled.outputFiles[0].contents) }
  else if (req.url === '/api/files/1') { res.setHeader('content-type', 'application/vnd.ms-excel'); res.end(xls) }
  else { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><div id="app"></div><script src="/bundle.js"></script>') }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({ channel: process.env.NUMIQ_BROWSER_CHANNEL || 'msedge', headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const upload = page.locator('input[type=file]')
  await upload.setInputFiles({ name: 'presupuesto.docx', mimeType: '', buffer: docx })
  const word = page.frameLocator('iframe')
  await word.getByText('Presupuesto de prueba', { exact: true }).waitFor()
  assert.equal((await word.locator('table').innerText()).replace(/\s+/g, ' ').trim(), 'Servicio 1.000 EUR + IVA')
  assert.ok(await word.getByText('Empresa de prueba', { exact: true }).count())
  assert.ok(await word.getByText('Pie fiscal de prueba', { exact: true }).count())
  assert.match(await word.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'), /default-src 'none'/)
  console.log('OK: DOCX local renderiza texto, tabla, cabecera y pie; mantiene aislamiento')
  await upload.setInputFiles({ name: 'libro.xls', mimeType: '', buffer: xls })
  await page.getByText('Fila 0', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Siguiente' }).click()
  await page.getByText('Fila 100', { exact: true }).waitFor()
  await page.getByLabel('Hoja del libro').selectOption('Detalle')
  await page.getByText('Segunda hoja', { exact: true }).waitFor()
  assert.equal(await page.locator('td img').count(), 0)
  assert.ok(await page.getByText('<img src=x onerror=alert(1)>', { exact: true }).count())
  console.log('OK: XLS local cambia de página y de hoja; las celdas HTML son texto')
  await page.locator('#stored').click()
  await page.getByText('Fila 0', { exact: true }).waitFor()
  console.log('OK: archivo guardado se obtiene mediante la ruta de archivos de la app')
  await upload.setInputFiles({ name: 'roto.docx', mimeType: '', buffer: Buffer.from('archivo dañado') })
  await page.getByText('No se pudo mostrar la vista previa', { exact: true }).waitFor()
  await upload.setInputFiles({ name: 'recuperado.xls', mimeType: '', buffer: xls })
  await page.getByText('Fila 0', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('OK: archivo dañado muestra error y el siguiente vuelve a visualizarse sin errores JS')
}
finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
