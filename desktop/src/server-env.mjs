import { join } from 'node:path'

/** Variables con las que la app de escritorio arranca el servidor de NUMIQ (también la prueba de humo) */
export function serverEnv({ port, dbUrl, dataDir, serverDir, config, windowToken }) {
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    NITRO_HOST: '127.0.0.1',
    NITRO_PORT: String(port),
    PORT: String(port),
    NUXT_DATABASE_URL: dbUrl,
    NUXT_SESSION_PASSWORD: config.sessionPassword,
    NUXT_CERT_SECRET: config.certSecret,
    NUXT_UPLOADS_DIR: join(dataDir, 'uploads'),
    NUXT_PUBLIC_DESKTOP: 'true',
    NUMIQ_DESKTOP: '1',
    NUMIQ_DESKTOP_SETTINGS: join(dataDir, 'settings.json'),
    NUMIQ_DESKTOP_TOKEN: windowToken,
    NUMIQ_MIGRATIONS_DIR: join(serverDir, 'server', 'migrations'),
  }
  // Que ninguna variable del entorno (un .env de desarrollo) cambie a dónde apunta la app
  for (const k of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'DB_DATABASE', 'DB_SOCKET', 'NUXT_DATABASE_HOST', 'NUXT_DATABASE_SOCKET', 'NUXT_SITE_URL', 'GOOGLE_APP_EMAIL', 'GOOGLE_APP_PASSWORD', 'NUXT_MAIL_USER', 'NUXT_MAIL_PASSWORD', 'NUXT_SERVER_ADMINS']) delete env[k]
  return env
}
