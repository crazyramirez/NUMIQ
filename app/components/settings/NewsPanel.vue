<script setup lang="ts">
import type { CtxSpec } from '~/composables/useContextMenu'

/**
 * Novedades de NUMIQ: lo que se ha añadido, mejorado o corregido, por días y con un enlace para probarlo.
 * Lo publicado desde la última visita se resalta en esta visita y deja de contar como «sin ver».
 */
const version = useRuntimeConfig().public.appVersion
const { seenAt, ready, markSeen } = useNews()

// Lo que era nuevo al entrar se sigue resaltando aunque ya cuente como visto
const seenBefore = ref<string | null | undefined>(undefined)
watch(ready, (r) => {
  if (!r || seenBefore.value !== undefined) return
  seenBefore.value = seenAt.value
  setTimeout(markSeen, 1200)
}, { immediate: true })
const isFresh = (e: ChangeEntry) => seenBefore.value !== undefined && (!seenBefore.value || e.at > seenBefore.value)
const freshCount = computed(() => CHANGELOG.filter(isFresh).length)

type Filter = 'all' | ChangeKind
const filter = ref<Filter>('all')
const query = ref('')
const counts = computed(() => ({
  all: CHANGELOG.length,
  new: CHANGELOG.filter(e => e.kind === 'new').length,
  improved: CHANGELOG.filter(e => e.kind === 'improved').length,
  fixed: CHANGELOG.filter(e => e.kind === 'fixed').length,
}))
const FILTERS: Array<{ id: Filter, label: string, icon: string }> = [
  { id: 'all', label: 'Todo', icon: 'ph:list-bullets' },
  { id: 'new', label: 'Nuevo', icon: CHANGE_KINDS.new.icon },
  { id: 'improved', label: 'Mejoras', icon: CHANGE_KINDS.improved.icon },
  { id: 'fixed', label: 'Corregido', icon: CHANGE_KINDS.fixed.icon },
]

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const shown = computed(() => {
  const q = norm(query.value.trim())
  return CHANGELOG
    .filter(e => filter.value === 'all' || e.kind === filter.value)
    .filter(e => !q || norm(`${e.title} ${e.body} ${e.area}`).includes(q))
    .slice()
    .sort((a, b) => b.at.localeCompare(a.at))
})

// Por días: «Hoy», «Ayer» o la fecha
const days = computed(() => {
  const groups: Array<{ day: string, items: ChangeEntry[] }> = []
  for (const e of shown.value) {
    const day = e.at.slice(0, 10)
    const g = groups.at(-1)
    if (g?.day === day) g.items.push(e)
    else groups.push({ day, items: [e] })
  }
  return groups
})
const today = todayISO()
const yesterday = addDaysISO(today, -1)
function dayLabel(day: string) {
  const long = new Date(`${day}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
  if (day === today) return { main: 'Hoy', sub: long }
  if (day === yesterday) return { main: 'Ayer', sub: long }
  return { main: long.charAt(0).toUpperCase() + long.slice(1), sub: new Date(`${day}T12:00:00`).getFullYear().toString() }
}

function menu(e: ChangeEntry): CtxSpec {
  return {
    title: e.title,
    subtitle: `${CHANGE_KINDS[e.kind].label} · ${e.area}`,
    icon: e.icon,
    items: [
      ...(e.to ? [{ label: 'Probarlo', icon: 'ph:arrow-right', to: e.to }] : []),
      { label: `Ver solo ${CHANGE_KINDS[e.kind].plural.toLowerCase()}`, icon: CHANGE_KINDS[e.kind].icon, onClick: () => (filter.value = e.kind) },
      { label: 'Copiar', icon: 'ph:copy', onClick: () => copyText(`${e.title}\n${e.body}`, 'Novedad') },
    ],
  }
}
</script>

<template>
  <div class="news">
    <!-- Cabecera -->
    <section class="hero card">
      <div class="hero-glow" aria-hidden="true" />
      <div class="hero-main">
        <span class="hero-ic" aria-hidden="true"><Icon name="ph:rocket-launch-fill" /></span>
        <div class="min0">
          <h2 class="hero-t">Novedades de NUMIQ</h2>
          <p class="hero-s">
            Lo último que hemos añadido, mejorado y corregido.
            <template v-if="freshCount">
              <strong class="fresh-n">{{ freshCount }} {{ freshCount === 1 ? 'novedad' : 'novedades' }} desde tu última visita.</strong>
            </template>
          </p>
        </div>
        <span v-if="version" class="ver num" title="Versión instalada">v{{ version }}</span>
      </div>
      <div class="stats">
        <button v-for="k in (['new', 'improved', 'fixed'] as const)" :key="k" type="button" class="stat" :class="[k, { on: filter === k }]" @click="filter = filter === k ? 'all' : k">
          <span class="stat-ic" aria-hidden="true"><Icon :name="CHANGE_KINDS[k].icon" /></span>
          <span class="stat-n num">{{ counts[k] }}</span>
          <span class="stat-l">{{ CHANGE_KINDS[k].plural }}</span>
        </button>
      </div>
    </section>

    <!-- Filtros -->
    <div class="tools">
      <div class="chips" role="radiogroup" aria-label="Tipo de cambio">
        <button
          v-for="f in FILTERS"
          :key="f.id"
          type="button"
          role="radio"
          class="chip"
          :class="[f.id, { on: filter === f.id }]"
          :aria-checked="filter === f.id"
          @click="filter = f.id"
        >
          <Icon :name="f.icon" aria-hidden="true" />
          {{ f.label }}
          <span class="chip-n num">{{ counts[f.id] }}</span>
        </button>
      </div>
      <UiInput v-model="query" class="search" icon="ph:magnifying-glass" placeholder="Buscar: firma, banco, móvil…" aria-label="Buscar en las novedades" />
    </div>

    <!-- Línea de tiempo -->
    <div v-if="days.length" class="timeline">
      <section v-for="(g, gi) in days" :key="g.day" class="day" :style="{ '--d': gi }">
        <header class="day-head">
          <span class="day-main">{{ dayLabel(g.day).main }}</span>
          <span class="day-sub">{{ dayLabel(g.day).sub }}</span>
          <span class="day-n num">{{ g.items.length }} {{ g.items.length === 1 ? 'cambio' : 'cambios' }}</span>
        </header>
        <ol class="items">
          <li v-for="e in g.items" :key="e.at + e.title" v-ctx="() => menu(e)" class="item" :class="[e.kind, { fresh: isFresh(e) }]">
            <span class="node" aria-hidden="true"><Icon :name="e.icon" /></span>
            <article class="body">
              <div class="meta">
                <span class="kind"><Icon :name="CHANGE_KINDS[e.kind].icon" aria-hidden="true" /> {{ CHANGE_KINDS[e.kind].label }}</span>
                <span class="area">{{ e.area }}</span>
                <span v-if="isFresh(e)" class="new-dot">Sin ver</span>
                <time class="time num" :datetime="e.at">{{ e.at.slice(11, 16) }}</time>
              </div>
              <h3 class="title">{{ e.title }}</h3>
              <p class="text">{{ e.body }}</p>
              <NuxtLink v-if="e.to" :to="e.to" class="try">Probarlo <Icon name="ph:arrow-right-bold" aria-hidden="true" /></NuxtLink>
            </article>
          </li>
        </ol>
      </section>
    </div>
    <UiCard v-else>
      <UiEmpty icon="ph:magnifying-glass" title="Nada con ese filtro" text="Prueba con otra palabra o vuelve a «Todo».">
        <UiButton icon="ph:arrow-counter-clockwise" @click="query = ''; filter = 'all'">Ver todo</UiButton>
      </UiEmpty>
    </UiCard>
  </div>
</template>

<style scoped>
.news {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
  --c-new: var(--brand);
  --c-improved: #16a34a;
  --c-fixed: #d97706;
}

.min0 {
  min-width: 0;
}

/* ─── Cabecera ─── */
.hero {
  position: relative;
  overflow: hidden;
  padding: var(--s-6);
}

.hero-glow {
  position: absolute;
  inset: -40% -10% auto auto;
  width: 420px;
  height: 320px;
  background:
    radial-gradient(closest-side, color-mix(in srgb, var(--brand) 22%, transparent), transparent),
    radial-gradient(closest-side at 70% 60%, color-mix(in srgb, #ec4899 14%, transparent), transparent);
  filter: blur(10px);
  pointer-events: none;
}

.hero-main {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.hero-ic {
  display: grid;
  flex: none;
  place-items: center;
  width: 48px;
  height: 48px;
  font-size: 24px;
  color: #fff;
  background: linear-gradient(135deg, color-mix(in srgb, var(--brand) 85%, white), var(--brand) 55%, color-mix(in srgb, var(--brand) 70%, #ec4899));
  border-radius: 14px;
  box-shadow: 0 10px 24px -10px color-mix(in srgb, var(--brand) 80%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.25);
}

.hero-t {
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.015em;
}

.hero-s {
  margin-top: 3px;
  font-size: var(--text-sm);
  color: var(--text-2);
}

.fresh-n {
  display: block;
  margin-top: 2px;
  font-weight: 650;
  color: var(--brand-text);
}

.ver {
  flex: none;
  margin-left: auto;
  padding: 3px 9px;
  font-size: 11.5px;
  font-weight: 650;
  color: var(--text-2);
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
}

.stats {
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--s-3);
  margin-top: var(--s-5);
}

.stat {
  --c: var(--c-new);

  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  align-items: center;
  column-gap: 10px;
  padding: 12px 14px;
  text-align: left;
  background: color-mix(in srgb, var(--c) 6%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--c) 18%, var(--border));
  border-radius: var(--r-lg);
  cursor: pointer;
  transition: transform var(--t-fast), box-shadow var(--t-fast), border-color var(--t-fast);
}

.stat.improved { --c: var(--c-improved); }
.stat.fixed { --c: var(--c-fixed); }

.stat:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}

.stat.on {
  border-color: var(--c);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 18%, transparent);
}

.stat-ic {
  display: grid;
  grid-row: span 2;
  place-items: center;
  width: 36px;
  height: 36px;
  font-size: 17px;
  color: var(--c);
  background: color-mix(in srgb, var(--c) 14%, transparent);
  border-radius: 10px;
}

.stat-n {
  font-size: 20px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--text);
}

.stat-l {
  font-size: var(--text-xs);
  font-weight: 560;
  color: var(--text-3);
}

/* ─── Filtros ─── */
.tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  --c: var(--text-2);

  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-2);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast), border-color var(--t-fast);
}

.chip.new { --c: var(--c-new); }
.chip.improved { --c: var(--c-improved); }
.chip.fixed { --c: var(--c-fixed); }

.chip :deep(svg) {
  font-size: 14px;
  color: var(--c);
}

.chip:hover {
  background: var(--surface-hover);
}

.chip.on {
  color: var(--text);
  background: color-mix(in srgb, var(--c) 10%, var(--surface));
  border-color: color-mix(in srgb, var(--c) 45%, var(--border));
}

.chip-n {
  min-width: 20px;
  padding: 0 6px;
  font-size: 11px;
  line-height: 18px;
  color: var(--text-3);
  text-align: center;
  background: var(--surface-sunken);
  border-radius: 999px;
}

.search {
  flex: 1 1 220px;
  max-width: 300px;
}

/* ─── Línea de tiempo ─── */
.timeline {
  display: flex;
  flex-direction: column;
  gap: var(--s-6);
}

.day {
  animation: news-in 360ms var(--ease-out) both;
  animation-delay: calc(var(--d) * 60ms);
}

@keyframes news-in {
  from { opacity: 0; transform: translateY(6px); }
}

.day-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: var(--s-3);
  padding-left: 4px;
}

.day-main {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.day-sub {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.day-n {
  margin-left: auto;
  font-size: var(--text-xs);
  font-weight: 560;
  color: var(--text-3);
}

.items {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* Raíl vertical que une los nodos */
.items::before {
  position: absolute;
  top: 18px;
  bottom: 18px;
  left: 19px;
  width: 2px;
  content: '';
  background: linear-gradient(to bottom, var(--border), color-mix(in srgb, var(--border) 30%, transparent));
  border-radius: 2px;
}

.item {
  --c: var(--c-new);

  position: relative;
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 12px;
}

.item.improved { --c: var(--c-improved); }
.item.fixed { --c: var(--c-fixed); }

.node {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  margin-top: 6px;
  font-size: 18px;
  color: var(--c);
  background: color-mix(in srgb, var(--c) 12%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--c) 25%, var(--border));
  border-radius: 12px;
  box-shadow: 0 0 0 4px var(--bg, var(--surface-sunken));
}

.body {
  min-width: 0;
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  transition: border-color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast);
}

.item:hover .body {
  border-color: color-mix(in srgb, var(--c) 35%, var(--border));
  box-shadow: var(--shadow-sm);
}

.item.fresh .body {
  border-color: color-mix(in srgb, var(--c) 40%, var(--border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 10%, transparent);
}

.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
}

.kind {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: var(--c);
  background: color-mix(in srgb, var(--c) 12%, transparent);
  border-radius: 999px;
}

.kind :deep(svg) {
  font-size: 11px;
}

.area {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-3);
}

.new-dot {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 650;
  color: var(--brand-text);
}

.new-dot::before {
  width: 6px;
  height: 6px;
  content: '';
  background: var(--brand);
  border-radius: 50%;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 22%, transparent);
  animation: news-pulse 1.8s ease-in-out infinite;
}

@keyframes news-pulse {
  50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--brand) 8%, transparent); }
}

.time {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-3);
}

.title {
  margin-top: 6px;
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--text);
}

.text {
  margin-top: 4px;
  font-size: var(--text-sm);
  line-height: 1.55;
  color: var(--text-2);
}

.try {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  font-size: 13px;
  font-weight: 650;
  color: var(--brand-text);
  text-decoration: none;
}

.try :deep(svg) {
  font-size: 12px;
  transition: transform var(--t-fast);
}

.try:hover :deep(svg) {
  transform: translateX(3px);
}

@container settings (max-width: 620px) {
  .hero {
    padding: var(--s-5);
  }

  .stats {
    gap: 8px;
  }

  .stat {
    grid-template-columns: minmax(0, 1fr);
    padding: 10px 12px;
  }

  .stat-ic {
    display: none;
  }

  .stat-n {
    font-size: 18px;
  }

  .search {
    max-width: none;
  }

  .items::before {
    left: 15px;
  }

  .item {
    grid-template-columns: 32px minmax(0, 1fr);
    gap: 10px;
  }

  .node {
    width: 32px;
    height: 32px;
    font-size: 15px;
    border-radius: 10px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .day,
  .new-dot::before {
    animation: none;
  }
}
</style>
