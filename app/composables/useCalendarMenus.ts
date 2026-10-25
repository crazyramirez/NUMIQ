import type { InjectionKey, Ref } from 'vue'
import type { CalendarItem } from '#shared/utils/calendar'
import type { CtxItem, CtxSpec } from '~/composables/useContextMenu'

/**
 * Menús contextuales del calendario (clic derecho o pulsación larga): la página da sus acciones
 * con `provideCalendarMenus` y la cuadrícula, la agenda, las filas y el año los piden con
 * `useCalendarMenus` (fuera del calendario no hay menú propio y sale el general).
 */
export interface CalendarMenuApi {
  canEdit: Ref<boolean>
  today: Ref<string>
  view: Ref<'mes' | 'agenda' | 'ano'>
  selected: Ref<string>
  items: Ref<CalendarItem[]>
  openItem: (it: CalendarItem) => void
  create: (date?: string) => void
  edit: (id: number) => void
  toggleDone: (it: CalendarItem) => void
  move: (it: CalendarItem, date: string) => void
  select: (date: string) => void
  goToday: () => void
  reload: () => unknown
}

interface CalendarMenus {
  day: (date: string) => CtxSpec
  item: (it: CalendarItem) => CtxSpec
  month: (ym: string) => CtxSpec
}

const KEY: InjectionKey<CalendarMenus> = Symbol('calendar-menus')

/** Sin calendario alrededor (p. ej. una fila en otra pantalla) devuelven null: sale el menú general */
export function useCalendarMenus() {
  const m = inject(KEY, null)
  return {
    day: (date: string) => m?.day(date) ?? null,
    item: (it: CalendarItem) => m?.item(it) ?? null,
    month: (ym: string) => m?.month(ym) ?? null,
  }
}

export function provideCalendarMenus(api: CalendarMenuApi) {
  const toast = useToast()
  const { confirm } = useConfirm()

  function showDay(date: string, view: 'mes' | 'agenda' = 'mes') {
    api.select(date)
    api.view.value = view
  }

  // ─── Un día (celda del mes, día del año, fecha de la agenda) ───

  function day(date: string): CtxSpec {
    const list = api.items.value.filter(i => onDay(i, date) && i.type !== 'window')
    const holiday = list.find(i => i.layer === 'holiday')
    const n = list.filter(i => i.layer !== 'holiday').length
    const t = api.today.value
    const rel = date === t ? 'Hoy' : relDays(date)
    const items: CtxItem[] = [
      ...(api.canEdit.value ? [{ label: 'Nuevo evento o tarea', icon: 'ph:calendar-plus', keys: ['N'], onClick: () => api.create(date) }, { divider: true }] : []),
      ...(api.view.value !== 'mes' || date !== api.selected.value ? [{ label: n ? `Ver el día (${n})` : 'Ver el día', icon: 'ph:calendar-dot', onClick: () => showDay(date) }] : []),
      ...(api.view.value !== 'agenda' ? [{ label: 'Ver en la agenda', icon: 'ph:list-bullets', onClick: () => showDay(date, 'agenda') }] : []),
      ...(date !== t ? [{ label: 'Ir a hoy', icon: 'ph:calendar-check', keys: ['H'], onClick: api.goToday }] : []),
      { divider: true },
      { label: 'Copiar la fecha', sub: longDate(date, true), icon: 'ph:copy', onClick: () => copyText(longDate(date, true), 'Fecha') },
    ]
    return { title: longDate(date), subtitle: [rel, holiday?.title, n ? `${n} ${n === 1 ? 'cosa' : 'cosas'}` : 'Día libre'].filter(Boolean).join(' · '), icon: 'ph:calendar-blank', items }
  }

  // ─── Un mes en la vista Año ───

  function month(ym: string): CtxSpec {
    const t = api.today.value
    return {
      title: monthTitle(ym),
      icon: 'ph:calendar',
      items: [
        { label: 'Abrir el mes', icon: 'ph:calendar-dots', onClick: () => showDay(t.startsWith(ym) ? t : `${ym}-01`) },
        { label: 'Agenda del mes', icon: 'ph:list-bullets', onClick: () => showDay(t.startsWith(ym) ? t : `${ym}-01`, 'agenda') },
        ...(api.canEdit.value ? [{ divider: true }, { label: 'Nuevo evento este mes', icon: 'ph:calendar-plus', onClick: () => api.create(t.startsWith(ym) ? t : `${ym}-01`) }] : []),
      ],
    }
  }

  // ─── Un elemento (evento propio, factura, gasto, plazo…) ───

  async function duplicate(it: CalendarItem) {
    try {
      const { id: _id, doneDates: _done, ...dto } = await $fetch<Record<string, unknown> & { id: number, doneDates: string[] }>(`/api/calendar/events/${it.eventId}`)
      const res = await $fetch<{ id: number }>('/api/calendar/events', { method: 'POST', body: dto })
      await api.reload()
      toast.push({ tone: 'success', title: 'Duplicado', body: `${it.title} · ${longDate(it.date)}`, action: { label: 'Editar', run: () => api.edit(res.id) } })
    }
    catch (err) {
      toast.error('No se pudo duplicar', errorMessage(err))
    }
  }

  async function remove(it: CalendarItem) {
    const ok = await confirm({
      title: `¿Borrar «${it.title}»?`,
      body: it.repeat ? 'Se borran todas sus repeticiones.' : 'No se puede deshacer.',
      confirmLabel: 'Borrar',
      danger: true,
    })
    if (!ok) return
    try {
      await $fetch(`/api/calendar/events/${it.eventId}`, { method: 'DELETE' })
      toast.success('Borrado', it.title)
      await api.reload()
    }
    catch (err) {
      toast.error('No se pudo borrar', errorMessage(err))
    }
  }

  function downloadIcs(it: CalendarItem) {
    const url = URL.createObjectURL(itemIcs(it))
    const a = document.createElement('a')
    a.href = url
    a.download = `${it.title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 60) || 'evento'}.ics`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1500)
  }

  function openLabel(it: CalendarItem) {
    if (it.layer === 'income') return { label: 'Abrir la factura', icon: 'ph:receipt' }
    if (it.layer === 'expense') return { label: 'Abrir el gasto', icon: 'ph:wallet' }
    if (it.layer === 'quote') return { label: 'Abrir el presupuesto', icon: 'ph:file-text' }
    if (it.layer === 'tax') return { label: 'Preparar los modelos', icon: 'ph:bank' }
    if (it.layer === 'recurring') return { label: 'Ver la programación', icon: 'ph:arrows-clockwise' }
    if (it.layer === 'event') return { label: 'Ver el contacto', icon: 'ph:user' }
    return { label: 'Abrir', icon: 'ph:arrow-right' }
  }

  function item(it: CalendarItem): CtxSpec {
    const own = !!it.eventId && api.canEdit.value
    const t = api.today.value
    const from = it.occurrence ?? it.date
    const when = [isMultiDay(it) ? `${dayMonth(it.date)} – ${dayMonth(it.endDate!)}` : longDate(it.date), timeRange(it)].filter(Boolean).join(' · ')
    const sign = it.flow === 'in' ? '+' : it.flow === 'out' ? '−' : ''
    const items: CtxItem[] = [{ label: 'Ver detalle', icon: 'ph:eye', keys: ['↵'], onClick: () => api.openItem(it) }]

    if (own) {
      items.push({ label: 'Editar', icon: 'ph:pencil-simple', onClick: () => api.edit(it.eventId!) })
      if (it.type === 'task') {
        items.push({ label: it.done ? 'Marcar como pendiente' : 'Marcar como hecha', icon: it.done ? 'ph:arrow-counter-clockwise' : 'ph:check-square', onClick: () => api.toggleDone(it) })
      }
      if (it.occurrence) {
        const targets: Array<[string, string, string]> = [
          ...(from !== t ? [['Hoy', 'ph:calendar-check', t] as [string, string, string]] : []),
          ['Mañana', 'ph:sun-horizon', shiftDays(from, 1)],
          ['Pasado mañana', 'ph:arrow-right', shiftDays(from, 2)],
          ['Una semana después', 'ph:calendar-plus', shiftDays(from, 7)],
          ['Un día antes', 'ph:arrow-left', shiftDays(from, -1)],
        ]
        items.push({
          label: it.repeat ? 'Mover la serie' : 'Mover',
          icon: 'ph:arrows-out-cardinal',
          children: [
            ...targets.filter(([, , d]) => d !== from).map(([label, icon, d]) => ({ label, icon, sub: longDate(d), onClick: () => api.move(it, d) })),
            { divider: true },
            { label: 'Elegir otra fecha…', icon: 'ph:calendar-dots', onClick: () => api.edit(it.eventId!) },
          ],
        })
      }
      if (!it.repeat) items.push({ label: 'Duplicar', icon: 'ph:copy-simple', onClick: () => duplicate(it) })
    }
    else if (it.to) {
      const o = openLabel(it)
      items.push({ label: o.label, icon: o.icon, to: it.to })
    }

    if (api.view.value !== 'mes' || !onDay(it, api.selected.value)) items.push({ label: 'Ver el día', icon: 'ph:calendar-dot', onClick: () => showDay(it.date) })
    items.push({ divider: true })

    const copy: CtxItem[] = [
      { label: 'Título', sub: it.title, icon: 'ph:text-t', onClick: () => copyText(it.title, 'Título') },
      ...(it.amount ? [{ label: 'Importe', sub: `${sign}${eur(it.amount)}`, icon: 'ph:currency-eur', onClick: () => copyText(plainAmount(it.amount!), 'Importe') }] : []),
      { label: 'Fecha', sub: when, icon: 'ph:calendar-blank', onClick: () => copyText(when, 'Fecha') },
      ...(it.location ? [{ label: 'Lugar', sub: it.location, icon: 'ph:map-pin', onClick: () => copyText(it.location, 'Lugar') }] : []),
      ...(it.to ? [{ label: 'Enlace', icon: 'ph:link', onClick: () => copyText(`${window.location.origin}${it.to}`, 'Enlace') }] : []),
    ]
    items.push({ label: 'Copiar', icon: 'ph:copy', children: copy })

    if (it.layer !== 'feed' && it.layer !== 'holiday') {
      items.push({
        label: 'Añadir a otro calendario',
        icon: 'ph:calendar-plus',
        children: [
          { label: 'Google Calendar', icon: 'ph:google-logo', onClick: () => window.open(googleEventUrl(it), '_blank', 'noopener') },
          { label: 'Apple Calendar (.ics)', icon: 'ph:apple-logo', onClick: () => downloadIcs(it) },
          { label: 'Outlook (.ics)', icon: 'ph:microsoft-outlook-logo', onClick: () => downloadIcs(it) },
        ],
      })
    }

    if (own) items.push({ divider: true }, { label: it.repeat ? 'Borrar la serie' : 'Borrar', icon: 'ph:trash', danger: true, onClick: () => remove(it) })

    return {
      title: it.title,
      subtitle: [when, it.amount ? `${sign}${eur(it.amount)}` : null, statusText(it)].filter(Boolean).join(' · '),
      icon: it.icon,
      items,
    }
  }

  provide(KEY, { day, item, month })
}
