import { ref } from 'vue'

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
  // ── Backup ──────────────────────────────────────────────
  const backingUp   = ref(false)
  const backupError = ref(null)

  async function doBackup() {
    backingUp.value   = true
    backupError.value = null
    try {
      const res = await fetch('/api/backup')
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
      const res = await fetch('/api/backup/restore', {
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
      await markersStore.fetch()
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
      const res = await fetch('/api/markers')
      if (!res.ok) throw new Error(`Export failed (${res.status})`)
      const markers = await res.json()
      const payload = {
        version: 3,
        type: 'export',
        exported_at: new Date().toISOString(),
        markers: markers.map((m) => ({
          lat: m.lat, lng: m.lng,
          label: m.label || null,
          description: m.description || null,
          visited_at: m.visited_at || null,
          planned_at: m.planned_at || null,
          color: m.color || null,
          image_url: m.image_url || null,
          address: m.address || null,
          country: m.country || null,
          rating: m.rating ?? null,
          is_favorite: m.is_favorite ?? 0,
          external_url: m.external_url || null,
          source: m.source || null,
          categories: m.categories?.map((c) => c.name) ?? [],
          collections: m.collections?.map((c) => ({ name: c.name, position: c.position ?? null })) ?? [],
          persons: m.persons?.map((p) => p.name) ?? [],
        })),
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'mapmarker-export.json'
      a.click()
      URL.revokeObjectURL(url)
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
    importError.value  = null
    importStatus.value = null
    importFailed.value = []

    // Build name→id maps from current store state
    const catNameToId = Object.fromEntries((categoriesStore?.items ?? []).map(c => [c.name, c.id]))
    const colNameToId = Object.fromEntries((collectionsStore?.items ?? []).map(c => [c.name, c.id]))
    const perNameToId = Object.fromEntries((personsStore?.items ?? []).map(p => [p.name, p.id]))

    // Pre-create any categories/collections/persons not yet in the store
    const allCatNames = new Set(importMarkers.value.flatMap(m => m.categories ?? []))
    const allColNames = new Set(importMarkers.value.flatMap(m => (m.collections ?? []).map(c => typeof c === 'string' ? c : c.name)))
    const allPerNames = new Set(importMarkers.value.flatMap(m => m.persons ?? []))

    for (const name of allCatNames) {
      if (!catNameToId[name] && categoriesStore) {
        try { catNameToId[name] = (await categoriesStore.create({ name })).id } catch {}
      }
    }
    for (const name of allColNames) {
      if (!colNameToId[name] && collectionsStore) {
        try { colNameToId[name] = (await collectionsStore.create({ name })).id } catch {}
      }
    }
    for (const name of allPerNames) {
      if (!perNameToId[name] && personsStore) {
        try { perNameToId[name] = (await personsStore.create({ name })).id } catch {}
      }
    }

    let ok = 0
    for (let i = 0; i < importMarkers.value.length; i++) {
      const m = importMarkers.value[i]
      try {
        const category_ids = (m.categories ?? []).map(n => catNameToId[n]).filter(Boolean)
        const colEntries   = (m.collections ?? []).map(c => typeof c === 'string' ? { name: c, position: null } : c)
        const collection_ids = colEntries.map(c => colNameToId[c.name]).filter(Boolean)
        const collection_positions = Object.fromEntries(
          colEntries.filter(c => colNameToId[c.name]).map(c => [colNameToId[c.name], c.position ?? null])
        )
        const person_ids = (m.persons ?? []).map(n => perNameToId[n]).filter(Boolean)

        await markersStore.create({
          lat: m.lat, lng: m.lng,
          label: m.label || null,
          description: m.description || null,
          visited_at: m.visited_at || null,
          planned_at: m.planned_at || null,
          color: m.color || null,
          image_url: m.image_url || null,
          address: m.address || null,
          country: m.country || null,
          rating: m.rating ?? null,
          is_favorite: m.is_favorite ?? 0,
          external_url: m.external_url || null,
          category_ids,
          collection_ids,
          collection_positions,
          person_ids,
        })
        ok++
      } catch {
        importFailed.value.push({ label: m.label || `Line ${i + 1}` })
      }
      importProgress.value++
    }
    importing.value = false
    const fail = importFailed.value.length
    importStatus.value = `Done — ${ok} imported${fail ? `, ${fail} failed` : ''}.`
    importMarkers.value = null
    importFile.value = null
    if (fileInput.value) fileInput.value.value = ''
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
      if (row.coords) {
        results.push({ lat: row.coords.lat, lng: row.coords.lng, label: row.label, description: row.description, country: null })
        geocodeProgress.value++
        continue
      }
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(row.title)}&format=json&limit=1&addressdetails=1`
        )
        const data = await res.json()
        if (data.length) {
          const country = data[0].address?.country ?? null
          results.push({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), label: row.label, description: row.description, country })
        } else {
          failed++
        }
      } catch {
        failed++
      }
      geocodeProgress.value++
      await new Promise((r) => setTimeout(r, 1100))
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
    const markers = list ?? geocodedMarkers.value
    csvImporting.value = true
    csvImportProgress.value = 0
    csvError.value = null
    csvFailed.value = []
    let ok = 0
    let skipped = 0
    for (let i = 0; i < markers.length; i++) {
      const m = markers[i]
      if (isExistingMarker(m)) {
        skipped++
        csvImportProgress.value++
        continue
      }
      try {
        await markersStore.create({
          lat: m.lat, lng: m.lng,
          label: m.label, description: m.description,
          visited_at: null, category_ids: [], collection_ids: [],
        })
        ok++
      } catch {
        csvFailed.value.push({ label: m.label || `Line ${i + 1}` })
      }
      csvImportProgress.value++
    }
    csvImporting.value = false
    const fail = csvFailed.value.length
    const parts = [`${ok} imported`]
    if (skipped) parts.push(`${skipped} duplicate${skipped > 1 ? 's' : ''} skipped`)
    if (fail) parts.push(`${fail} failed`)
    csvStatus.value = `Done — ${parts.join(', ')}.`
    geocodedMarkers.value = null
    csvRows.value = null
    csvFiles.value = null
    if (csvInput.value) csvInput.value.value = ''
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
