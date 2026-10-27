<template>
  <div :class="['eip-panel', { 'eip-panel--inline': inline }]" @click.stop>
    <p class="eip-title">Export / Import</p>

    <button class="eip-btn eip-btn--primary" @click="doExport">
      <AppIcon name="download" :size="14" />
      Export all data
    </button>

    <div class="eip-divider" />

    <label class="eip-label">Import from file</label>
    <label class="eip-file-label" :class="{ loading: importing }">
      <input type="file" accept=".json" class="eip-file-input" @change="doImport" :disabled="importing" />
      <AppIcon name="upload" :size="14" />
      {{ importing ? 'Importing…' : 'Choose JSON file' }}
    </label>

    <label class="eip-check-label">
      <input type="checkbox" v-model="overwriteExisting" />
      Overwrite existing items
    </label>

    <p v-if="statusMsg" class="eip-status" :class="{ error: isError }">{{ statusMsg }}</p>
  </div>
</template>

<script>
import { useNotesStore } from '../stores/notes.js'

export default {
  name: 'ExportImportPanel',

  props: {
    inline: { type: Boolean, default: false },
  },

  setup() {
    return { store: useNotesStore() }
  },

  data() {
    return {
      overwriteExisting: false,
      importing: false,
      statusMsg: '',
      isError: false,
    }
  },

  methods: {
    doExport() {
      const data = this.store.exportData()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `zettel-export-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      this.statusMsg = `Exported ${data.docs.length} items.`
      this.isError = false
    },

    async doImport(event) {
      const file = event.target.files[0]
      if (!file) return
      this.importing = true
      this.statusMsg = ''
      this.isError = false
      try {
        const text = await file.text()
        const payload = JSON.parse(text)
        const count = await this.store.importData(payload, { overwrite: this.overwriteExisting })
        this.statusMsg = `Imported ${count} item${count !== 1 ? 's' : ''}.`
      } catch (e) {
        this.statusMsg = `Import failed: ${e.message}`
        this.isError = true
      } finally {
        this.importing = false
        event.target.value = ''
      }
    },
  },
}
</script>

<style scoped>
.eip-panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,.15);
  padding: 0.75rem;
  width: 220px;
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.eip-title {
  margin: 0 0 0.25rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-3);
}

.eip-btn {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  border: none;
  border-radius: 6px;
  padding: 0.45rem 0.75rem;
  font-size: 0.8rem;
  font-family: inherit;
  cursor: pointer;
  font-weight: 500;
  width: 100%;
}
.eip-btn--primary { background: var(--accent); color: #fff; }
.eip-btn--primary:hover { background: var(--accent-h); }

.eip-divider { height: 1px; background: var(--border); margin: 0.1rem 0; }

.eip-label {
  font-size: 0.75rem;
  color: var(--text-3);
  font-weight: 500;
}

.eip-file-label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  border: 1px dashed var(--border);
  border-radius: 6px;
  padding: 0.45rem 0.75rem;
  font-size: 0.8rem;
  color: var(--text-3);
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}
.eip-file-label:hover { border-color: var(--accent); background: var(--accent-bg); }
.eip-file-label.loading { opacity: 0.6; cursor: default; }

.eip-file-input {
  display: none;
}

.eip-check-label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  color: var(--text-3);
  cursor: pointer;
}

.eip-status {
  margin: 0;
  font-size: 0.75rem;
  color: var(--success);
  background: var(--success-bg);
  border-radius: 4px;
  padding: 0.3rem 0.5rem;
}
.eip-status.error { color: var(--danger); background: var(--danger-bg); }

.eip-panel--inline {
  position: static;
  width: auto;
  box-shadow: none;
  border: none;
  padding: 0;
  border-radius: 0;
}
</style>
