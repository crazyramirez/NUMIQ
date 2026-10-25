const SEEN_KEY = 'numiq-news-seen'

/**
 * Novedades sin ver en este dispositivo: las posteriores a la última vez que se abrió Ajustes → Novedades.
 * Se lee al montar (no en el servidor) para no descuadrar la hidratación.
 */
export function useNews() {
  const seenAt = useState<string | null>('news-seen', () => null)
  const ready = useState('news-ready', () => false)

  onMounted(() => {
    if (ready.value) return
    try {
      seenAt.value = localStorage.getItem(SEEN_KEY)
    }
    catch {}
    ready.value = true
  })

  const latest = CHANGELOG[0]?.at ?? ''
  const unseen = computed(() => (ready.value ? CHANGELOG.filter(e => !seenAt.value || e.at > seenAt.value).length : 0))

  function markSeen() {
    seenAt.value = latest
    try {
      localStorage.setItem(SEEN_KEY, latest)
    }
    catch {}
  }

  return { seenAt, ready, unseen, markSeen }
}
