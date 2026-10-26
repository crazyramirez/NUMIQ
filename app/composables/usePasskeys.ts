import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
} from '@simplewebauthn/browser'

/**
 * Llaves de acceso (huella, Face ID o PIN) sin esperas: las opciones del servidor se piden antes de
 * que la persona pulse, así el diálogo del sistema se abre dentro del mismo toque. Safari en iPhone
 * no lo abre (o lo cancela sin avisar) si entre el toque y la llamada hay una petición de red.
 */
const REGISTER = '/api/passkeys/register'
const AUTHENTICATE = '/api/passkeys/authenticate'
/** El servidor guarda cada reto 5 minutos: se renueva antes */
const FRESH_MS = 4 * 60_000
/** Llave de NUMIQ de este dispositivo (creada aquí o con la que se entró aquí): su id, o «1» si no se sabe */
const DEVICE_KEY = 'numiq-passkey'
/** Al entrar con contraseña, Inicio ofrece activar la llave en este dispositivo */
export const PASSKEY_OFFER = 'numiq-passkey-offer'

function store(kind: 'local' | 'session') {
  try {
    return kind === 'local' ? localStorage : sessionStorage
  }
  catch {
    return null
  }
}

export function passkeyOnDevice(): string | null {
  try {
    return store('local')?.getItem(DEVICE_KEY) ?? null
  }
  catch {
    return null
  }
}

export function markPasskeyOnDevice(id = '1') {
  try {
    if (id) store('local')?.setItem(DEVICE_KEY, id)
    else store('local')?.removeItem(DEVICE_KEY)
  }
  catch { /* sin almacenamiento: no pasa nada */ }
}

/** El sistema cerró su diálogo: la persona canceló o no había llave */
export const passkeyCancelled = (err: unknown) => ['NotAllowedError', 'AbortError'].includes((err as { name?: string })?.name ?? '')
/** El dispositivo ya tenía una llave de esta cuenta */
export const passkeyAlreadyHere = (err: unknown) => (err as { name?: string })?.name === 'InvalidStateError'

type PublicKeyCredentialCreationOptionsJSON = Parameters<typeof startRegistration>[0]['optionsJSON']
type PublicKeyCredentialRequestOptionsJSON = Parameters<typeof startAuthentication>[0]['optionsJSON']
type AuthenticationResponseJSON = Awaited<ReturnType<typeof startAuthentication>>

interface PreparedRegistration { creationOptions: PublicKeyCredentialCreationOptionsJSON, attemptId: string, at: number }
interface PreparedLogin { requestOptions: PublicKeyCredentialRequestOptionsJSON, attemptId: string, at: number }

/** Crear una llave en este dispositivo para el usuario con la sesión iniciada */
export function usePasskeyRegistration() {
  const { user: sessionUser } = useUserSession()
  const appLock = useAppLock()
  const isSupported = ref(false)
  let prepared: PreparedRegistration | null = null
  let preparing: Promise<PreparedRegistration | null> | null = null

  const userBody = () => (sessionUser.value ? { userName: sessionUser.value.email, displayName: sessionUser.value.name } : null)

  function prepare() {
    const user = userBody()
    if (!user || !isSupported.value) return Promise.resolve(null)
    preparing = $fetch<Omit<PreparedRegistration, 'at'>>(REGISTER, { method: 'POST', body: { user, verify: false } })
      .then(r => (prepared = { ...r, at: Date.now() }))
      .catch(() => (prepared = null))
    return preparing
  }

  async function register() {
    const user = userBody()
    if (!user) throw new Error('Inicia sesión para crear la llave')
    let p = prepared && Date.now() - prepared.at < FRESH_MS ? prepared : null
    prepared = null
    if (!p) p = (await prepare()) ?? null
    prepared = null
    if (!p) throw new Error('No se pudo preparar la llave: revisa la conexión')
    try {
      const response = await startRegistration({ optionsJSON: p.creationOptions })
      await $fetch(REGISTER, { method: 'POST', body: { user, attemptId: p.attemptId, response, verify: true } })
      markPasskeyOnDevice(response.id)
      // Desde ahora esta sesión se bloquea con la llave nueva
      void appLock.sync().catch(() => null)
    }
    catch (err) {
      if (passkeyAlreadyHere(err)) markPasskeyOnDevice()
      throw err
    }
    finally {
      // Un reto sirve una vez: el siguiente intento ya tiene el suyo listo
      void prepare()
    }
  }

  onMounted(async () => {
    isSupported.value = browserSupportsWebAuthn()
    if (isSupported.value) await prepare()
  })

  return { isSupported, register, platformAvailable: platformAuthenticatorIsAvailable, ready: () => preparing }
}

/** Entrar con una llave: botón y, donde el sistema lo permite, sugerencia en el teclado del email */
export function usePasskeyLogin(onSignedIn: () => Promise<void> | void, onError?: (err: unknown) => void) {
  const isSupported = ref(false)
  let prepared: PreparedLogin | null = null
  let conditionalTimer: ReturnType<typeof setTimeout> | null = null
  let alive = true

  const fetchOptions = () => $fetch<Omit<PreparedLogin, 'at'>>(AUTHENTICATE, { method: 'POST', body: { verify: false } })
    .then(r => ({ ...r, at: Date.now() }))

  async function prepare() {
    prepared = await fetchOptions().catch(() => null)
  }

  async function verify(p: PreparedLogin, response: AuthenticationResponseJSON) {
    await $fetch(AUTHENTICATE, { method: 'POST', body: { attemptId: p.attemptId, response, verify: true } })
    // Solo si la llave es de este dispositivo (no la de un móvil escaneando un QR)
    if (response.authenticatorAttachment === 'platform') markPasskeyOnDevice(response.id)
    await onSignedIn()
  }

  /** Sugerencia en el teclado (Safari y Chrome): solo aparece si hay llave, y no molesta si no */
  async function startConditional() {
    if (!alive || !(await browserSupportsWebAuthnAutofill().catch(() => false))) return
    if (conditionalTimer) clearTimeout(conditionalTimer)
    const p = await fetchOptions().catch(() => null)
    if (!p || !alive) return
    // El reto caduca: se renueva sin que se note
    conditionalTimer = setTimeout(() => void startConditional(), FRESH_MS)
    try {
      const response = await startAuthentication({ optionsJSON: p.requestOptions, useBrowserAutofill: true })
      if (conditionalTimer) clearTimeout(conditionalTimer)
      await verify(p, response)
    }
    catch (err) {
      // Cancelada por el botón, por la renovación o por la persona: no hay nada que contar
      if (!passkeyCancelled(err) && alive) onError?.(err)
    }
  }

  /** Botón «Entrar con huella o Face ID». Devuelve false si el sistema no encontró llave o se canceló */
  async function signIn(): Promise<boolean> {
    let p = prepared && Date.now() - prepared.at < FRESH_MS ? prepared : null
    prepared = null
    if (!p) p = await fetchOptions()
    if (conditionalTimer) clearTimeout(conditionalTimer)
    try {
      const response = await startAuthentication({ optionsJSON: p.requestOptions })
      await verify(p, response)
      return true
    }
    catch (err) {
      if (passkeyCancelled(err)) return false
      throw err
    }
    finally {
      if (alive) {
        void prepare()
        void startConditional()
      }
    }
  }

  onMounted(async () => {
    isSupported.value = browserSupportsWebAuthn()
    if (!isSupported.value) return
    await prepare()
    void startConditional()
  })

  onBeforeUnmount(() => {
    alive = false
    if (conditionalTimer) clearTimeout(conditionalTimer)
    WebAuthnAbortService.cancelCeremony()
  })

  return { isSupported, signIn }
}
