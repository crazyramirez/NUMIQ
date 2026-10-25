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

  return { list, loading, load, create, rename, makeDefault, remove }
}
