export interface Signature {
  id: number
  name: string
  kind: 'drawn' | 'typed' | 'image'
  width: number
  height: number
  isDefault: boolean
  createdAt: string
  url: string
}

/** Firmas guardadas de la empresa: una sola lista para Ajustes y el visor de documentos */
export function useSignatures() {
  const list = useState<Signature[] | null>('signatures', () => null)
  const loading = useState('signatures-loading', () => false)

  async function load(force = false) {
    if ((list.value && !force) || loading.value) return list.value
    loading.value = true
    try {
      list.value = await $fetch<Signature[]>('/api/signatures')
    }
    finally {
      loading.value = false
    }
    return list.value
  }

  async function create(input: { blob: Blob, name: string, kind: Signature['kind'] }) {
    const body = new FormData()
    body.append('name', input.name)
    body.append('kind', input.kind)
    body.append('file', input.blob, 'firma.png')
    const created = await $fetch<Signature>('/api/signatures', { method: 'POST', body })
    list.value = [...(list.value ?? []), created]
    return created
  }

  async function rename(id: number, name: string) {
    await $fetch(`/api/signatures/${id}`, { method: 'PATCH', body: { name } })
    list.value = (list.value ?? []).map(s => (s.id === id ? { ...s, name } : s))
  }

  async function makeDefault(id: number) {
    await $fetch(`/api/signatures/${id}`, { method: 'PATCH', body: { isDefault: true } })
    const rows = (list.value ?? []).map(s => ({ ...s, isDefault: s.id === id }))
    list.value = [...rows.filter(s => s.isDefault), ...rows.filter(s => !s.isDefault)]
  }

  async function remove(id: number) {
    await $fetch(`/api/signatures/${id}`, { method: 'DELETE' })
    await load(true)
  }

  // Firma por defecto en facturas y presupuestos (Ajustes → Firmas)
  const settings = useState<SigningSettings | null>('signing-settings', () => null)
  async function loadSettings(force = false) {
    if (!settings.value || force) settings.value = await $fetch<SigningSettings>('/api/signatures/settings')
    return settings.value
  }
  async function saveSettings(next: SigningSettings) {
    const prev = settings.value
    settings.value = next
    try {
      settings.value = await $fetch<SigningSettings>('/api/signatures/settings', { method: 'PUT', body: next })
    }
    catch (err) {
      settings.value = prev
      throw err
    }
  }

  return { list, loading, load, create, rename, makeDefault, remove, settings, loadSettings, saveSettings }
}

export interface SigningSettings {
  invoices: boolean
  quotes: boolean
  /** null = la principal */
  signatureId: number | null
  /** Texto sobre la firma; vacío = sin texto */
  label: string
}
