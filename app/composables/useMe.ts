export interface MeCompany {
  id: number
  legalName: string
  tradeName: string | null
  nif: string
  kind: 'autonomo' | 'sociedad'
  logoPath: string | null
  brandColor: string | null
  verifactuEnabled: boolean
  role: 'owner' | 'admin' | 'member' | 'advisor'
}

export interface Me {
  user: { id: number, email: string, name: string, avatarUrl: string | null, currentCompanyId: number | null, emailVerifiedAt: string | null }
  companies: MeCompany[]
  company: MeCompany | null
}

/** Usuario y empresa activa, cargados una vez y compartidos por toda la app */
export function useMe() {
  const me = useState<Me | null>('me', () => null)

  async function refresh() {
    me.value = await $fetch<Me>('/api/me')
    return me.value
  }

  async function switchCompany(companyId: number) {
    await $fetch('/api/companies/switch', { method: 'POST', body: { companyId } })
    await refresh()
    // Datos de otra empresa: recarga limpia de todas las vistas
    reloadNuxtApp({ path: '/' })
  }

  const companyName = computed(() => me.value?.company?.tradeName || me.value?.company?.legalName || '')
  /** Gestor: modo consulta. Ve todo, pero no crea, cambia ni borra nada de la empresa (el servidor también lo impide) */
  const readOnly = computed(() => me.value?.company?.role === 'advisor')
  /** Datos y ajustes de la empresa: solo el titular y los administradores */
  const canManage = computed(() => me.value?.company?.role === 'owner' || me.value?.company?.role === 'admin')
  /** VeriFactu desactivado de la app por ahora (no exigible como mínimo hasta 2028) */
  const verifactu = computed(() => false)

  return { me, refresh, switchCompany, companyName, readOnly, canManage, verifactu }
}
