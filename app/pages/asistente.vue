<script setup lang="ts">
import type { AiActionView } from '#shared/types/assistant'
import type { CtxItem, CtxSpec } from '~/composables/useContextMenu'

useHead({ title: 'Asistente IA · NUMIQ' })

interface Message {
  id: number | string
  role: 'user' | 'assistant'
  content: string
  tools?: string[] | null
  /** Operaciones propuestas en esta respuesta (tarjetas para confirmar) */
  actions?: AiActionView[]
  streaming?: boolean
  status?: string | null
  error?: boolean
}

interface Conversation {
  id: number
  title: string
  updatedAt: string
}

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { confirm } = useConfirm()
const { me } = useMe()
const { data: ai } = await useFetch<{ configured: boolean }>('/api/ai/status', { default: () => ({ configured: true }) })
const { data: conversations, refresh: refreshList } = await useFetch<Conversation[]>('/api/assistant/conversations', { default: () => [] })

const firstName = computed(() => me.value?.user.name.split(' ')[0] ?? '')
const conversationId = ref<number | null>(null)
const messages = ref<Message[]>([])
const draft = ref('')
// Mismo límite que el servidor: se avisa antes de enviar y el texto no se pierde
const MAX_ASK = 15000
const draftLength = computed(() => draft.value.trim().length)
const tooLong = computed(() => draftLength.value > MAX_ASK)
const busy = ref(false)
const loadingConv = ref(false)
const historyOpen = ref(false)
let controller: AbortController | null = null

const TOOL_NAMES: Record<string, string> = {
  resumen_periodo: 'Cifras del periodo',
  cobros_pendientes: 'Cobros pendientes',
  pagos_pendientes: 'Pagos pendientes',
  calendario_fiscal: 'Calendario fiscal',
  evolucion_mensual: 'Evolución mensual',
  buscar: 'Búsqueda',
  detalle_factura: 'Factura',
  crear_borrador: 'Borrador creado',
  banco: 'Banco',
  listar: 'Registros',
  operar_facturas: 'Facturas',
  operar_gastos: 'Gastos',
  operar_banco: 'Banco',
  operar_contactos: 'Contactos',
  operar_productos: 'Productos',
  crear_contacto: 'Contacto creado',
  crear_producto: 'Producto creado',
  crear_gasto: 'Gasto anotado',
}

const SUGGESTIONS = [
  { icon: 'ph:piggy-bank', text: '¿Cuánto debo apartar para impuestos este trimestre?' },
  { icon: 'ph:hand-coins', text: '¿Qué clientes me deben dinero y desde cuándo?' },
  { icon: 'ph:trend-up', text: '¿Cómo va el año comparado con el anterior?' },
  { icon: 'ph:scissors', text: '¿En qué gasto más y qué podría reducir?' },
  { icon: 'ph:calendar-check', text: '¿Qué tengo que presentar a Hacienda y cuándo?' },
  { icon: 'ph:lightbulb', text: 'Dame 3 recomendaciones para mejorar mi negocio' },
]

// ─── Conversaciones ───

async function open(id: number | null) {
  historyOpen.value = false
  controller?.abort()
  conversationId.value = id
  messages.value = []
  router.replace({ query: id ? { c: String(id) } : {} })
  if (!id) return
  loadingConv.value = true
  try {
    const c = await $fetch<{ messages: Message[] }>(`/api/assistant/conversations/${id}`)
    messages.value = c.messages
    await nextTick()
    scrollDown(true)
  }
  catch (err) {
    toast.error('No se pudo abrir', errorMessage(err))
    conversationId.value = null
  }
  finally {
    loadingConv.value = false
  }
}

async function remove(c: Conversation) {
  const ok = await confirm({ title: '¿Borrar esta conversación?', body: c.title, confirmLabel: 'Borrar', danger: true })
  if (!ok) return
  await $fetch(`/api/assistant/conversations/${c.id}`, { method: 'DELETE' }).catch(err => toast.error('No se pudo borrar', errorMessage(err)))
  if (conversationId.value === c.id) open(null)
  await refreshList()
}

// ─── Operaciones propuestas ───

/** Actualiza la tarjeta donde esté (al confirmar escribiendo «sí» es la de una respuesta anterior) */
function upsertAction(v: AiActionView, fallback?: Message) {
  for (const m of messages.value) {
    const i = m.actions?.findIndex(x => x.id === v.id) ?? -1
    if (i >= 0) {
      m.actions![i] = v
      return
    }
  }
  if (fallback) (fallback.actions ??= []).push(v)
}

// ─── Enviar y recibir en streaming ───

const scroller = ref<HTMLElement>()
let stick = true
function onScroll() {
  const el = scroller.value
  if (el) stick = el.scrollHeight - el.scrollTop - el.clientHeight < 80
}
function scrollDown(force = false) {
  const el = scroller.value
  if (el && (stick || force)) el.scrollTop = el.scrollHeight
}

async function send(text?: string) {
  const q = (text ?? draft.value).trim()
  if (!q || busy.value || q.length > MAX_ASK) return
  draft.value = ''
  busy.value = true
  stick = true
  messages.value.push({ id: `u${Date.now()}`, role: 'user', content: q })
  const answer = reactive<Message>({ id: `a${Date.now()}`, role: 'assistant', content: '', tools: [], actions: [], streaming: true, status: 'Pensando' })
  messages.value.push(answer)
  await nextTick()
  scrollDown(true)
  controller = new AbortController()
  try {
    const res = await fetch('/api/assistant/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: conversationId.value, message: q }),
      signal: controller.signal,
    })
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => null) as { statusMessage?: string } | null
      throw new Error(body?.statusMessage ?? 'No se pudo responder')
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let i: number
      while ((i = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, i).replace(/^data: /, '')
        buffer = buffer.slice(i + 2)
        const ev = JSON.parse(raw) as { type: string, text?: string, name?: string, label?: string, conversationId?: number, message?: string, messageId?: number, action?: AiActionView }
        if (ev.type === 'start' && ev.conversationId) {
          if (!conversationId.value) router.replace({ query: { c: String(ev.conversationId) } })
          conversationId.value = ev.conversationId
        }
        else if (ev.type === 'tool') {
          answer.status = ev.label ?? 'Consultando tus datos'
          if (ev.name && !answer.tools!.includes(ev.name)) answer.tools!.push(ev.name)
        }
        else if (ev.type === 'action' && ev.action) {
          upsertAction(ev.action, answer)
          scrollDown()
        }
        else if (ev.type === 'delta' && ev.text) {
          answer.status = null
          answer.content += ev.text
          scrollDown()
        }
        else if (ev.type === 'error') {
          throw new Error(ev.message)
        }
        else if (ev.type === 'done' && ev.messageId) {
          answer.id = ev.messageId
        }
      }
    }
  }
  catch (err) {
    if ((err as Error).name !== 'AbortError') {
      answer.error = true
      answer.content = answer.content || (err as Error).message || 'No se pudo responder'
    }
  }
  finally {
    answer.streaming = false
    answer.status = null
    busy.value = false
    controller = null
    refreshList()
    await nextTick()
    scrollDown()
    input.value?.focus()
  }
}

function stop() {
  controller?.abort()
}

// ─── Composer ───

const input = ref<HTMLTextAreaElement>()
function autosize() {
  const el = input.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`
}
watch(draft, () => nextTick(autosize))
// Pantalla táctil: Intro hace salto de línea y se envía con el botón (como en cualquier app de mensajes)
const touch = import.meta.client && window.matchMedia('(pointer: coarse)').matches
function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !touch) {
    e.preventDefault()
    send()
  }
}

// ─── Móvil: el chat ocupa justo lo que se ve ───
// Con el teclado abierto, encima de él; al cerrarlo, la pantalla vuelve a su sitio.
// Al enfocar, el navegador desplaza la página para enseñar el campo antes de que el chat se encoja,
// y ese desplazamiento lo dejaba demasiado arriba: con teclado el chat se fija a la zona visible
const viewH = ref<number | null>(null)
const viewTop = ref(0)
const keyboard = ref(false)
function fitViewport() {
  const vv = window.visualViewport
  if (!vv) return
  const was = keyboard.value
  const h = Math.round(vv.height)
  keyboard.value = window.innerHeight - vv.height > 120
  viewTop.value = Math.round(vv.offsetTop)
  // Teclado cerrado sin perder el foco (botón atrás de Android): la página vuelve arriba
  if (was && !keyboard.value) window.scrollTo({ top: 0 })
  if (h !== viewH.value) {
    viewH.value = h
    // Si estabas al final, la última respuesta sigue a la vista sobre el teclado
    nextTick(() => scrollDown())
  }
}
function onBlur() {
  // Tras cerrar el teclado, iOS deja la página desplazada: se devuelve arriba
  setTimeout(() => {
    fitViewport()
    if (!keyboard.value) window.scrollTo({ top: 0, behavior: 'smooth' })
  }, 80)
}
onMounted(() => {
  window.visualViewport?.addEventListener('resize', fitViewport)
  window.visualViewport?.addEventListener('scroll', fitViewport)
  fitViewport()
})
onBeforeUnmount(() => {
  window.visualViewport?.removeEventListener('resize', fitViewport)
  window.visualViewport?.removeEventListener('scroll', fitViewport)
})

// Enlaces internos de las respuestas: navegación sin recargar
function onContentClick(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest('a[data-internal]') as HTMLAnchorElement | null
  if (!a || e.metaKey || e.ctrlKey) return
  e.preventDefault()
  router.push(a.getAttribute('href')!)
}

async function copy(m: Message) {
  const ok = await copyToClipboard(m.content)
  if (ok) toast.success('Respuesta copiada')
  else toast.error('No se pudo copiar al portapapeles')
}

onMounted(() => {
  const c = Number(route.query.c)
  if (c) open(c)
  else if (typeof route.query.q === 'string' && route.query.q.trim()) send(route.query.q)
  // En el móvil no se abre el teclado solo: tapa la pantalla antes de que hayas leído nada
  if (!touch) input.value?.focus()
})
onBeforeUnmount(() => controller?.abort())

const html = (m: Message) => renderMarkdown(m.content)

// ─── Clic derecho: conversaciones y mensajes ───

function convCtx(c: Conversation): CtxSpec {
  return {
    title: c.title,
    subtitle: relTime(c.updatedAt),
    icon: 'ph:chat-circle-text',
    items: [
      { label: 'Abrir', icon: 'ph:chat-circle', onClick: () => open(c.id) },
      { label: 'Copiar enlace', icon: 'ph:link', onClick: () => copyText(`${window.location.origin}/asistente?c=${c.id}`, 'Enlace') },
      { divider: true },
      { label: 'Borrar conversación', icon: 'ph:trash', danger: true, onClick: () => remove(c) },
    ],
  }
}

function messageCtx(m: Message, e: MouseEvent): CtxSpec | null {
  if (m.streaming) return null
  const link = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null
  const i = messages.value.indexOf(m)
  // La pregunta que originó esta respuesta: para repetirla
  const ask = m.role === 'assistant' ? messages.value.slice(0, i).reverse().find(x => x.role === 'user') : m
  const items: CtxItem[] = []
  if (link) {
    const href = link.getAttribute('href')!
    items.push(
      { label: 'Abrir enlace', icon: 'ph:arrow-square-out', onClick: () => (link.dataset.internal ? router.push(href) : window.open(link.href, '_blank', 'noopener')) },
      { label: 'Copiar enlace', icon: 'ph:link', onClick: () => copyText(link.href, 'Enlace') },
      { divider: true },
    )
  }
  if (m.content) items.push({ label: m.role === 'user' ? 'Copiar pregunta' : 'Copiar respuesta', icon: 'ph:copy', onClick: () => copy(m) })
  if (ask && !busy.value && ai.value.configured) {
    items.push(
      { label: m.role === 'user' ? 'Enviar de nuevo' : 'Preguntar de nuevo', icon: 'ph:arrow-clockwise', onClick: () => send(ask.content) },
      { label: 'Editar la pregunta', icon: 'ph:pencil-simple', onClick: () => { draft.value = ask.content; nextTick(() => { autosize(); input.value?.focus() }) } },
    )
  }
  items.push({ divider: true }, { label: 'Nueva conversación', icon: 'ph:plus', onClick: () => open(null) })
  return { items }
}
</script>

<template>
  <div class="ai-page" :class="{ kb: keyboard }" :style="viewH ? { '--view-h': `${viewH}px`, '--view-top': `${viewTop}px` } : undefined">
    <!-- Historial (escritorio) -->
    <aside class="side">
      <UiButton variant="secondary" icon="ph:plus" block @click="open(null)">Nueva conversación</UiButton>
      <p v-if="conversations.length" class="eyebrow side-t">Recientes</p>
      <nav class="convs" aria-label="Conversaciones">
        <div v-for="c in conversations" :key="c.id" v-ctx="() => convCtx(c)" class="conv" :class="{ on: c.id === conversationId }">
          <button type="button" class="conv-b" @click="open(c.id)">
            <span class="conv-t truncate">{{ c.title }}</span>
            <span class="conv-d">{{ relTime(c.updatedAt) }}</span>
          </button>
          <button type="button" class="conv-x" :aria-label="`Borrar ${c.title}`" @click="remove(c)"><Icon name="ph:trash" /></button>
        </div>
      </nav>
    </aside>

    <section class="chat">
      <header class="chat-head">
        <span class="bot" aria-hidden="true"><Icon name="ph:sparkle-fill" /></span>
        <div class="grow min0">
          <h1 class="title"><span class="ai-text">Asistente NUMIQ</span></h1>
          <p class="sub">Tu asesor financiero, con tus cifras reales</p>
        </div>
        <UiButton class="hist-btn" variant="ghost" size="sm" icon="ph:clock-counter-clockwise" compact @click="historyOpen = true">Historial</UiButton>
        <UiButton v-if="messages.length" variant="ghost" size="sm" icon="ph:plus" compact @click="open(null)">Nueva</UiButton>
      </header>

      <div ref="scroller" class="messages" role="log" aria-live="polite" aria-label="Conversación" @scroll.passive="onScroll">
        <div v-if="loadingConv" class="stack gap-3">
          <div class="skeleton" style="height: 44px; width: 60%; margin-left: auto" />
          <div class="skeleton" style="height: 120px; width: 80%" />
        </div>

        <!-- Bienvenida -->
        <div v-else-if="!messages.length" class="welcome">
          <div class="orb" aria-hidden="true"><Icon name="ph:sparkle-fill" /></div>
          <h2 class="w-t">Hola{{ firstName ? `, ${firstName}` : '' }}. ¿En qué te ayudo?</h2>
          <p class="w-s">Pregúntame por tus ventas, gastos, cobros o impuestos: miro tus datos de NUMIQ y te respondo con cifras exactas y consejos prácticos. También hago cambios por ti, como reasignar facturas, clasificar el banco o borrar gastos, siempre con tu confirmación.</p>
          <div v-if="ai.configured" class="sugs">
            <button v-for="s in SUGGESTIONS" :key="s.text" type="button" class="sug" @click="send(s.text)">
              <Icon :name="s.icon" class="sug-ic" aria-hidden="true" />
              <span>{{ s.text }}</span>
            </button>
          </div>
          <p v-else class="no-ai"><Icon name="ph:warning-fill" aria-hidden="true" /> Configura la clave de OpenAI (NUXT_OPENAI_API_KEY) para activar el asistente.</p>
        </div>

        <template v-else>
          <div v-for="m in messages" :key="m.id" class="msg" :class="m.role">
            <span v-if="m.role === 'assistant'" class="avatar-bot" aria-hidden="true"><Icon name="ph:sparkle-fill" /></span>
            <div v-ctx="(e: MouseEvent) => messageCtx(m, e)" class="bubble" :class="{ error: m.error }">
              <p v-if="m.role === 'user'" class="u-text">{{ m.content }}</p>
              <template v-else>
                <p v-if="m.status" class="status"><span class="dots" aria-hidden="true"><i /><i /><i /></span>{{ m.status }}…</p>
                <div v-if="m.content" class="md" :class="{ typing: m.streaming }" @click="onContentClick" v-html="html(m)" />
                <AssistantActionCard v-for="a in m.actions ?? []" :key="a.id" :action="a" @update="upsertAction" />
                <div v-if="!m.streaming && m.content && !m.error" class="meta">
                  <span v-if="m.tools?.length" class="used"><Icon name="ph:database" aria-hidden="true" /> {{ m.tools.map(t => TOOL_NAMES[t] ?? t).join(' · ') }}</span>
                  <button type="button" class="copy" aria-label="Copiar respuesta" @click="copy(m)"><Icon name="ph:copy" /></button>
                </div>
              </template>
            </div>
          </div>
        </template>
      </div>

      <form class="composer" @submit.prevent="send()">
        <div class="box">
          <label for="ask" class="sr-only">Escribe tu pregunta</label>
          <textarea id="ask" ref="input" v-model="draft" rows="1" :placeholder="ai.configured ? 'Pregunta o pide un cambio…' : 'Asistente no disponible'" :disabled="!ai.configured" @keydown="onKey" @blur="onBlur" />
          <UiButton v-if="busy" variant="secondary" square icon="ph:stop-fill" aria-label="Detener" @click="stop" />
          <UiButton v-else type="submit" variant="ai" square icon="ph:paper-plane-right-fill" aria-label="Enviar" :disabled="!draft.trim() || tooLong || !ai.configured" />
        </div>
        <p v-if="draftLength > MAX_ASK * 0.8" class="disclaimer limit" :class="{ over: tooLong }" aria-live="polite">
          {{ draftLength.toLocaleString('es-ES') }} / {{ MAX_ASK.toLocaleString('es-ES') }} caracteres{{ tooLong ? ' · acórtalo para poder enviarlo' : '' }}
        </p>
        <p v-else class="disclaimer"><span class="d-long">Usa tus datos de NUMIQ. Los cambios solo se aplican cuando los confirmas. Los impuestos son estimaciones: confírmalos con tu asesor.</span><span class="d-short">Los cambios solo se aplican cuando los confirmas.</span></p>
      </form>
    </section>

    <UiModal v-model="historyOpen" side size="sm" title="Conversaciones">
      <UiButton variant="secondary" icon="ph:plus" block @click="open(null)">Nueva conversación</UiButton>
      <UiEmpty v-if="!conversations.length" compact icon="ph:chats" title="Aún no hay conversaciones" />
      <nav class="convs m" aria-label="Conversaciones">
        <div v-for="c in conversations" :key="c.id" v-ctx="() => convCtx(c)" class="conv" :class="{ on: c.id === conversationId }">
          <button type="button" class="conv-b" @click="open(c.id)">
            <span class="conv-t truncate">{{ c.title }}</span>
            <span class="conv-d">{{ relTime(c.updatedAt) }}</span>
          </button>
          <button type="button" class="conv-x always" :aria-label="`Borrar ${c.title}`" @click="remove(c)"><Icon name="ph:trash" /></button>
        </div>
      </nav>
    </UiModal>
  </div>
</template>

<style scoped>
.ai-page {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
  gap: var(--s-4);
  height: calc(100dvh - var(--topbar-h));
  max-width: var(--content-max);
  margin: 0 auto;
  padding: var(--s-4) var(--s-7) var(--s-4);
}

.min0 {
  min-width: 0;
}

/* ─── Historial ─── */

.side {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
  min-height: 0;
}

.side-t {
  margin: var(--s-3) var(--s-2) 0;
}

.convs {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  overflow-y: auto;
}

.convs.m {
  margin-top: var(--s-3);
}

.conv {
  position: relative;
  display: flex;
  align-items: center;
  border-radius: var(--r-md);
  transition: background var(--t-fast);
}

.conv:hover {
  background: var(--surface-hover);
}

.conv.on {
  background: var(--surface-active);
}

.conv-b {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  text-align: left;
}

.conv-t {
  font-size: var(--text-sm);
  font-weight: 540;
}

.conv-d {
  font-size: var(--text-2xs);
  color: var(--text-3);
}

.conv-x {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  margin-right: 4px;
  color: var(--text-3);
  border-radius: var(--r-sm);
  opacity: 0;
  transition: opacity var(--t-fast), background var(--t-fast), color var(--t-fast);
}

.conv:hover .conv-x,
.conv-x:focus-visible,
.conv-x.always {
  opacity: 1;
}

.conv-x:hover {
  color: var(--danger);
  background: var(--danger-soft);
}

/* ─── Chat ─── */

.chat {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-xs);
}

.chat-head {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-4) var(--s-5);
  border-bottom: 1px solid var(--border-subtle);
}

.bot,
.avatar-bot {
  display: grid;
  place-items: center;
  flex: none;
  color: #fff;
  background: var(--ai-grad);
}

.bot {
  width: 38px;
  height: 38px;
  font-size: 18px;
  border-radius: var(--r-lg);
  box-shadow: 0 6px 16px -6px rgb(79 70 229 / 0.55);
}

.title {
  font-size: var(--text-lg);
  font-weight: 680;
}

.sub {
  font-size: var(--text-sm);
  color: var(--text-3);
}

.hist-btn {
  display: none;
}

.messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--s-6) var(--s-6) var(--s-4);
  scroll-behavior: smooth;
}

.welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 680px;
  margin: var(--s-6) auto 0;
  text-align: center;
}

.orb {
  display: grid;
  place-items: center;
  width: 60px;
  height: 60px;
  margin-bottom: var(--s-4);
  font-size: 28px;
  color: #fff;
  background: var(--ai-grad);
  border-radius: var(--r-full);
  box-shadow: 0 0 0 10px rgb(124 58 237 / 0.07), 0 14px 30px -12px rgb(79 70 229 / 0.6);
}

.w-t {
  font-size: var(--text-2xl);
  font-weight: 680;
  letter-spacing: -0.02em;
}

.w-s {
  max-width: 520px;
  margin-top: var(--s-2);
  color: var(--text-3);
}

.sugs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s-2);
  width: 100%;
  margin-top: var(--s-6);
}

.sug {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: 12px 14px;
  font-size: var(--text-sm);
  text-align: left;
  color: var(--text-2);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  transition: border-color var(--t-fast), background var(--t-fast), transform var(--t-fast) var(--ease-out);
}

.sug:hover {
  color: var(--text);
  border-color: color-mix(in srgb, var(--ai-2) 40%, var(--border));
  background: var(--surface-hover);
  transform: translateY(-1px);
}

.sug-ic {
  flex: none;
  font-size: 18px;
  color: var(--ai-1);
}

.no-ai {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--s-5);
  color: var(--warning);
}

.msg {
  display: flex;
  gap: var(--s-3);
  max-width: 820px;
  margin: 0 auto var(--s-5);
}

.msg.user {
  justify-content: flex-end;
}

.avatar-bot {
  width: 30px;
  height: 30px;
  margin-top: 2px;
  font-size: 15px;
  border-radius: var(--r-full);
}

.bubble {
  min-width: 0;
  max-width: 100%;
}

.user .bubble {
  max-width: 78%;
  padding: 10px 14px;
  color: var(--text);
  background: var(--brand-soft);
  border-radius: var(--r-lg) var(--r-lg) 4px var(--r-lg);
}

.u-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.msg.assistant .bubble {
  flex: 1;
}

.bubble.error .md {
  color: var(--danger);
}

.status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0 8px;
  font-size: var(--text-sm);
  color: var(--ai-text);
  font-weight: 540;
}

.dots {
  display: inline-flex;
  gap: 3px;
}

.dots i {
  width: 5px;
  height: 5px;
  background: currentColor;
  border-radius: 50%;
  animation: dot 1.1s var(--ease-out) infinite;
}

.dots i:nth-child(2) { animation-delay: 0.15s; }
.dots i:nth-child(3) { animation-delay: 0.3s; }

@keyframes dot {
  0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-2px); }
}

/* Contenido Markdown de la respuesta */
.md {
  line-height: 1.6;
  color: var(--text);
  overflow-wrap: anywhere;
}

.md :deep(p) {
  margin: 0 0 10px;
}

.md :deep(.md-h) {
  margin: 14px 0 6px;
  font-weight: 650;
}

.md :deep(ul),
.md :deep(ol) {
  margin: 0 0 10px;
  padding-left: 22px;
}

.md :deep(li) {
  margin: 3px 0;
}

.md :deep(strong) {
  font-weight: 640;
}

.md :deep(a) {
  color: var(--brand-text);
  font-weight: 560;
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--brand) 35%, transparent);
  text-underline-offset: 3px;
}

.md :deep(code) {
  padding: 1px 5px;
  font-family: var(--font-mono);
  font-size: 0.9em;
  background: var(--surface-sunken);
  border-radius: var(--r-xs);
}

.md :deep(pre) {
  margin: 0 0 10px;
  padding: 10px 12px;
  overflow-x: auto;
  background: var(--surface-sunken);
  border-radius: var(--r-md);
}

.md :deep(.md-table) {
  margin: 4px 0 12px;
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
}

.md :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}

.md :deep(th) {
  padding: 8px 12px;
  text-align: left;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-3);
  white-space: nowrap;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
}

.md :deep(td) {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.md :deep(tr:last-child td) {
  border-bottom: 0;
}

.md :deep(.r) {
  text-align: right;
  white-space: nowrap;
}

.md :deep(.c) {
  text-align: center;
}

.md.typing > :deep(*:last-child)::after {
  content: '';
  display: inline-block;
  width: 7px;
  height: 1em;
  margin-left: 2px;
  vertical-align: -2px;
  background: var(--ai-2);
  border-radius: 2px;
  animation: blink 1s steps(2) infinite;
}

@keyframes blink {
  50% { opacity: 0; }
}

.meta {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  margin-top: 2px;
}

.used {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.copy {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  color: var(--text-3);
  border-radius: var(--r-sm);
  transition: background var(--t-fast), color var(--t-fast);
}

.copy:hover {
  color: var(--text);
  background: var(--surface-hover);
}

.composer {
  padding: var(--s-3) var(--s-5) var(--s-4);
  border-top: 1px solid var(--border-subtle);
}

.box {
  display: flex;
  align-items: flex-end;
  gap: var(--s-2);
  max-width: 820px;
  margin: 0 auto;
  padding: 6px 6px 6px 14px;
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-xl);
  transition: border-color var(--t-fast), box-shadow var(--t-fast);
}

.box:focus-within {
  border-color: var(--ai-2);
  box-shadow: 0 0 0 3px rgb(79 70 229 / 0.16);
}

textarea {
  flex: 1;
  min-height: 38px;
  max-height: 200px;
  padding: 8px 0;
  resize: none;
  line-height: 1.5;
  background: transparent;
  border: 0;
  outline: none;
}

.d-short {
  display: none;
}

.disclaimer {
  max-width: 820px;
  margin: 8px auto 0;
  font-size: var(--text-2xs);
  text-align: center;
  color: var(--text-4);
}

.limit {
  font-variant-numeric: tabular-nums;
}

.limit.over {
  font-weight: 600;
  color: var(--danger);
}

/* Hasta 1279 px la barra lateral de la app deja poco sitio: el historial pasa al botón «Historial» y el chat ocupa todo */
@media (max-width: 1279px) {
  .ai-page {
    grid-template-columns: minmax(0, 1fr);
  }

  .side {
    display: none;
  }

  .hist-btn {
    display: inline-flex;
  }
}

@media (max-width: 1023px) {
  .ai-page {
    padding: var(--s-3) var(--s-4);
  }
}

/* Con barra inferior (móvil y tablet estrecha): lo visible menos la barra de arriba y la de abajo;
   con el teclado abierto, fijado a la zona visible (la barra de abajo queda bajo el teclado y la de arriba,
   desplazada por el navegador, se tapa) */
@media (max-width: 767px) {
  .ai-page {
    height: calc(var(--view-h, 100dvh) - var(--topbar-h) - var(--bnav) - var(--safe-b));
  }

  .ai-page.kb {
    position: fixed;
    top: var(--view-top, 0px);
    left: 0;
    right: 0;
    z-index: calc(var(--z-sticky) + 1);
    height: var(--view-h, 100dvh);
    background: var(--bg);
  }
}

@media (max-width: 640px) {
  .ai-page {
    padding: 0;
  }

  .chat {
    border-radius: 0;
    border-width: 0;
  }

  .messages {
    padding: var(--s-4) var(--s-3);
  }

  .sugs {
    grid-template-columns: minmax(0, 1fr);
  }

  .user .bubble {
    max-width: 88%;
  }

  .avatar-bot {
    display: none;
  }

  .composer {
    padding: var(--s-2) var(--s-3) var(--s-2);
  }

  .disclaimer {
    margin-top: 4px;
  }

  .d-long {
    display: none;
  }

  .d-short {
    display: inline;
  }

  .kb .disclaimer {
    display: none;
  }

  .w-t {
    font-size: var(--text-xl);
  }

  .chat-head {
    padding: var(--s-3) var(--s-3) var(--s-3) var(--s-4);
  }

  .sub {
    display: none;
  }
}
</style>
