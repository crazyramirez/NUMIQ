/**
 * Instaladores de NUMIQ de escritorio (electron-builder), nunca versiones portables:
 *   Windows  → instalador NSIS (.exe) x64, con acceso directo y desinstalador
 *   macOS    → DMG (arrastrar a Aplicaciones), Apple Silicon (arm64) e Intel (x64)
 *   Linux    → paquetes .deb (Debian, Ubuntu, Mint) y .rpm (Fedora, openSUSE) x64
 *
 * Firma (opcional, por variables de entorno; sin ellas el instalador funciona pero el sistema avisa):
 *   Windows: CSC_LINK / CSC_KEY_PASSWORD (o WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD)
 *   macOS:   CSC_LINK / CSC_KEY_PASSWORD (Developer ID Application) y, para notarizar,
 *            APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD y APPLE_TEAM_ID
 */
// En GitHub Actions los secretos que no existen llegan como cadena vacía: electron-builder tomaría
// CSC_LINK="" por una ruta. Vacías = sin firma
for (const k of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_NAME', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
  if (process.env[k] === '') delete process.env[k]
}
const macSigned = !!(process.env.CSC_LINK || process.env.CSC_NAME)
const notarize = macSigned && !!(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID)

/** El MySQL embebido de cada sistema (scripts/fetch-db.mjs) */
const mysql = platform => [{ from: `vendor/mysql/${platform}-\${arch}`, to: 'mysql', filter: ['**/*'] }]

module.exports = {
  appId: 'es.numiq.desktop',
  productName: 'NUMIQ',
  copyright: 'NUMIQ · Facturación, gastos e impuestos para autónomos y pymes',
  artifactName: 'NUMIQ-${version}-${os}-${arch}.${ext}',
  directories: { output: 'dist', buildResources: 'build' },
  files: ['src/**/*', 'build/icon.png', 'package.json', '!**/*.map'],
  asar: true,
  // El servidor de NUMIQ (Nuxt/Nitro) compilado: fuera del asar, lo arranca un proceso aparte
  extraResources: [{ from: '.server', to: 'server', filter: ['**/*', '!**/*.map'] }],
  // Sin publicación automática: los instaladores los sube el flujo de GitHub Actions
  publish: null,
  // Endurecido: el ejecutable no se puede usar como Node (ELECTRON_RUN_AS_NODE, NODE_OPTIONS, --inspect)
  // y solo carga la app de su asar con la integridad comprobada
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
  },

  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.png',
    extraResources: mysql('win32'),
    legalTrademarks: 'NUMIQ',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'NUMIQ',
    installerLanguages: ['es_ES'],
    language: '3082',
    // Desinstalar nunca borra tus datos (base de datos y archivos en %APPDATA%\NUMIQ)
    deleteAppDataOnUninstall: false,
  },

  mac: {
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }],
    icon: 'build/icon.png',
    category: 'public.app-category.finance',
    minimumSystemVersion: '15.0',
    extraResources: mysql('darwin'),
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    // Sin certificado: firma ad hoc (obligatoria para que arranque en Apple Silicon)
    ...(macSigned ? {} : { identity: '-' }),
    notarize,
    extendInfo: {
      NSCameraUsageDescription: 'NUMIQ usa la cámara para escanear tickets y facturas.',
      LSApplicationCategoryType: 'public.app-category.finance',
    },
  },
  dmg: {
    title: 'NUMIQ ${version}',
    contents: [{ x: 140, y: 190 }, { x: 400, y: 190, type: 'link', path: '/Applications' }],
  },

  linux: {
    target: [{ target: 'deb', arch: ['x64'] }, { target: 'rpm', arch: ['x64'] }],
    icon: 'build/icon.png',
    category: 'Office',
    synopsis: 'Facturación, gastos e impuestos para autónomos y pymes',
    description: 'NUMIQ de escritorio: facturas, gastos, banco, impuestos e IA en tu propio ordenador.',
    maintainer: 'NUMIQ <noreply@numiq.app>',
    vendor: 'NUMIQ',
    executableName: 'numiq',
    extraResources: mysql('linux'),
    desktop: { entry: { Name: 'NUMIQ', Comment: 'Facturación, gastos e impuestos', StartupWMClass: 'NUMIQ' } },
  },
  deb: {
    // libaio y libnuma van junto a mysqld; libnuma se declara por si acaso
    depends: ['libgtk-3-0', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6', 'xdg-utils', 'libatspi2.0-0', 'libuuid1', 'libsecret-1-0', 'libnuma1'],
  },
  rpm: {
    depends: ['gtk3', 'libnotify', 'nss', 'libXScrnSaver', 'libXtst', 'xdg-utils', 'at-spi2-core', 'libuuid', 'libsecret', 'numactl-libs'],
  },
}
