<template>
  <div class="cp-panel" @click.stop>
    <!-- No color -->
    <button
      class="cp-swatch cp-swatch--none"
      :class="{ 'cp-swatch--active': !modelValue }"
      title="No color"
      @click="pick(null)"
    >
      <AppIcon v-if="!modelValue" name="check" :size="12" class="cp-check" />
    </button>

    <!-- Preset swatches -->
    <button
      v-for="c in PRESETS"
      :key="c.value"
      class="cp-swatch"
      :class="{ 'cp-swatch--active': modelValue === c.value }"
      :style="{ background: c.value }"
      :title="c.name"
      @click="pick(c.value)"
    >
      <AppIcon v-if="modelValue === c.value" name="check" :size="12" class="cp-check" />
    </button>

    <!-- Color wheel (custom) -->
    <label
      class="cp-swatch cp-swatch--wheel"
      :class="{ 'cp-swatch--active': isCustom }"
      :style="isCustom ? { background: modelValue } : {}"
      title="Custom color"
    >
      <AppIcon v-if="isCustom" name="check" :size="12" class="cp-check" />
      <input
        type="color"
        class="cp-input"
        :value="modelValue || '#ffffff'"
        @change="pick($event.target.value)"
      />
    </label>
  </div>
</template>

<script>
const PRESETS = [
  { name: 'Tomato',   value: '#f28b82' },
  { name: 'Banana',   value: '#fff475' },
  { name: 'Sage',     value: '#ccff90' },
  { name: 'Peacock',  value: '#aecbfa' },
  { name: 'Lavender', value: '#d7aefb' },
]

export default {
  name: 'ColorPicker',

  props: {
    modelValue: { type: String, default: null },
  },

  emits: ['update:modelValue'],

  data() {
    return { PRESETS }
  },

  computed: {
    isCustom() {
      return !!this.modelValue && !PRESETS.some(p => p.value === this.modelValue)
    },
  },

  methods: {
    pick(color) {
      this.$emit('update:modelValue', color)
    },
  },
}
</script>

<style scoped>
.cp-panel {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 300;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0,0,0,.14);
  white-space: nowrap;
}

.cp-swatch {
  position: relative;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.1s;
  outline: none;
}
.cp-swatch:hover { transform: scale(1.18); }
.cp-swatch--active { border-color: var(--text-1); }

.cp-swatch--none {
  background: var(--surface);
  border: 2px dashed var(--border-2);
}
.cp-swatch--none.cp-swatch--active { border-color: var(--accent); border-style: solid; }
.cp-swatch .cp-check { color: var(--text-1); }
.cp-swatch--none .cp-check { color: var(--accent); }

.cp-swatch--wheel {
  background: conic-gradient(
    hsl(0,   85%, 65%),
    hsl(45,  85%, 62%),
    hsl(90,  75%, 60%),
    hsl(135, 75%, 58%),
    hsl(180, 75%, 55%),
    hsl(225, 85%, 65%),
    hsl(270, 80%, 68%),
    hsl(315, 80%, 65%),
    hsl(360, 85%, 65%)
  );
  cursor: pointer;
}

.cp-check {
  pointer-events: none;
  flex-shrink: 0;
}

.cp-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  height: 100%;
  cursor: pointer;
  padding: 0;
  border: none;
}
</style>
