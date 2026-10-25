import { execSync } from 'node:child_process'
import pkg from './package.json'

// URL pública del .env (nuxi build también lo lee): las redes sociales solo aceptan og:image absolutas
const siteUrl = (process.env.NUXT_SITE_URL || '').replace(/\/+$/, '')
const description = 'Facturación, gastos e impuestos para autónomos y pymes, con IA.'

// Versión junto al logo: mayor.menor de package.json + nº de build, que sube con cada push (commits de la rama).
// En Plesk la carpeta desplegada no trae .git: scripts/plesk-deploy.sh lo calcula y lo pasa en NUMIQ_BUILD
function buildNumber() {
  if (process.env.NUMIQ_BUILD) return process.env.NUMIQ_BUILD.trim()
  try {
    return execSync('git rev-list --count HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  }
  catch {
    return ''
  }
}
const build = buildNumber()
const appVersion = build ? `${pkg.version.split('.').slice(0, 2).join('.')}.${build}` : pkg.version

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',

  devtools: { enabled: false },

  // App privada tras login: sin SSR, el servidor solo expone la API
  ssr: false,

  modules: ['nuxt-auth-utils', '@nuxt/icon', '@vueuse/nuxt'],

  // Llaves de acceso (passkeys): entrar con huella, cara o el PIN del dispositivo
  auth: { webAuthn: true },

  css: [
    '@fontsource-variable/inter/opsz.css',
    // Tipografías de las facturas (diseño a medida): solo se descargan si una factura las usa
    '@fontsource/lora/latin-400.css',
    '@fontsource/lora/latin-600.css',
    '@fontsource/manrope/latin-400.css',
    '@fontsource/manrope/latin-600.css',
    '~/assets/css/tokens.css',
    '~/assets/css/base.css',
    '~/assets/css/ui.css',
    '~/assets/css/paper.css',
  ],

  components: [
    // Sistema de diseño: <UiButton>, <UiCard>…  Shell de la app: <AppSidebar>…
    { path: '~/components/ui', prefix: 'Ui' },
    { path: '~/components/app', prefix: 'App' },
    '~/components',
  ],

  app: {
    head: {
      title: 'NUMIQ',
      htmlAttrs: { lang: 'es' },
      meta: [
        // Sin zoom ni escalado: se usa como app (los gestos de iOS se cortan en plugins/no-zoom.client.ts)
        { name: 'viewport', content: 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover' },
        { name: 'description', content: description },
        // Vista previa al compartir un enlace (WhatsApp, LinkedIn, X…): sin SSR, los rastreadores solo ven esta cabecera
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'NUMIQ' },
        { property: 'og:locale', content: 'es_ES' },
        { property: 'og:title', content: 'NUMIQ · Facturas, gastos e impuestos, en orden' },
        { property: 'og:description', content: description },
        ...(siteUrl ? [{ property: 'og:url', content: `${siteUrl}/` }] : []),
        { property: 'og:image', content: `${siteUrl}/og-image.jpg` },
        { property: 'og:image:type', content: 'image/jpeg' },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { property: 'og:image:alt', content: 'NUMIQ: facturas, gastos e impuestos en orden, con IA para autónomos y pymes' },
        { name: 'twitter:card', content: 'summary_large_image' },
        // theme-color no va aquí: lo pone el script de abajo y plugins/theme-color.client.ts según el tema elegido en la app
        // App instalable (PWA): pantalla completa y nombre en el móvil
        { name: 'application-name', content: 'NUMIQ' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-title', content: 'NUMIQ' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
        { name: 'format-detection', content: 'telephone=no' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' },
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
      // Tema antes del primer pintado: sin destello claro en modo oscuro, y la barra de estado (theme-color) a juego
      script: [{
        innerHTML: `(function(){var d=false;try{var m=localStorage.getItem('numiq-theme')||'auto';d=m==='dark'||(m==='auto'&&matchMedia('(prefers-color-scheme: dark)').matches)}catch(e){}document.documentElement.setAttribute('data-theme',d?'dark':'light');var t=document.createElement('meta');t.name='theme-color';t.content=d?'#0a0c10':'#f5f6f8';document.head.appendChild(t)})()`,
      }],
    },
    pageTransition: { name: 'page', mode: 'out-in' },
  },

  icon: {
    serverBundle: { collections: ['ph'] },
    clientBundle: { scan: true, sizeLimitKb: 512 },
  },

  runtimeConfig: {
    databaseUrl: 'mysql://root:@127.0.0.1:3308/numiq',
    autoMigrate: true,
    uploadsDir: './storage/uploads',
    // IA (OpenAI): lectura de facturas, tickets y fotos, importación y recomendaciones
    openaiApiKey: '',
    // Lectura de documentos (rápido y preciso) y segunda lectura si los importes no cuadran
    openaiModel: 'gpt-5.4-mini',
    openaiProModel: 'gpt-5.5',
    // Documentos leídos a la vez en una importación por lotes
    openaiConcurrency: 4,
    // Asistente conversacional (con herramientas sobre los datos de la empresa)
    openaiChatModel: 'gpt-5.5',
    // Tarifas propias en USD por millón de tokens si OpenAI cambia un precio: {"gpt-5.5":[5,0.5,30]}
    openaiPrices: '',
    // Clave para custodiar cifrados los certificados digitales (si falta, se deriva de la de sesión)
    certSecret: '',
    // VeriFactu: datos del productor del software (por defecto, la propia empresa usuaria)
    verifactuProducerName: '',
    verifactuProducerNif: '',
    // URL pública para los enlaces de los correos (sin barra final)
    siteUrl: '',
    // Correo: Gmail con contraseña de aplicación (GOOGLE_APP_EMAIL / GOOGLE_APP_PASSWORD) u otro SMTP/IMAP
    mail: {
      smtpHost: 'smtp.gmail.com',
      smtpPort: 465,
      imapHost: 'imap.gmail.com',
      imapPort: 993,
      user: '',
      password: '',
      from: '',
      // Usuarios que pueden buscar facturas en todo el buzón (además del titular de la cuenta)
      inboxOwners: '',
    },
    session: {
      name: 'numiq-session',
      password: '',
      maxAge: 60 * 60 * 24 * 30,
    },
    public: {
      appName: 'NUMIQ',
      appVersion,
    },
  },

  hooks: {
    // Incluir las migraciones en .output para poder desplegar solo la carpeta compilada
    'nitro:build:public-assets': async (nitro) => {
      const { cpSync, existsSync } = await import('node:fs')
      const { join } = await import('node:path')
      const from = join(nitro.options.rootDir, 'server/db/migrations')
      if (existsSync(from)) cpSync(from, join(nitro.options.output.serverDir, 'migrations'), { recursive: true })
    },
    // En producción, leer el .env de la carpeta de la app (Plesk sin variables en el panel). Nitro fija la
    // configuración al cargar sus módulos: index.mjs pasa a ser un arranque que carga el .env y luego app.mjs
    'nitro:init': (nitro) => {
      if (nitro.options.dev) return
      nitro.hooks.hook('compiled', async () => {
        const { readFileSync, renameSync, rmSync, writeFileSync } = await import('node:fs')
        const { join } = await import('node:path')
        const dir = nitro.options.output.serverDir
        const app = readFileSync(join(dir, 'index.mjs'), 'utf8').replace('sourceMappingURL=index.mjs.map', 'sourceMappingURL=app.mjs.map')
        writeFileSync(join(dir, 'app.mjs'), app)
        rmSync(join(dir, 'index.mjs'))
        try {
          renameSync(join(dir, 'index.mjs.map'), join(dir, 'app.mjs.map'))
        }
        catch {
          // build sin sourcemaps
        }
        writeFileSync(join(dir, 'index.mjs'), [
          '// Variables del .env de la carpeta de la app; las del entorno (panel) tienen prioridad',
          'try {',
          '  process.loadEnvFile()',
          '}',
          'catch (err) {',
          '  if (err?.code !== \'ENOENT\') console.error(\'[env] No se pudo leer .env:\', err?.message ?? err)',
          '}',
          'await import(\'./app.mjs\')',
          '',
        ].join('\n'))
      })
    },
  },

  // Carpeta de salida configurable: scripts/plesk-deploy.sh compila en .output-next y solo la cambia si sale bien
  // asyncContext: useEvent() en cualquier punto de una petición (el consumo de IA sabe de qué empresa es)
  nitro: {
    experimental: { asyncContext: true },
    ...(process.env.NITRO_OUTPUT_DIR ? { output: { dir: process.env.NITRO_OUTPUT_DIR } } : {}),
  },

  experimental: {
    // Las versiones nuevas las vigila el plugin app-update (al volver a la pestaña y cada pocos minutos), no cada hora
    checkOutdatedBuildInterval: false,
  },

  typescript: {
    strict: true,
  },

  // Desarrollo accesible desde otros dispositivos de la red (http://192.168.x.x:3210):
  // sin HTTPS el navegador descarta las cookies Secure y no se podría iniciar sesión
  $development: {
    runtimeConfig: {
      session: { cookie: { secure: false } },
    },
  },
})
