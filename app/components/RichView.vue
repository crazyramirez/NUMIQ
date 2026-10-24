<script setup lang="ts">
/** Muestra un texto con formato (RichDoc) con elementos de Vue: sin HTML, sin riesgo de inyección */
defineProps<{ doc: RichDoc | null | undefined }>()
</script>

<template>
  <div v-if="doc?.length" class="rich">
    <template v-for="(b, n) in doc" :key="n">
      <h3 v-if="b.k === 'h'"><span v-for="(s, j) in b.c" :key="j" :class="{ b: s.b, i: s.i, u: s.u }">{{ s.t }}</span></h3>
      <p v-else-if="b.k === 'p'"><span v-for="(s, j) in b.c" :key="j" :class="{ b: s.b, i: s.i, u: s.u }">{{ s.t }}</span><br v-if="!b.c.length"></p>
      <component :is="b.k" v-else>
        <li v-for="(it, j) in b.items" :key="j"><span v-for="(s, x) in it" :key="x" :class="{ b: s.b, i: s.i, u: s.u }">{{ s.t }}</span></li>
      </component>
    </template>
  </div>
</template>
