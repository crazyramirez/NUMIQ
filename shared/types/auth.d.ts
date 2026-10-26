declare module '#auth-utils' {
  interface User {
    id: number
    email: string
    name: string
    avatarUrl: string | null
  }

  /** Solo en el servidor (la cookie va sellada y /api/_auth/session no la devuelve) */
  interface SecureSessionData {
    /** Bloqueo con huella, Face ID o PIN de esta sesión (server/utils/app-lock.ts) */
    lock?: {
      /** Llave de acceso de este dispositivo ('*' si no se sabe cuál): sin ella, la sesión no se bloquea */
      key?: string
      /** Último desbloqueo (o entrada) */
      at?: number
      /** Última señal de vida con la app a la vista («Siempre») */
      seen?: number
      /** Última comprobación de identidad: huella, cara, PIN o contraseña */
      verified?: number
    }
  }
}

export {}
