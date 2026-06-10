<template>
  <div class="overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h2>{{ viewing ? 'Marker' : isEdit ? 'Edit Marker' : 'Add Marker' }}</h2>
        <button class="close-btn" @click="$emit('close')"><AppIcon name="close" /></button>
      </div>

      <!-- View mode -->
      <div v-if="viewing" class="view-body">

        <!-- Hero image -->
        <div v-if="displayImage && !imageError" class="view-hero-wrap">
          <img :src="displayImage" class="view-hero" @error="imageError = true" />
        </div>

        <!-- Title & description -->
        <div class="view-title-row">
          <div class="view-title">{{ form.label || '(unnamed)' }}</div>
          <div v-if="form.visited_at" class="visited-badge">
            <AppIcon name="check" />
            Visited<template v-if="form.visited_at !== 'yes'"> · {{ form.visited_at }}</template>
          </div>
        </div>
        <p v-if="form.description" class="view-desc">{{ form.description }}</p>

        <!-- Tag chips -->
        <div v-if="selectedCollections.length || selectedCategories.length || selectedPersons.length" class="view-tags">
          <div v-if="selectedCollections.length" class="tag-group">
            <span class="tag-group-label">Collections</span>
            <div class="tag-chips">
              <button
                v-for="col in selectedCollections"
                :key="col.id"
                type="button"
                class="chip chip-collection"
                :style="{ background: col.color + '22', borderColor: col.color + '77' }"
                @click="filterBy('collection', col.id)"
              >
                <span class="chip-dot" :style="{ background: col.color }" />
                {{ col.name }}
                <span v-if="col.is_trip && tripPosition(col.id) != null" class="chip-pos">#{{ tripPosition(col.id) }}</span>
              </button>
            </div>
          </div>
          <div v-if="selectedCategories.length" class="tag-group">
            <span class="tag-group-label">Categories</span>
            <div class="tag-chips">
              <button
                v-for="cat in selectedCategories"
                :key="cat.id"
                type="button"
                class="chip chip-category"
                :style="{ borderColor: cat.color + 'aa' }"
                @click="filterBy('category', cat.id)"
              >
                <span class="chip-dot" :style="{ background: cat.color }" />
                {{ cat.name }}
              </button>
            </div>
          </div>
          <div v-if="selectedPersons.length" class="tag-group">
            <span class="tag-group-label">With</span>
            <div class="tag-chips">
              <button
                v-for="person in selectedPersons"
                :key="person.id"
                type="button"
                class="chip chip-person"
                :style="{ background: person.color + '22', borderColor: person.color + '77' }"
                @click="filterBy('person', person.id)"
              >
                <span class="chip-dot" :style="{ background: person.color }" />
                {{ person.name }}
              </button>
            </div>
          </div>
        </div>

        <!-- Meta: address, coords -->
        <div class="view-meta">
          <template v-if="form.address || addressLoading || addressLine">
            <span class="meta-label">Address</span>
            <div v-if="form.address" class="meta-row address-row">{{ form.address }}</div>
            <div v-else-if="addressLoading" class="meta-row">Fetching address…</div>
            <div v-else-if="addressLine" class="meta-row address-row">{{ addressLine }}</div>
          </template>
          <div class="meta-row coords-text">{{ latStr }}, {{ lngStr }}</div>
          <div class="meta-row">
            <a
              :href="googleMapsHref"
              target="_blank"
              rel="noopener noreferrer"
              class="open-maps-link"
            >Open in Maps <AppIcon name="externalLink" /></a>
          </div>
        </div>

      </div>

      <div v-if="viewing" class="modal-actions">
        <div class="spacer" />
        <button type="button" class="btn-secondary" @click="$emit('close')">Close</button>
        <button v-if="!props.readOnly" type="button" class="btn-primary" @click="viewing = false; confirmDelete = false">Edit</button>
      </div>

      <!-- Edit / create form -->
      <form v-else @submit.prevent="save">
        <div class="edit-body">
        <div class="field">
          <label>Label</label>
          <input v-model="form.label" type="text" placeholder="e.g. Eiffel Tower" />
        </div>

        <div class="field">
          <label>Description</label>
          <textarea v-model="form.description" rows="3" placeholder="Notes about this place…" />
        </div>

        <div class="field">
          <label>Visited</label>
          <div class="visited-row">
            <label class="checkbox-item" style="margin:0">
              <input type="checkbox" v-model="visitedChecked" style="width:auto" />
              Yes
            </label>
            <input v-model="visitedDate" type="date" class="visited-date" :style="{ visibility: visitedChecked ? 'visible' : 'hidden' }" />
          </div>
        </div>

        <div class="field">
          <label>Image</label>
          <div v-if="form.image_url && !imageChangeMode" class="img-current">
            <img :src="form.image_url" class="img-current-thumb" @error="$event.target.style.display='none'" />
            <div class="img-current-actions">
              <button type="button" class="btn-ghost btn-sm" @click="imageChangeMode = true">Change</button>
              <button type="button" class="btn-ghost btn-sm" @click="form.image_url = ''">Remove</button>
            </div>
          </div>
          <template v-if="!form.image_url || imageChangeMode">
            <div class="img-search-row">
              <input
                v-model="imageSearchQuery"
                type="text"
                class="img-search-input"
                placeholder="Search name…"
                @keydown.enter.prevent="searchWiki"
              />
              <button type="button" class="btn-ghost btn-sm" :class="{ 'btn-source-active': imageResultsSource === 'wiki' }" :disabled="imageSearchLoading !== false" @click="searchWiki">
                {{ imageSearchLoading === 'wiki' ? '…' : 'Wiki' }}
              </button>
              <button type="button" class="btn-ghost btn-sm" :class="{ 'btn-source-active': imageResultsSource === 'commons' }" :disabled="imageSearchLoading !== false" @click="searchCommons">
                {{ imageSearchLoading === 'commons' ? '…' : 'Commons' }}
              </button>
            </div>
            <div v-if="imageResults !== null" class="img-results">
              <div v-if="imageResults.length === 0" class="img-no-result">No images found</div>
              <div v-else class="img-results-grid">
                <button
                  v-for="r in imageResults"
                  :key="r.url"
                  type="button"
                  class="img-result-card"
                  @click="selectImage(r.url); imageChangeMode = false"
                >
                  <img :src="r.url" class="img-result-thumb" @error="imageResults = imageResults.filter(x => x.url !== r.url)" />
                  <span class="img-result-title">{{ r.title }}</span>
                </button>
              </div>
            </div>
            <div class="img-url-row">
              <input v-model="form.image_url" type="url" placeholder="Paste image URL…" class="img-url-input" />
              <a
                :href="`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(imageSearchQuery.trim() || form.label || '')}`"
                target="_blank"
                rel="noopener noreferrer"
                class="btn-ghost btn-sm img-google-btn"
              >Google <AppIcon name="externalLink" /></a>
            </div>
          </template>
        </div>

        <div class="field">
          <label>Collections</label>
          <div class="checkbox-list">
            <div v-for="col in collectionsStore.items" :key="col.id" class="collection-row">
              <label class="checkbox-item">
                <input
                  type="checkbox"
                  :value="col.id"
                  v-model="form.collection_ids"
                  style="width:auto"
                />
                <span class="dot" :style="{ background: col.color }" />
                {{ col.name }}
              </label>
              <div v-if="col.is_trip && form.collection_ids.includes(col.id)" class="stop-field">
                <span class="stop-label">Stop #</span>
                <input
                  type="number"
                  min="1"
                  class="stop-input"
                  :value="form.collection_positions[col.id] ?? ''"
                  @input="setPosition(col.id, $event.target.value)"
                  placeholder="–"
                />
                <span v-if="hasDuplicate(col.id)" class="stop-warning" title="This stop number is already used in this trip">⚠</span>
              </div>
            </div>
            <span v-if="collectionsStore.items.length === 0" class="empty-hint">No collections yet</span>
          </div>
        </div>

        <div class="field">
          <label>Categories</label>
          <div class="checkbox-list">
            <label v-for="cat in categoriesStore.items" :key="cat.id" class="checkbox-item">
              <input type="checkbox" :value="cat.id" v-model="form.category_ids" style="width:auto" />
              <span class="dot" :style="{ background: cat.color }" />
              {{ cat.name }}
            </label>
            <span v-if="categoriesStore.items.length === 0" class="empty-hint">No categories yet</span>
          </div>
        </div>

        <div class="field">
          <label>With</label>
          <div class="checkbox-list">
            <label v-for="person in personsStore.items" :key="person.id" class="checkbox-item">
              <input type="checkbox" :value="person.id" v-model="form.person_ids" style="width:auto" />
              <span class="dot" :style="{ background: person.color }" />
              {{ person.name }}
            </label>
            <span v-if="personsStore.items.length === 0" class="empty-hint">No persons yet</span>
          </div>
        </div>

        <div class="field">
          <label>Color</label>
          <div class="color-row">
            <button
              type="button"
              class="color-swatch inherit"
              :class="{ selected: !form.color }"
              @click="form.color = ''"
              title="Inherit from category"
            >
              <AppIcon name="colorInherit" />
            </button>
            <button
              v-for="c in COLOR_PRESETS"
              :key="c"
              type="button"
              class="color-swatch"
              :class="{ selected: form.color === c }"
              :style="{ background: c }"
              @click="form.color = c"
            />
            <span class="effective-color">
              <span class="dot" :style="{ background: effectiveColor }" />
            </span>
          </div>
        </div>

        <div class="field">
          <label>Address</label>
          <input v-model="form.address" type="text" :placeholder="addressLoading ? 'Fetching address…' : 'e.g. 123 Main St, City'" />
        </div>

        <div class="field coords">
          <span class="coords-mono">{{ latStr }}, {{ lngStr }}</span>
          <label class="checkbox-item coords-toggle" style="margin:0">
            <input type="checkbox" v-model="useCoordLink" style="width:auto" />
            use coords
          </label>
        </div>
        </div><!-- end .edit-body -->

        <p v-if="error" class="error edit-error">{{ error }}</p>

        <div class="modal-actions">
          <template v-if="isEdit">
            <button v-if="!confirmDelete" type="button" class="btn-danger" @click="confirmDelete = true" :disabled="saving">Delete</button>
            <template v-else>
              <button type="button" class="btn-danger" @click="del" :disabled="saving">Yes, delete</button>
              <button type="button" class="btn-ghost" @click="confirmDelete = false"><AppIcon name="close" /></button>
            </template>
          </template>
          <div class="spacer" />
          <button type="button" class="btn-secondary" @click="isEdit ? (viewing = true, confirmDelete = false) : $emit('close')">
            {{ isEdit ? '← Back' : 'Cancel' }}
          </button>
          <button type="submit" class="btn-primary" :disabled="saving">
            {{ saving ? '...' : 'Save' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import AppIcon from './AppIcon.vue'
import { useCategoriesStore } from '../stores/categories.js'
import { useCollectionsStore } from '../stores/collections.js'
import { usePersonsStore } from '../stores/persons.js'
import { useMarkersStore } from '../stores/markers.js'

const COLOR_PRESETS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']

const props = defineProps({
  marker: { type: Object, default: null },
  latlng: { type: Object, default: null },
  suggestedLabel: { type: String, default: '' },
  readOnly: { type: Boolean, default: false },
})
const emit = defineEmits(['save', 'delete', 'close'])

const categoriesStore = useCategoriesStore()
const collectionsStore = useCollectionsStore()
const personsStore = usePersonsStore()
const markersStore = useMarkersStore()

const isEdit = computed(() => !!props.marker)
const viewing = ref(!!props.marker)
const saving = ref(false)
const error = ref(null)
const confirmDelete = ref(false)
const useCoordLink = ref(false)
const visitedChecked = ref(false)
const visitedDate = ref('')
const addressLine = ref(null)
const addressLoading = ref(false)

// Image state
const imageError = ref(false)
const imageEditMode = ref(false)
const imageUrlDraft = ref('')
const imageUrlInputRef = ref(null)
const imageSearchQuery = ref('')
const imageSearchLoading = ref(false) // false | 'wiki' | 'commons'
const imageResults = ref(null) // null | [{ url, title }]
const imageChangeMode = ref(false)
const imageResultsSource = ref(null) // null | 'wiki' | 'commons'

const form = ref({
  label: '',
  description: '',
  image_url: '',
  category_ids: [],
  collection_ids: [],
  collection_positions: {},
  person_ids: [],
  visited_at: '',
  color: '',
  address: '',
  lat: 0,
  lng: 0,
})

const selectedCategories = computed(() =>
  categoriesStore.items.filter((c) => form.value.category_ids.includes(c.id))
)
const selectedPersons = computed(() =>
  personsStore.items.filter((p) => form.value.person_ids.includes(p.id))
)
const effectiveColor = computed(() =>
  form.value.color || selectedCategories.value[0]?.color || '#6c757d'
)
const selectedCollections = computed(() =>
  collectionsStore.items.filter((c) => form.value.collection_ids.includes(c.id))
)

const displayImage = computed(() => form.value.image_url || null)

// Reset image error when source changes
watch(displayImage, () => { imageError.value = false })

function tripPosition(colId) {
  return props.marker?.collections?.find((mc) => mc.id === colId)?.position ?? null
}

// Keep image search pre-filled with label when user hasn't typed a custom search yet
watch(() => form.value.label, (label, oldLabel) => {
  if (!imageSearchQuery.value || imageSearchQuery.value === (oldLabel || '')) {
    imageSearchQuery.value = label || ''
  }
})

watch(() => form.value.image_url, (val) => {
  if (val) imageChangeMode.value = false
})

watch(visitedChecked, (val) => {
  if (!val) {
    form.value.visited_at = ''
    visitedDate.value = ''
  } else {
    form.value.visited_at = visitedDate.value || 'yes'
  }
})

watch(visitedDate, (val) => {
  if (visitedChecked.value) form.value.visited_at = val || 'yes'
})

onMounted(async () => {
  imageChangeMode.value = false
  if (props.marker) {
    form.value = {
      label: props.marker.label || '',
      description: props.marker.description || '',
      image_url: props.marker.image_url || '',
      category_ids: props.marker.categories?.map((c) => c.id) ?? [],
      collection_ids: props.marker.collections?.map((c) => c.id) ?? [],
      collection_positions: Object.fromEntries(
        (props.marker.collections ?? []).map((c) => [c.id, c.position ?? null])
      ),
      person_ids: props.marker.persons?.map((p) => p.id) ?? [],
      visited_at: props.marker.visited_at?.slice(0, 10) || '',
      color: props.marker.color || '',
      address: props.marker.address || '',
      lat: props.marker.lat,
      lng: props.marker.lng,
    }
    visitedChecked.value = !!props.marker.visited_at
    visitedDate.value = (props.marker.visited_at && props.marker.visited_at !== 'yes') ? props.marker.visited_at.slice(0, 10) : ''
    useCoordLink.value = !!props.marker.use_coords

    addressLoading.value = true
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${props.marker.lat}&lon=${props.marker.lng}&format=json&addressdetails=1&namedetails=1&extratags=1`
      )
      const data = await res.json()
      const a = data.address
      if (a) {
        const street = [a.house_number, a.road].filter(Boolean).join(' ')
        const city = a.city || a.town || a.village || a.hamlet || a.municipality
        const parts = [street, [a.postcode, city].filter(Boolean).join(' '), a.country].filter(Boolean)
        const geocoded = parts.join(', ') || null
        addressLine.value = geocoded
        if (!form.value.address && geocoded) form.value.address = geocoded
      }

      // Pre-fill the image search query with the place name for later use
      imageSearchQuery.value = data.namedetails?.['name:en'] || data.namedetails?.name || data.name || form.value.label || ''
    } catch { /* silent */ }
    finally { addressLoading.value = false }
  } else if (props.latlng) {
    form.value.lat = props.latlng.lat
    form.value.lng = props.latlng.lng
    form.value.label = props.suggestedLabel || ''
    imageSearchQuery.value = props.suggestedLabel || ''
    const gf = markersStore.activeGroupFilter
    if (gf?.type === 'category' && gf.id !== '__none__') {
      form.value.category_ids = [gf.id]
    } else if (gf?.type === 'collection' && gf.id !== '__none__') {
      form.value.collection_ids = [gf.id]
    } else if (gf?.type === 'person' && gf.id !== '__none__') {
      form.value.person_ids = [gf.id]
    }

    addressLoading.value = true
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${props.latlng.lat}&lon=${props.latlng.lng}&format=json&addressdetails=1`
      )
      const data = await res.json()
      const a = data.address
      if (a) {
        const street = [a.house_number, a.road].filter(Boolean).join(' ')
        const city = a.city || a.town || a.village || a.hamlet || a.municipality
        const parts = [street, [a.postcode, city].filter(Boolean).join(' '), a.country].filter(Boolean)
        const geocoded = parts.join(', ') || null
        if (!form.value.address && geocoded) form.value.address = geocoded
      }
    } catch { /* silent */ }
    finally { addressLoading.value = false }
  }
})

const latStr = computed(() => Number(form.value.lat).toFixed(5))
const lngStr = computed(() => Number(form.value.lng).toFixed(5))

const googleMapsHref = computed(() => {
  const label = form.value.label?.trim()
  if (label && !useCoordLink.value) return `https://www.google.com/maps/search/${encodeURIComponent(label)}/@${latStr.value},${lngStr.value},17z`
  return `https://www.google.com/maps?q=${latStr.value},${lngStr.value}`
})

function setPosition(collectionId, value) {
  const num = value === '' ? null : parseInt(value, 10)
  form.value.collection_positions = {
    ...form.value.collection_positions,
    [collectionId]: (value === '' || isNaN(num)) ? null : num,
  }
}

function hasDuplicate(collectionId) {
  const pos = form.value.collection_positions[collectionId]
  if (!pos) return false
  return markersStore.items.some(
    (m) => m.id !== props.marker?.id &&
      m.collections.some((c) => c.id === collectionId && c.position === pos)
  )
}

function filterBy(type, id) {
  markersStore.setGroupFilter({ type, id })
  emit('close')
}

function startImageEdit() {
  imageUrlDraft.value = form.value.image_url || ''
  if (!imageSearchQuery.value) imageSearchQuery.value = form.value.label || ''
  imageResults.value = null
  imageEditMode.value = true
  nextTick(() => imageUrlInputRef.value?.focus())
}

async function searchWiki() {
  if (imageResultsSource.value === 'wiki') {
    imageResults.value = null
    imageResultsSource.value = null
    return
  }
  const q = imageSearchQuery.value.trim()
  if (!q) return
  imageSearchLoading.value = 'wiki'
  imageResults.value = null
  imageResultsSource.value = null
  try {
    const searchRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=3&format=json&origin=*`
    )
    const searchData = await searchRes.json()
    const titles = (searchData.query?.search ?? []).map(r => r.title)
    if (!titles.length) { imageResults.value = []; return }
    const imgRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&titles=${titles.map(encodeURIComponent).join('|')}&prop=pageimages&pithumbsize=400&format=json&origin=*`
    )
    const imgData = await imgRes.json()
    const pages = Object.values(imgData.query?.pages ?? {})
    imageResults.value = pages
      .map(p => ({ url: p.thumbnail?.source ?? null, title: p.title }))
      .filter(r => r.url)
    imageResultsSource.value = 'wiki'
  } catch { imageResults.value = [] }
  finally { imageSearchLoading.value = false }
}

async function searchCommons() {
  if (imageResultsSource.value === 'commons') {
    imageResults.value = null
    imageResultsSource.value = null
    return
  }
  const q = imageSearchQuery.value.trim()
  if (!q) return
  imageSearchLoading.value = 'commons'
  imageResults.value = null
  imageResultsSource.value = null
  try {
    const searchRes = await fetch(
      `https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srsearch=${encodeURIComponent(q)}&srlimit=5&format=json&origin=*`
    )
    const searchData = await searchRes.json()
    const titles = (searchData.query?.search ?? []).map(r => r.title)
    if (!titles.length) { imageResults.value = []; return }
    const imgRes = await fetch(
      `https://commons.wikimedia.org/w/api.php?action=query&titles=${titles.map(encodeURIComponent).join('|')}&prop=imageinfo&iiprop=url&iiurlwidth=400&format=json&origin=*`
    )
    const imgData = await imgRes.json()
    const pages = Object.values(imgData.query?.pages ?? {})
    const results = pages
      .map(p => ({
        url: p.imageinfo?.[0]?.thumburl || p.imageinfo?.[0]?.url || null,
        title: (p.title ?? '').replace(/^File:/, '').replace(/\.[^.]+$/, ''),
      }))
      .filter(r => r.url)
    imageResults.value = results.slice(0, 3)
    imageResultsSource.value = 'commons'
  } catch { imageResults.value = [] }
  finally { imageSearchLoading.value = false }
}

async function selectImage(url) {
  form.value.image_url = url
  imageUrlDraft.value = url
  imageResults.value = null
  if (viewing.value) await saveImage()
}

async function saveImage() {
  const newUrl = imageUrlDraft.value.trim() || null
  form.value.image_url = newUrl || ''
  imageEditMode.value = false
  if (props.marker) {
    await markersStore.update(props.marker.id, {
      ...form.value,
      image_url: newUrl,
      color: form.value.color || null,
    })
  }
}

async function clearImage() {
  form.value.image_url = ''
  if (props.marker) {
    await markersStore.update(props.marker.id, {
      ...form.value,
      image_url: null,
      color: form.value.color || null,
    })
  }
}

async function save() {
  error.value = null
  const tripCollections = collectionsStore.items.filter(
    (c) => c.is_trip && form.value.collection_ids.includes(c.id)
  )
  for (const col of tripCollections) {
    if (hasDuplicate(col.id)) {
      const pos = form.value.collection_positions[col.id]
      error.value = `Stop #${pos} is already used in "${col.name}"`
      return
    }
  }
  saving.value = true
  try {
    await emit('save', {
      ...form.value,
      color: form.value.color || null,
      image_url: form.value.image_url || null,
      address: form.value.address || null,
      use_coords: useCoordLink.value,
    })
  } catch (err) {
    error.value = err.message
    saving.value = false
  }
}

async function del() {
  saving.value = true
  await emit('delete', props.marker.id)
}
</script>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.modal {
  background: var(--surface);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  width: 420px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

h2 {
  font-size: 16px;
  font-weight: 700;
}

.close-btn {
  background: none;
  color: var(--text-2);
  padding: 4px 8px;
  font-size: 14px;
  border-radius: 4px;
}
.close-btn:hover { background: var(--surface-2); }

form {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex: 1;
  min-height: 0;
}

.edit-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  min-height: 0;
}

.field { margin-bottom: 14px; }
.field > label:first-child { margin-bottom: 8px; }
textarea { resize: vertical; }

/* ── View body ───────────────────────────────────────────── */
.view-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

/* Hero image */
.view-hero-wrap {
  position: relative;
  flex-shrink: 0;
}

.view-hero {
  width: 100%;
  height: 180px;
  object-fit: cover;
  display: block;
}

/* Image editor panel */
.image-editor {
  padding: 10px 20px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.img-search-row {
  display: flex;
  gap: 5px;
  align-items: center;
}

.img-search-input {
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  font-size: 13px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--text);
}

.img-results {
  margin-top: 2px;
}

.img-results-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.img-result-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  padding: 3px;
  border: 2px solid transparent;
  border-radius: 6px;
  background: var(--surface-2);
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
  overflow: hidden;
  text-align: left;
}
.img-result-card:hover { border-color: var(--accent); background: var(--border); }

.img-result-thumb {
  width: 100%;
  aspect-ratio: 4/3;
  object-fit: cover;
  border-radius: 4px;
  display: block;
}

.img-result-title {
  font-size: 10px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 2px 1px;
}

.img-no-result {
  font-size: 12px;
  color: var(--text-2);
  font-style: italic;
  padding: 4px 0;
}


/* Title & description */
.view-title-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 20px 0;
}

.view-title-row .visited-badge {
  margin-left: auto;
  flex-shrink: 0;
  margin-top: 2px;
}

.view-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
  line-height: 1.3;
}

.view-desc {
  font-size: 14px;
  color: var(--text-2);
  padding: 6px 20px 0;
  white-space: pre-wrap;
  line-height: 1.5;
}

.meta-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-2);
}

/* Tag chips */
.view-tags {
  padding: 12px 20px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tag-group { display: flex; flex-direction: column; gap: 5px; }

.tag-group-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-2);
}

.tag-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px 3px 7px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  background: none;
  color: var(--text);
  transition: opacity 0.12s, transform 0.1s;
  line-height: 1.4;
}
.chip:hover { opacity: 0.75; transform: scale(1.04); }
.chip:active { transform: scale(0.97); }

.chip-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.chip-pos {
  font-size: 10px;
  color: var(--text-2);
  margin-left: 1px;
}

/* Meta section */
.view-meta {
  padding: 12px 20px 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.visited-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  background: #dcfce7;
  color: #166534;
  border: 1px solid #bbf7d0;
  align-self: flex-start;
}

.meta-row {
  font-size: 13px;
  color: var(--text-2);
  line-height: 1.4;
}

.coords-text {
  font-family: monospace;
  font-size: 12px;
}

.open-maps-link {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  color: var(--accent);
  text-decoration: none;
  font-weight: 500;
}
.open-maps-link:hover { text-decoration: underline; }


/* Image field in edit mode */
.img-current {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  margin-bottom: 6px;
}

.img-current-thumb {
  height: 48px;
  width: 72px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
  display: block;
}

.img-current-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.img-url-row {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 6px;
}

.img-url-input {
  flex: 1;
  min-width: 0;
}

.img-google-btn {
  white-space: nowrap;
  flex-shrink: 0;
  text-decoration: none;
}

/* Shared form styles */
.color-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.color-swatch {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: none;
  box-shadow: none;
  padding: 0;
  cursor: pointer;
  transition: transform 0.1s;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.color-swatch:hover { transform: scale(1.15); }
.color-swatch.selected { outline: 2px solid var(--text); outline-offset: 2px; transform: scale(1.1); }
.color-swatch.inherit {
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text-2);
}
.color-swatch.inherit.selected { outline: 2px solid var(--text); }

.effective-color {
  margin-left: 4px;
  display: flex;
  align-items: center;
}

.checkbox-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  max-height: 120px;
  overflow-y: auto;
}

.checkbox-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  color: var(--text);
  cursor: pointer;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.empty-hint {
  font-size: 12px;
  color: var(--text-2);
}

.collection-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.stop-field {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.stop-label {
  font-size: 11px;
  color: var(--text-2);
  white-space: nowrap;
}

.stop-input {
  width: 48px;
  padding: 2px 5px;
  font-size: 12px;
  text-align: center;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--text);
}
.stop-input::-webkit-inner-spin-button,
.stop-input::-webkit-outer-spin-button { opacity: 0.5; }

.stop-warning {
  font-size: 13px;
  color: #f59e0b;
  cursor: default;
}

.coords {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-2);
}

.coords-mono { font-family: monospace; }

.coords-toggle {
  font-size: 12px;
  font-family: inherit;
  color: var(--text-2);
}

.visited-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.visited-date {
  flex: 1;
  min-width: 0;
}

.error {
  color: var(--danger);
  font-size: 13px;
  margin-bottom: 10px;
}

.modal-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 4px;
  padding: 12px 20px 20px;
  flex-shrink: 0;
  border-top: 1px solid var(--border);
}

/* In form mode the actions are pinned outside the scrollable area */
form .modal-actions {
  border-top: 1px solid var(--border);
  margin-top: 0;
}

.edit-error {
  padding: 0 20px;
  margin-bottom: 0;
}

.btn-sm {
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 6px;
}

.spacer { flex: 1; }

.btn-primary { background: var(--accent); color: #fff; font-weight: 600; }
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }

.btn-secondary { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); }
.btn-secondary:hover { background: var(--border); }

.btn-danger { background: none; color: var(--danger); border: 1px solid var(--danger); }
.btn-danger:hover:not(:disabled) { background: var(--danger); color: #fff; }

.btn-ghost { background: var(--surface-2); color: var(--text-2); border: 1px solid var(--border); }
.btn-ghost:hover { background: var(--border); color: var(--text); }

.btn-source-active { background: var(--accent) !important; color: #fff !important; border-color: var(--accent) !important; }

@media (max-width: 640px) {
  .overlay { align-items: stretch; padding: 0; }
  .modal {
    width: 100vw;
    max-width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
  }
  .modal-header { padding-top: calc(16px + var(--sat, 0px)); }
  .modal-actions { padding-bottom: calc(24px + var(--sab, 0px)); }
}
</style>
