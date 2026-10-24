<script setup lang="ts">
/** Gestión de las categorías del catálogo: crear, renombrar, cambiar el color y borrar */
export interface ItemCategory {
  id: number
  name: string
  color: string | null
  items: number
}

const open = defineModel<boolean>({ default: false })
const emit = defineEmits<{ changed: [] }>()

const toast = useToast()
const { confirm } = useConfirm()

const list = ref<ItemCategory[]>([])
const loading = ref(false)
const newName = ref('')
const adding = ref(false)
const addError = ref<string | null>(null)
/** Fila con la paleta de colores abierta */
const palette = ref<number | null>(null)

async function load() {
  list.value = await $fetch<ItemCategory[]>('/api/item-categories')
}

watch(open, async (v) => {
  if (!v) return
  newName.value = ''
  addError.value = null
  palette.value = null
  loading.value = true
  try {
    await load()
  }
  catch (err) {
    toast.error('No se pudieron cargar las categorías', errorMessage(err))
  }
  finally {
    loading.value = false
  }
}, { immediate: true })

async function add() {
  const name = newName.value.trim()
  addError.value = null
  if (!name) return
  adding.value = true
  try {
    await $fetch('/api/item-categories', { method: 'POST', body: { name } })
    newName.value = ''
    await load()
    emit('changed')
  }
  catch (err) {
    addError.value = errorMessage(err)
  }
  finally {
    adding.value = false
  }
}

async function rename(c: ItemCategory, e: Event) {
  const input = e.target as HTMLInputElement
  const name = input.value.trim()
  if (name === c.name) return
  if (!name) {
    input.value = c.name
    return
  }
  try {
    await $fetch(`/api/item-categories/${c.id}`, { method: 'PATCH', body: { name } })
    c.name = name
    emit('changed')
  }
  catch (err) {
    input.value = c.name
    toast.error('No se pudo renombrar', errorMessage(err))
  }
}

async function recolor(c: ItemCategory, color: string) {
  const prev = c.color
  c.color = color
  palette.value = null
  try {
    await $fetch(`/api/item-categories/${c.id}`, { method: 'PATCH', body: { color } })
    emit('changed')
  }
  catch (err) {
    c.color = prev
    toast.error('No se pudo cambiar el color', errorMessage(err))
  }
}

async function remove(c: ItemCategory) {
  const ok = await confirm({
    title: `¿Borrar la categoría «${c.name}»?`,
    body: c.items
      ? `Sus ${c.items === 1 ? 'producto o servicio se queda' : `${c.items} productos y servicios se quedan`} en el catálogo, sin categoría.`
      : 'No tiene productos ni servicios.',
    confirmLabel: 'Borrar categoría',
    danger: true,
  })
  if (!ok) return
  try {
    await $fetch(`/api/item-categories/${c.id}`, { method: 'DELETE' })
    list.value = list.value.filter(x => x.id !== c.id)
    toast.success('Categoría borrada', c.name)
    emit('changed')
  }
  catch (err) {
    toast.error('No se pudo borrar', errorMessage(err))
  }
}

function blurOnEnter(e: KeyboardEvent) {
  (e.target as HTMLInputElement).blur()
}
</script>

<template>
  <UiModal v-model="open" title="Categorías del catálogo" subtitle="Agrupa tus productos y servicios para encontrarlos antes." size="sm">
    <div v-if="loading && !list.length" class="cats">
      <div v-for="i in 3" :key="i" class="skeleton" style="height: 38px" />
    </div>

    <ul v-else-if="list.length" class="cats">
      <li v-for="c in list" :key="c.id" class="cat">
        <div class="cat-row">
          <button
            type="button"
            class="swatch"
            :style="{ '--c': c.color ?? 'var(--text-4)' }"
            :aria-label="`Color de ${c.name}`"
            :aria-expanded="palette === c.id"
            @click="palette = palette === c.id ? null : c.id"
          />
          <span class="clearable name">
            <input
              :value="c.name"
              class="control"
              maxlength="80"
              :aria-label="`Nombre de la categoría ${c.name}`"
              @blur="rename(c, $event)"
              @keydown.enter.prevent="blurOnEnter"
            >
            <UiClear />
          </span>
          <span class="count num">{{ c.items }}</span>
          <UiButton variant="ghost" size="sm" square icon="ph:trash" class="del" :aria-label="`Borrar ${c.name}`" @click="remove(c)" />
        </div>
        <div v-if="palette === c.id" class="palette" role="group" :aria-label="`Colores para ${c.name}`">
          <button
            v-for="color in ITEM_CATEGORY_COLORS"
            :key="color"
            type="button"
            class="swatch"
            :class="{ on: color === c.color }"
            :style="{ '--c': color }"
            :aria-label="color"
            :aria-pressed="color === c.color"
            @click="recolor(c, color)"
          />
        </div>
      </li>
    </ul>

    <p v-else class="empty">
      <Icon name="ph:folders" aria-hidden="true" />
      <span>Crea categorías como «Diseño», «Formación» o «Hardware». Luego asígnalas al editar un producto o a varios a la vez desde la lista.</span>
    </p>

    <form class="add" novalidate @submit.prevent="add">
      <UiInput v-model="newName" icon="ph:plus" placeholder="Nueva categoría" aria-label="Nombre de la nueva categoría" maxlength="80" :error="addError" autocomplete="off" class="grow" />
      <UiButton type="submit" variant="primary" :loading="adding" :disabled="!newName.trim()">Añadir</UiButton>
    </form>

    <template #footer>
      <UiButton @click="open = false">Listo</UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.cats {
  display: flex;
  flex-direction: column;
  gap: 6px;
  list-style: none;
  padding: 0;
}

.cat-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.name {
  flex: 1;
  min-width: 0;
  font-weight: 560;
}

.count {
  min-width: 28px;
  font-size: var(--text-xs);
  font-weight: 600;
  text-align: right;
  color: var(--text-3);
}

.del {
  color: var(--text-3);
}

.del:hover {
  color: var(--danger-solid);
  background: var(--danger-soft);
}

.swatch {
  flex: none;
  width: 22px;
  height: 22px;
  background: var(--c);
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.12);
  transition: transform var(--t-fast), box-shadow var(--t-fast);
}

.swatch:hover {
  transform: scale(1.1);
}

.swatch:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.swatch.on {
  box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--c);
}

.palette {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 8px 0 6px 32px;
  padding: 10px 12px;
  background: var(--surface-2);
  border-radius: var(--r-md);
}

.empty {
  display: flex;
  gap: 10px;
  padding: var(--s-4);
  font-size: var(--text-sm);
  color: var(--text-3);
  background: var(--surface-2);
  border-radius: var(--r-lg);
}

.empty :deep(svg) {
  flex: none;
  width: 20px;
  height: 20px;
  margin-top: 1px;
  color: var(--brand-text);
}

.add {
  display: flex;
  align-items: flex-start;
  gap: var(--s-2);
  margin-top: var(--s-4);
  padding-top: var(--s-4);
  border-top: 1px solid var(--border-subtle);
}
</style>
