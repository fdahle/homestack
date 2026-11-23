<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

// Notes in columns like Google Keep's: each card goes into the column that's shortest so far,
// so the order still reads left to right, newest first, and no column runs far ahead.
// The cards are measured (ResizeObserver) and placed absolutely; the page keeps their order
// for the keyboard and screen readers. Slot: { item }.
// items: [{ id, … }]; minWidth: the narrowest a column may get (at least two columns); gap in px.
const props = defineProps({
  items: { type: Array, required: true },
  minWidth: { type: Number, default: 230 },
  gap: { type: Number, default: 12 },
});

const box = ref(null);
const width = ref(0);
const heights = reactive(new Map());
// Moving cards slide into place, but not on the first layout
const settled = ref(false);

const cols = computed(() => Math.max(2, Math.floor((width.value + props.gap) / (props.minWidth + props.gap))));
const colWidth = computed(() => Math.max(0, (width.value - props.gap * (cols.value - 1)) / cols.value));

const layout = computed(() => {
  const tops = new Array(cols.value).fill(0);
  const at = new Map();
  for (const item of props.items) {
    const col = tops.indexOf(Math.min(...tops));
    at.set(item.id, { x: col * (colWidth.value + props.gap), y: tops[col] });
    tops[col] += (heights.get(item.id) ?? 0) + props.gap;
  }
  return { at, height: Math.max(0, Math.max(...tops) - props.gap) };
});

const style = (item) => {
  const { x, y } = layout.value.at.get(item.id) || { x: 0, y: 0 };
  return { width: `${colWidth.value}px`, transform: `translate(${x}px, ${y}px)` };
};

// Sizes arrive before the browser paints, so nothing is seen in the wrong place
const cards = new ResizeObserver((entries) => {
  for (const e of entries) heights.set(e.target.dataset.id, e.borderBoxSize?.[0]?.blockSize ?? e.target.offsetHeight);
});
const frame = new ResizeObserver(([e]) => (width.value = e.contentRect.width));
// Vue hands the ref null and then the element on every render; only a new element counts
const watched = new Map();
function track(el, id) {
  if (!el || watched.get(id) === el) return;
  if (watched.has(id)) cards.unobserve(watched.get(id));
  watched.set(id, el);
  cards.observe(el);
}
// Cards that left the list (search, label, archived) are forgotten
watch(() => props.items.map((i) => i.id), (ids) => {
  const keep = new Set(ids);
  for (const [id, el] of watched) {
    if (keep.has(id)) continue;
    cards.unobserve(el);
    watched.delete(id);
    heights.delete(id);
  }
});

onMounted(() => {
  width.value = box.value.clientWidth;
  frame.observe(box.value);
  setTimeout(() => (settled.value = true), 300);
});
onBeforeUnmount(() => {
  frame.disconnect();
  cards.disconnect();
});
</script>

<template>
  <div ref="box" class="masonry" :class="{ settled }" :style="{ height: `${layout.height}px` }">
    <div v-for="item in items" :key="item.id" :ref="(el) => track(el, item.id)" :data-id="item.id" class="masonry-item" :style="style(item)">
      <slot :item="item" />
    </div>
  </div>
</template>
