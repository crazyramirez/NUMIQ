export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',

  devtools: { enabled: false },

  // App privada tras login: sin SSR, el servidor solo expone la API
  ssr: false,

  modules: ['nuxt-auth-utils', '@nuxt/icon', '@vueuse/nuxt'],

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
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'description', content: 'Facturación, gastos e impuestos para autónomos y pymes, con IA.' },
        { name: 'theme-color', content: '#f5f6f8', media: '(prefers-color-scheme: light)' },
        { name: 'theme-color', content: '#0b0d12', media: '(prefers-color-scheme: dark)' },
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
        { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
      ],
      // Tema antes del primer pintado: sin destello claro en modo oscuro
      script: [{
        innerHTML: `(function(){try{var m=localStorage.getItem('numiq-theme')||'auto';var d=m==='dark'||(m==='auto'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light')}catch(e){}})()`,
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
