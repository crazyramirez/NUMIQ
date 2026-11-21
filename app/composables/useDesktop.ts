/** Puente que expone la app de escritorio (desktop/src/preload.cjs) en window.numiqDesktop */
export interface DesktopBridge {
  /** Secreto de la ventana: acciones solo locales (elegir contraseña sin correo) */
  token: () => Promise<string>
  /** Abre la carpeta de datos (base de datos, archivos, registros) en el explorador */
  openDataFolder: () => Promise<void>
  /** Abre la carpeta de registros (para enviar a soporte) */
  openLogs: () => Promise<void>
  /** El menú de la app o un aviso del sistema piden abrir una pantalla; devuelve cómo dejar de escuchar */
  onNavigate: (cb: (url: string) => void) => () => void
  version: string
  platform: 'win32' | 'darwin' | 'linux'
}

/**
 * NUMIQ de escritorio: el servidor corre en el propio equipo (NUXT_PUBLIC_DESKTOP=true, lo pone la app).
 * Sin URL pública ni más usuarios: se ocultan los enlaces para clientes, el equipo, las passkeys y la
 * suscripción webcal; el correo se configura en Ajustes → Correo y los avisos salen del sistema.
 */
export function useDesktop() {
  const desktop = !!useRuntimeConfig().public.desktop
  const bridge = import.meta.client && desktop ? (window as { numiqDesktop?: DesktopBridge }).numiqDesktop ?? null : null
  return { desktop, bridge }
}
