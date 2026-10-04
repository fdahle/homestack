import { ref, getCurrentScope, onScopeDispose } from 'vue'
import { apiFetch } from '../api.js'
import { nominatim, countryName } from '../utils/nominatim.js'
import { markerFields, validLatLng } from '../../../shared/markers.js'
import { useShareLinksStore } from '../stores/shareLinks.js'

const COORD_EPSILON = 0.00001

// ── CSV parsing ───────────────────────────────────────────────────────────────

function parseCsvRecords(text) {
  const records = []
  let i = 0
  while (i < text.length) {
    while (i < text.length && (text[i] === '\r' || text[i] === '\n')) i++
    if (i >= text.length) break
    const fields = []
    for (;;) {
      let field = ''
      if (text[i] === '"') {
        i++
        while (i < text.length) {
          if (text[i] === '"') {
            if (text[i + 1] === '"') { field += '"'; i += 2 }
            else { i++; break }
          } else field += text[i++]
        }
      } else {
        while (i < text.length && text[i] !== ',' && text[i] !== '\r' && text[i] !== '\n') field += text[i++]
      }
      fields.push(field)
      if (i < text.length && text[i] === ',') { i++; continue }
      break
    }
    while (i < text.length && (text[i] === '\r' || text[i] === '\n')) i++
    if (fields.length > 0) records.push(fields)
  }
  return records
}

function extractCoordsFromUrl(url) {
  const m = url.match(/\/maps\/search\/([-\d.]+),([-\d.]+)/)
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) }
  return null
}

function isCoordTitle(title) {
  return /[0-9]+°/.test(title) || title === 'Gesetzte Markierung' || title === 'Dropped pin'
}

function parseGoogleCsv(text) {
  const records = parseCsvRecords(text)
  const headerIdx = records.findIndex(r => r[0]?.trim() === 'Title')
  if (headerIdx === -1) throw new Error('Could not find header row (expected Title,Note,URL,…)')

  const rows = []
  for (let i = headerIdx + 1; i < records.length; i++) {
    const fields = records[i]
    if (fields.every(f => !f.trim())) continue

    const title  = fields[0]?.trim() || ''
    const note   = (fields[1]?.trim() || '').replace(/\s*\n\s*/g, ' ')
    const url    = fields[2]?.trim() || ''
    const coords = extractCoordsFromUrl(url)

    if (!coords && !title) continue

    let label, description
    if (coords) {
      label       = note || (isCoordTitle(title) ? null : title) || null
      description = null
    } else {
      label       = title
      description = note || null
    }

    rows.push({ title, note, url, coords, label, description })
  }
  return rows.filter(r => r.label || r.coords)
}

// ── Composable ────────────────────────────────────────────────────────────────

export function useImportExport(markersStore, categoriesStore, collectionsStore, personsStore) {
  const controller = new AbortController()
  if (getCurrentScope()) onScopeDispose(() => controller.abort())
  const requestOptions = { signal: controller.signal, retryRateLimit: true, onRetry: seconds => {
    const message = 'Write limit reached. Continuing in ' + seconds + ' seconds…'
    if (importing.value) importStatus.value = message
    if (csvImporting.value) csvStatus.value = message
  } }
  async function importBatches(rows, onResult) {
    for (let offset = 0; offset < rows.length; offset += 100) {
      const batch = rows.slice(offset, offset + 100)
      const results = await markersStore.importBatch(batch.map(r => r.payload), requestOptions)
      for (const result of results) onResult(batch[result.index], result)
    }
  }
  // ── Backup ──────────────────────────────────────────────
  const backingUp   = ref(false)
  const backupError = ref(null)

  async function doBackup() {
    backingUp.value   = true
    backupError.value = null
    try {
      const res = await apiFetch('/api/backup')
      if (!res.ok) throw new Error(`Backup failed (${res.status})`)
      const data = await res.json()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const date = new Date().toISOString().slice(0, 10)
      a.download = `mapmarker-backup-${date}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      backupError.value = err.message
    } finally {
      backingUp.value = false
    }
  }

  // ── Restore ─────────────────────────────────────────────
  const restoreInput    = ref(null)
  const restoreFile     = ref(null)
  const restoreData     = ref(null)
  const restoreError    = ref(null)
  const restoreStatus   = ref(null)
  const restoring       = ref(false)

  function onRestoreFileSelected(e) {
    restoreError.value  = null
    restoreStatus.value = null
    restoreData.value   = null
    const file = e.target.files[0]
    if (!file) return
    restoreFile.value = file
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result)
        if (data?.type !== 'backup' || !Array.isArray(data.markers)) {
          throw new Error('Not a valid backup file')
        }
        restoreData.value = data
      } catch (err) {
        restoreError.value = 'Invalid file: ' + err.message
        restoreFile.value = null
      }
    }
    reader.readAsText(file)
  }

  function cancelRestore() {
    restoreFile.value   = null
    restoreData.value   = null
    restoreError.value  = null
    restoreStatus.value = null
    if (restoreInput.value) restoreInput.value.value = ''
  }

  async function doRestore() {
    restoring.value = true
    restoreError.value  = null
    restoreStatus.value = null
    try {
      const res = await apiFetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(restoreData.value),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error)
      const c = result.counts
      restoreStatus.value = `Restored — ${c.markers} markers, ${c.categories} categories, ${c.collections} collections, ${c.persons} persons.`
      restoreData.value = null
      restoreFile.value = null
      if (restoreInput.value) restoreInput.value.value = ''
      markersStore.clearGroupFilter()
      markersStore.setVisitedFilter('all')
      markersStore.revision++
      useShareLinksStore().items = []
      for (const store of [markersStore, categoriesStore, collectionsStore, personsStore]) if (store) store.items = []
      await Promise.all([markersStore, categoriesStore, collectionsStore, personsStore].filter(Boolean).map(store => store.fetch()))
    } catch (err) {
      restoreError.value = err.message
    } finally {
      restoring.value = false
    }
  }

  // ── Export ──────────────────────────────────────────────
  const exporting = ref(false)

  async function doExport() {
    exporting.value = true
    try {
      const res = await apiFetch('/api/markers')
      if (!res.ok) throw new Error(`Export failed (${res.status})`)
      const markers = await res.json()
      const payload = {
        version: 4,
        type: 'export',
        exported_at: new Date().toISOString(),
        markers: markers.map((m) => ({
          ...markerFields(m),
          categories: m.categories?.map((c) => c.name) ?? [],
          collections: m.collections?.map((c) => ({ name: c.name, position: c.position ?? null })) ?? [],
          persons: m.persons?.map(p => ({ name: p.name, first_name: p.first_name || p.name, last_name: p.last_name || null })) ?? [],
        })),
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'mapmarker-export.json'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      importError.value = err.message
    } finally {
      exporting.value = false
    }
  }

  // ── JSON Import ──────────────────────────────────────────
  const fileInput      = ref(null)
  const importFile     = ref(null)
  const importMarkers  = ref(null)
  const importError    = ref(null)
  const importStatus   = ref(null)
  const importing      = ref(false)
  const importProgress = ref(0)
  const importFailed   = ref([])

  function onFileSelected(e) {
    importError.value  = null
    importStatus.value = null
    importMarkers.value = null
    const file = e.target.files[0]
    if (!file) return
    importFile.value = file
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result)
        if (data?.type === 'backup') throw new Error('Use Restore for backup files')
        if (data?.version != null && ![1,2,3,4].includes(data.version)) throw new Error('Unsupported export version')
        const list = Array.isArray(data) ? data : data.markers
        if (!Array.isArray(list)) throw new Error('Expected an array of markers')
        importMarkers.value = list
      } catch (err) {
        importError.value = 'Invalid file: ' + err.message
      }
    }
    reader.readAsText(file)
  }

  async function doImport() {
    importing.value = true
    importProgress.value = 0
    importError.value = null
    importStatus.value = null
    importFailed.value = []
    let ok = 0
    try {
      const maps = [categoriesStore, collectionsStore, personsStore].map(store => new Map((store?.items ?? []).map(item => [item.name, item.id])))
      const failedNames = new Map()
      async function resolve(items, index) {
        if (!Array.isArray(items)) throw new Error('Invalid marker relationships')
        const store = [categoriesStore, collectionsStore, personsStore][index]
        const ids = []
        for (const item of items) {
          const name = typeof item === 'string' ? item : item?.name
          if (typeof name !== 'string' || !name.trim()) throw new Error('A relationship has no name')
          const key = index + ':' + name
          if (failedNames.has(key)) throw new Error(failedNames.get(key))
          if (!maps[index].has(name)) {
            try {
              const data = index === 2 ? { first_name: typeof item === 'object' ? item.first_name || name : name, last_name: typeof item === 'object' ? item.last_name || null : null } : { name }
              maps[index].set(name, (await store.create(data, requestOptions)).id)
            } catch (err) {
              if (err.name === 'AbortError') throw err
              const message = 'Could not create "' + name + '": ' + err.message
              failedNames.set(key, message)
              throw new Error(message, { cause: err })
            }
          }
          ids.push(maps[index].get(name))
        }
        return ids
      }
      const rows = []
      for (const [index, m] of importMarkers.value.entries()) {
        try {
          if (!m || !validLatLng(m.lat, m.lng)) throw new Error('Invalid coordinates')
          const category_ids = await resolve(m.categories ?? [], 0)
          const collection_ids = await resolve(m.collections ?? [], 1)
          const person_ids = await resolve(m.persons ?? [], 2)
          const collection_positions = Object.fromEntries((m.collections ?? []).map((c, i) => [collection_ids[i], typeof c === 'string' ? null : c.position ?? null]))
          rows.push({ label: m.label || 'Line ' + (index + 1), payload: { ...markerFields(m), source: m.source || 'json', category_ids, collection_ids, collection_positions, person_ids } })
        } catch (err) {
          if (err.name === 'AbortError') throw err
          importFailed.value.push({ label: (m?.label || 'Line ' + (index + 1)) + ': ' + err.message })
          importProgress.value++
        }
      }
      await importBatches(rows, (row, result) => {
        if (result.error) importFailed.value.push({ label: row.label + ': ' + result.error })
        else ok++
        importProgress.value++
      })
      importMarkers.value = null
      importFile.value = null
      if (fileInput.value) fileInput.value.value = ''
    } catch (err) {
      importError.value = err.name === 'AbortError' ? 'Import cancelled' : err.message + '. Completed batches remain saved; check them before retrying.'
    } finally {
      importing.value = false
      importStatus.value = 'Done — ' + ok + ' imported, ' + importFailed.value.length + ' failed.'
    }
  }

  // ── Google Maps CSV Import ────────────────────────────────
  const csvInput          = ref(null)
  const csvFiles          = ref(null)
  const csvRows           = ref(null)
  const csvError          = ref(null)
  const csvStatus         = ref(null)
  const geocoding         = ref(false)
  const geocodeProgress   = ref(0)
  const geocodedMarkers   = ref(null)
  const csvImporting      = ref(false)
  const csvImportProgress = ref(0)
  const csvFailed         = ref([])

  function resetCsv() {
    csvFiles.value = null
    csvRows.value = null
    csvError.value = null
    csvStatus.value = null
    geocoding.value = false
    geocodedMarkers.value = null
    csvImporting.value = false
    csvFailed.value = []
    if (csvInput.value) csvInput.value.value = ''
  }

  async function onCsvSelected(e) {
    csvError.value = null
    csvStatus.value = null
    csvRows.value = null
    geocodedMarkers.value = null
    const files = [...e.target.files]
    if (!files.length) return
    csvFiles.value = files

    const readFile = (f) => new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = (ev) => resolve({ name: f.name, text: ev.target.result })
      r.onerror = () => reject(new Error(`Could not read ${f.name}`))
      r.readAsText(f, 'UTF-8')
    })

    try {
      const results = await Promise.all(files.map(readFile))
      const allRows = []
      const errors = []
      for (const { name, text } of results) {
        try { allRows.push(...parseGoogleCsv(text)) }
        catch (err) { errors.push(`${name}: ${err.message}`) }
      }
      if (errors.length) csvError.value = errors.join(' | ')
      if (!allRows.length) throw new Error('No valid rows found in any file')
      csvRows.value = allRows
    } catch (err) {
      csvError.value = err.message
    }
  }

  async function doGeocode() {
    geocoding.value = true
    geocodeProgress.value = 0
    geocodedMarkers.value = null
    csvStatus.value = null
    csvError.value = null
    const results = []
    let failed = 0

    for (const row of csvRows.value) {
      if (controller.signal.aborted) { geocoding.value = false; return }
      if (row.coords) {
        results.push({ lat: row.coords.lat, lng: row.coords.lng, label: row.label, description: row.description, country: null })
        geocodeProgress.value++
        continue
      }
      try {
        const data = await nominatim('search', { q: row.title, limit: 1, addressdetails: 1 }, { signal: controller.signal })
        if (data.length) {
          const country = countryName(data[0].address)
          results.push({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), label: row.label, description: row.description, country })
        } else {
          failed++
        }
      } catch {
        failed++
      }
      geocodeProgress.value++
    }

    geocoding.value = false
    geocodedMarkers.value = results
    const pinned  = csvRows.value.filter(r => r.coords).length
    const geocoded = results.length - pinned
    const parts = []
    if (pinned)   parts.push(`${pinned} pinned`)
    if (geocoded) parts.push(`${geocoded} geocoded`)
    const summary = `${results.length} markers ready (${parts.join(', ')}).`
    csvStatus.value = failed ? `${summary} ${failed} not found — skipped.` : summary
  }

  function isExistingMarker(m) {
    return markersStore.items.some(
      (e) => Math.abs(e.lat - m.lat) < COORD_EPSILON &&
             Math.abs(e.lng - m.lng) < COORD_EPSILON &&
             (e.label || null) === (m.label || null)
    )
  }

  async function doCsvImport(list = null) {
    const markers = list ?? geocodedMarkers.value ?? []
    csvImporting.value = true
    csvImportProgress.value = 0
    csvError.value = null
    csvFailed.value = []
    let ok = 0, skipped = 0
    try {
      const rows = []
      for (const [i, m] of markers.entries()) {
        if (isExistingMarker(m) || rows.some(r => Math.abs(r.payload.lat - m.lat) < COORD_EPSILON && Math.abs(r.payload.lng - m.lng) < COORD_EPSILON && (r.payload.label || null) === (m.label || null))) {
          skipped++
          csvImportProgress.value++
        } else rows.push({ label: m.label || 'Line ' + (i + 1), payload: { ...markerFields(m), source: 'google_maps_csv', visited_at: null, category_ids: [], collection_ids: [] } })
      }
      await importBatches(rows, (row, result) => {
        if (result.error) csvFailed.value.push({ label: row.label + ': ' + result.error })
        else ok++
        csvImportProgress.value++
      })
      geocodedMarkers.value = null
      csvRows.value = null
      csvFiles.value = null
      if (csvInput.value) csvInput.value.value = ''
    } catch (err) {
      csvError.value = err.name === 'AbortError' ? 'Import cancelled' : err.message
    } finally {
      csvImporting.value = false
      csvStatus.value = 'Done — ' + ok + ' imported, ' + skipped + ' duplicates skipped, ' + csvFailed.value.length + ' failed.'
    }
  }

  return {
    // backup
    backingUp, backupError, doBackup,
    restoreInput, restoreFile, restoreData, restoreError, restoreStatus,
    restoring, onRestoreFileSelected, cancelRestore, doRestore,
    // export
    exporting, doExport,
    // json import
    fileInput, importFile, importMarkers, importError, importStatus,
    importing, importProgress, importFailed, onFileSelected, doImport,
    // csv import
    csvInput, csvFiles, csvRows, csvError, csvStatus,
    geocoding, geocodeProgress, geocodedMarkers,
    csvImporting, csvImportProgress, csvFailed,
    resetCsv, onCsvSelected, doGeocode, doCsvImport,
  }
}
