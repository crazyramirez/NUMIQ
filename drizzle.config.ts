import { defineConfig } from 'drizzle-kit'

try {
  process.loadEnvFile?.('.env')
}
catch {
  // sin .env: usar variables del entorno
}

export default defineConfig({
  dialect: 'mysql',
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dbCredentials: {
    url: process.env.NUXT_DATABASE_URL || 'mysql://root@127.0.0.1:3308/numiq',
  },
})
