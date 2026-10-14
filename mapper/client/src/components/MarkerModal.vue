<template>
  <div class="overlay" @mousedown="onOverlayMousedown" @click="onOverlayClick">
    <div ref="dialogEl" class="modal" role="dialog" aria-modal="true" aria-labelledby="marker-modal-title" tabindex="-1">
      <div class="modal-header">
        <h2 id="marker-modal-title">{{ viewing ? (form.label || 'Marker') : isEdit ? 'Edit Marker' : 'Add Marker' }}</h2>
        <div class="header-actions">
          <button
            v-if="viewing && !props.readOnly && styleStore.showRatings"
            type="button"
            class="fav-btn"
            :class="{ active: form.is_favorite }"
            :aria-pressed="!!form.is_favorite"
            :title="form.is_favorite ? 'Remove from favorites' : 'Add to favorites'"
            @click="toggleFavorite"
          >♥</button>
          <button
            v-if="viewing"
            type="button"
            class="share-btn"
            :class="{ done: shareCopied }"
            :aria-label="shareCopied ? 'Copied' : 'Share this place'"
            :title="shareCopied ? 'Copied to clipboard' : 'Share this place'"
            @click="sharePlace"
          ><AppIcon :name="shareCopied ? 'check' : 'share'" /></button>
          <button class="close-btn" aria-label="Close" @click="requestClose"><AppIcon name="close" /></button>
        </div>
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
        <div v-if="(styleStore.showRatings && (form.rating || (props.readOnly && form.is_favorite))) || (form.planned_at && !form.visited_at)" class="view-badges">
          <span v-if="styleStore.showRatings && props.readOnly && form.is_favorite" class="fav-badge">♥ Favorite</span>
          <span v-if="styleStore.showRatings && form.rating" class="rating-stars" :title="`Rated ${form.rating} of 5`" :aria-label="`Rated ${form.rating} of 5`">{{ '★'.repeat(form.rating) }}<span class="stars-off">{{ '★'.repeat(5 - form.rating) }}</span></span>
          <span v-if="form.planned_at && !form.visited_at" class="planned-badge">Planned · {{ form.planned_at }}</span>
        </div>
        <p v-if="form.description" class="view-desc">{{ form.description }}</p>
        <p v-if="viewing && error" class="error view-error">{{ error }}</p>

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
                {{ styleStore.firstNameOnly ? (person.first_name || person.name) : person.name }}
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
          <div v-if="safeExternalUrl" class="meta-row">
            <a :href="safeExternalUrl" target="_blank" rel="noopener noreferrer" class="open-maps-link">{{ externalHost }} <AppIcon name="externalLink" /></a>
          </div>
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
        <button type="button" class="btn-secondary" @click="requestClose">Close</button>
        <button v-if="!props.readOnly" type="button" class="btn-primary" @click="startEdit">Edit</button>
      </div>

      <!-- Edit / create form -->
      <form v-else @submit.prevent="save">
        <div class="edit-body">
        <div class="field">
          <label for="marker-label">Label</label>
          <input id="marker-label" v-model="form.label" type="text" placeholder="e.g. Eiffel Tower" />
        </div>

        <div class="field">
          <label for="marker-description">Description</label>
          <textarea id="marker-description" v-model="form.description" rows="3" placeholder="Notes about this place…" />
        </div>

        <div class="field">
          <label for="marker-visited">Visited</label>
          <div class="visited-row">
            <label class="checkbox-item" style="margin:0">
              <input id="marker-visited" type="checkbox" v-model="visitedChecked" style="width:auto" />
              Yes
            </label>
            <input v-model="visitedDate" type="date" class="visited-date" aria-label="Visited on" :style="{ visibility: visitedChecked ? 'visible' : 'hidden' }" />
          </div>
        </div>

        <div v-if="!visitedChecked" class="field">
          <label for="marker-planned">Planned for <span class="optional">(wishlist)</span></label>
          <input id="marker-planned" v-model="form.planned_at" type="date" />
        </div>

        <div v-if="styleStore.showRatings" class="field rating-fav-row">
          <div>
            <span class="field-label">Rating</span>
            <div class="rating-input" role="group" aria-label="Rating">
              <button
                v-for="n in 5"
                :key="n"
                type="button"
                :class="{ on: (form.rating || 0) >= n }"
                :aria-label="`${n} of 5`"
                :aria-pressed="form.rating === n"
                :title="form.rating === n ? 'Click again to clear' : `${n} of 5`"
                @click="form.rating = form.rating === n ? null : n"
              >★</button>
            </div>
          </div>
          <label class="checkbox-item fav-check">
            <input type="checkbox" v-model="form.is_favorite" style="width:auto" />
            ♥ Favorite
          </label>
        </div>

        <div class="field">
          <span class="field-label">Image</span>
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
                aria-label="Image search"
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
              <input v-model="form.image_url" type="text" inputmode="url" aria-label="Image URL" placeholder="Paste image URL…" class="img-url-input" />
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
          <span id="marker-collections-label" class="field-label">Collections</span>
          <div class="checkbox-list" role="group" aria-labelledby="marker-collections-label">
            <template v-for="(col, i) in collectionChoices.items" :key="col.id">
            <hr v-if="i > 0 && i === collectionChoices.recentCount" class="recent-divider" />
            <div class="collection-row">
              <label class="checkbox-item">
                <input
                  type="checkbox"
                  :value="col.id"
                  v-model="form.collection_ids"
                  style="width:auto"
                  @change="onCollectionToggle(col, $event.target.checked)"
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
                  :aria-label="`Stop number in ${col.name}`"
                  :value="form.collection_positions[col.id] ?? ''"
                  @input="setPosition(col.id, $event.target.value)"
                  placeholder="–"
                />
                <span v-if="hasDuplicate(col.id)" class="stop-warning" title="This stop number is already used in this trip">⚠</span>
              </div>
            </div>
            </template>
            <span v-if="collectionsStore.items.length === 0" class="empty-hint">No collections yet</span>
          </div>
        </div>

        <div class="field">
          <span id="marker-categories-label" class="field-label">Categories</span>
          <div class="checkbox-list" role="group" aria-labelledby="marker-categories-label">
            <template v-for="(cat, i) in categoryChoices.items" :key="cat.id">
              <hr v-if="i > 0 && i === categoryChoices.recentCount" class="recent-divider" />
              <label class="checkbox-item">
                <input type="checkbox" :value="cat.id" v-model="form.category_ids" style="width:auto" />
                <span class="dot" :style="{ background: cat.color }" />
                {{ cat.name }}
              </label>
            </template>
            <span v-if="categoriesStore.items.length === 0" class="empty-hint">No categories yet</span>
          </div>
        </div>

        <div class="field">
          <span id="marker-persons-label" class="field-label">With</span>
          <div class="checkbox-list" role="group" aria-labelledby="marker-persons-label">
            <template v-for="(person, i) in personChoices.items" :key="person.id">
              <hr v-if="i > 0 && i === personChoices.recentCount" class="recent-divider" />
              <label class="checkbox-item">
                <input type="checkbox" :value="person.id" v-model="form.person_ids" style="width:auto" />
                <span class="dot" :style="{ background: person.color }" />
                {{ person.name }}
              </label>
            </template>
            <span v-if="personsStore.items.length === 0" class="empty-hint">No persons yet</span>
          </div>
        </div>

        <div class="field">
          <span id="marker-color-label" class="field-label">Color</span>
          <div class="color-row" role="group" aria-labelledby="marker-color-label">
            <button
              type="button"
              class="color-swatch inherit"
              :class="{ selected: !form.color }"
              @click="form.color = ''"
              title="Inherit from category"
              aria-label="Inherit from category"
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
              :aria-label="`Color ${c}`"
              @click="form.color = c"
            />
            <span class="effective-color">
              <span class="dot" :style="{ background: effectiveColor }" />
            </span>
          </div>
        </div>

        <div class="field">
          <label for="marker-address">Address <span v-if="useCoordLink" class="optional">(not saved while "use coords" is on)</span></label>
          <input id="marker-address" v-model="form.address" type="text" :disabled="useCoordLink" :placeholder="addressLoading ? 'Fetching address…' : 'e.g. 123 Main St, City'" />
        </div>

        <div class="field">
          <label for="marker-website">Website</label>
          <input id="marker-website" v-model="form.external_url" type="text" inputmode="url" placeholder="https://…" />
        </div>

        <div class="field coords">
          <span class="coords-mono">{{ latStr }}, {{ lngStr }}</span>
          <button v-if="isEdit && !props.readOnly" type="button" class="btn-ghost btn-sm move-btn" title="Move this marker on the map" @click="startMove">Move…</button>
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
              <button type="button" class="btn-ghost" aria-label="Keep marker" title="Keep marker" @click="confirmDelete = false"><AppIcon name="close" /></button>
            </template>
          </template>
          <div class="spacer" />
          <button type="button" class="btn-secondary" @click="isEdit ? backToView() : requestClose()">
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
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { copyText } from '../utils/clipboard.js'
import { useCategoriesStore } from '../stores/categories.js'
import { useCollectionsStore } from '../stores/collections.js'
import { usePersonsStore } from '../stores/persons.js'
import { useMarkersStore } from '../stores/markers.js'
import { useStyleStore } from '../stores/style.js'
import { reverseGeocode, formatAddress, countryName } from '../utils/nominatim.js'
import { rememberPicks, recentPicks, recentFirst } from '../utils/recentPicks.js'
import { normalizeUrl, parseWikipediaTag } from '../utils/url.js'
import { useDialog } from '../composables/useDialog.js'

const COLOR_PRESETS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']

const props = defineProps({
  marker: { type: Object, default: null },
  latlng: { type: Object, default: null },
  suggestedLabel: { type: String, default: '' },
  // New markers from a place: { external_url, wikipedia ('lang:Title'), address, country }
  prefill: { type: Object, default: null },
  readOnly: { type: Boolean, default: false },
  saveMarker: { type: Function, default: null },
  deleteMarker: { type: Function, default: null },
})
const emit = defineEmits(['close', 'move'])

const categoriesStore = useCategoriesStore()
const collectionsStore = useCollectionsStore()
const personsStore = usePersonsStore()
const markersStore = useMarkersStore()
const styleStore = useStyleStore()

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
const imageSearchQuery = ref('')
const imageSearchLoading = ref(false) // false | 'wiki' | 'commons'
const imageResults = ref(null) // null | [{ url, title }]
const imageChangeMode = ref(false)
const imageResultsSource = ref(null) // null | 'wiki' | 'commons'
const imageResultsQuery = ref(null) // the query the shown results belong to

const form = ref({
  label: '',
  description: '',
  image_url: '',
  category_ids: [],
  collection_ids: [],
  collection_positions: {},
  person_ids: [],
  visited_at: '',
  planned_at: '',
  rating: null,
  is_favorite: false,
  external_url: '',
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

// Recently picked entries come first, above a divider; the order is fixed while the form is open.
const recent = recentPicks()
const collectionChoices = computed(() => recentFirst(collectionsStore.items, recent.collection_ids))
const categoryChoices = computed(() => recentFirst(categoriesStore.items, recent.category_ids))
const personChoices = computed(() => recentFirst(personsStore.items, recent.person_ids))

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

// The date stays in its (hidden) field while Visited is unticked, so ticking it again restores
// the date; an unticked Visited is only applied on save.
watch([visitedChecked, visitedDate], ([checked, date]) => {
  form.value.visited_at = checked ? date || 'yes' : ''
})

// ── Unsaved changes ─────────────────────────────────────────
// A copy of the editable state taken when editing starts; Back restores it.
let snapshot = null
const draft = () => JSON.parse(JSON.stringify({ form: form.value, visitedChecked: visitedChecked.value, visitedDate: visitedDate.value, useCoordLink: useCoordLink.value }))
// visited_at is derived from the two visited fields, and positions only count for ticked collections.
const draftKey = ({ form: f, ...rest }) => JSON.stringify({
  ...rest,
  form: { ...f, visited_at: null, collection_positions: f.collection_ids.map(id => f.collection_positions[id] ?? null) },
})
const isDirty = () => !viewing.value && !props.readOnly && snapshot !== null && draftKey(draft()) !== draftKey(snapshot)
function takeSnapshot() { snapshot = draft() }

// Lookups that finish after editing started fill untouched fields without counting as a change.
function autoFill(key, value) {
  if (snapshot && snapshot.form[key] === form.value[key]) snapshot.form[key] = value
  form.value[key] = value
}

const dialogEl = ref(null)
const { requestClose, confirmLeave, onOverlayMousedown, onOverlayClick } = useDialog(dialogEl, { close: () => emit('close'), isDirty })

function startEdit() {
  viewing.value = false
  confirmDelete.value = false
  takeSnapshot()
}

function backToView() {
  if (!confirmLeave()) return
  if (snapshot) {
    form.value = snapshot.form
    visitedChecked.value = snapshot.visitedChecked
    visitedDate.value = snapshot.visitedDate
    useCoordLink.value = snapshot.useCoordLink
  }
  snapshot = null
  error.value = null
  imageChangeMode.value = false
  confirmDelete.value = false
  viewing.value = true
}

// MapView closes this form to show the move pin, which would drop unsaved edits.
function startMove() {
  if (confirmLeave('Moving the marker discards your unsaved changes. Continue?')) emit('move', props.marker)
}

// Groups preselected from the active filter were not picked by the user.
const preselected = { collection_ids: [], category_ids: [], person_ids: [] }

// A marker newly ticked into a trip becomes its next stop.
function nextFreeStop(collectionId) {
  let max = 0
  for (const m of markersStore.items) {
    if (m.id === props.marker?.id) continue
    for (const c of m.collections ?? []) if (c.id === collectionId && c.position > max) max = c.position
  }
  return max + 1
}
function onCollectionToggle(col, checked) {
  if (!checked || !col.is_trip || form.value.collection_positions[col.id] != null) return
  if (props.marker?.collections?.some((c) => c.id === col.id)) return // keeps an existing stop (or exclusion) when re-ticked
  setPosition(col.id, String(nextFreeStop(col.id)))
}

// Closing the modal cancels a queued address lookup so it does not hold up later ones.
const lookup = new AbortController()
onUnmounted(() => lookup.abort())

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
      planned_at: props.marker.planned_at || '',
      rating: props.marker.rating ?? null,
      is_favorite: !!props.marker.is_favorite,
      external_url: props.marker.external_url || '',
      color: props.marker.color || '',
      address: props.marker.address || '',
      lat: props.marker.lat,
      lng: props.marker.lng,
    }
    visitedChecked.value = !!props.marker.visited_at
    visitedDate.value = (props.marker.visited_at && props.marker.visited_at !== 'yes') ? props.marker.visited_at.slice(0, 10) : ''
    useCoordLink.value = !!props.marker.use_coords

    imageSearchQuery.value = form.value.label
    // Markers with a stored address need no lookup (keeps Nominatim traffic low, also for share viewers).
    if (form.value.address) return
    addressLoading.value = true
    try {
      const data = await reverseGeocode(props.marker.lat, props.marker.lng, { addressdetails: 1, namedetails: 1 }, { signal: lookup.signal })
      const geocoded = formatAddress(data.address) || null
      addressLine.value = geocoded
      if (!useCoordLink.value && !form.value.address && geocoded) autoFill('address', geocoded)
      // Pre-fill the image search query with the place name for later use
      if (!imageSearchQuery.value) imageSearchQuery.value = data.namedetails?.['name:en'] || data.namedetails?.name || data.name || ''
    } catch { /* silent */ }
    finally { addressLoading.value = false }
  } else if (props.latlng) {
    form.value.lat = props.latlng.lat
    form.value.lng = props.latlng.lng
    form.value.label = props.suggestedLabel || ''
    imageSearchQuery.value = props.suggestedLabel || ''
    const prefill = props.prefill ?? {}
    if (prefill.external_url) form.value.external_url = prefill.external_url
    if (prefill.address) form.value.address = prefill.address
    if (prefill.country) form.value.country = prefill.country
    if (prefill.wikipedia) suggestWikipediaImage(prefill.wikipedia)
    const gf = markersStore.activeGroupFilter
    const key = { category: 'category_ids', collection: 'collection_ids', person: 'person_ids' }[gf?.type]
    if (key && gf.id !== '__none__') {
      form.value[key] = [gf.id]
      preselected[key] = [gf.id]
      const col = key === 'collection_ids' && collectionsStore.items.find((c) => c.id === gf.id)
      if (col) onCollectionToggle(col, true)
    }
    takeSnapshot()

    // The location panel already looked up this point: no second request needed.
    if (form.value.address && form.value.country) return
    addressLoading.value = true
    try {
      const data = await reverseGeocode(props.latlng.lat, props.latlng.lng, { addressdetails: 1 }, { signal: lookup.signal })
      const geocoded = formatAddress(data.address) || null
      if (!form.value.address && geocoded) autoFill('address', geocoded)
      // Stored now so statistics never need to look it up later.
      const country = countryName(data.address)
      if (country) autoFill('country', country)
    } catch { /* silent */ }
    finally { addressLoading.value = false }
  }
})

// Only http(s) links are rendered, whatever was stored.
const safeExternalUrl = computed(() => {
  try {
    const url = new URL(form.value.external_url)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch { return null }
})
const externalHost = computed(() => safeExternalUrl.value ? new URL(safeExternalUrl.value).hostname.replace(/^www\./, '') : '')

async function toggleFavorite() {
  const next = !form.value.is_favorite
  form.value.is_favorite = next
  error.value = null
  try { await markersStore.update(props.marker.id, { is_favorite: next }) }
  catch (err) { form.value.is_favorite = !next; error.value = err.message }
}

const latStr = computed(() => Number(form.value.lat).toFixed(5))
const lngStr = computed(() => Number(form.value.lng).toFixed(5))

const googleMapsHref = computed(() => {
  const label = form.value.label?.trim()
  if (label && !useCoordLink.value) return `https://www.google.com/maps/search/${encodeURIComponent(label)}/@${latStr.value},${lngStr.value},17z`
  return `https://www.google.com/maps?q=${latStr.value},${lngStr.value}`
})

function setPosition(collectionId, value) {
  const num = value === '' ? null : parseInt(value, 10)
// Shares one place without creating a share link: the phone's share sheet where available,
// otherwise name, address and map link go to the clipboard.
const shareCopied = ref(false)
let shareCopiedTimer = null
onUnmounted(() => clearTimeout(shareCopiedTimer))
async function sharePlace() {
  error.value = null
  const title = form.value.label?.trim() || 'Place'
  const address = form.value.address || addressLine.value || ''
  const url = googleMapsHref.value
  if (navigator.share) {
    try { return await navigator.share({ title, text: [title, address].filter(Boolean).join('\n'), url }) }
    catch (err) { if (err.name === 'AbortError') return } // closed by the user; other errors fall back to copying
  }
  try {
    await copyText([title, address, url].filter(Boolean).join('\n'))
    shareCopied.value = true
    clearTimeout(shareCopiedTimer)
    shareCopiedTimer = setTimeout(() => { shareCopied.value = false }, 2000)
  } catch {
    error.value = `Could not copy automatically. Map link: ${url}`
  }
}

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

// Clicking the active source again hides its results, unless the query changed since: then it searches anew.
function toggleOff(source, q) {
  if (imageResultsSource.value !== source || q !== imageResultsQuery.value) return false
  imageResults.value = null
  imageResultsSource.value = null
  return true
}

async function searchWiki() {
  const q = imageSearchQuery.value.trim()
  if (toggleOff('wiki', q) || !q) return
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
    imageResultsQuery.value = q
  } catch { imageResults.value = [] }
  finally { imageSearchLoading.value = false }
}

async function searchCommons() {
  const q = imageSearchQuery.value.trim()
  if (toggleOff('commons', q) || !q) return
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
    imageResultsQuery.value = q
  } catch { imageResults.value = [] }
  finally { imageSearchLoading.value = false }
}

// Offers the lead image of the place's Wikipedia article (any language) as a suggestion.
async function suggestWikipediaImage(tag) {
  const { lang, title } = parseWikipediaTag(tag) ?? {}
  if (!lang) return
  if (!imageSearchQuery.value) imageSearchQuery.value = title
  try {
    const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&pithumbsize=400&format=json&origin=*`, { signal: lookup.signal })
    const page = Object.values((await res.json()).query?.pages ?? {})[0]
    if (page?.thumbnail?.source && !form.value.image_url && imageResults.value === null) {
      imageResults.value = [{ url: page.thumbnail.source, title: page.title }]
      imageResultsSource.value = 'wiki'
      imageResultsQuery.value = null // not a search of the query field: clicking Wiki searches
    }
  } catch { /* the suggestion is optional */ }
}

function selectImage(url) {
  form.value.image_url = url
  imageResults.value = null
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
    await props.saveMarker({
      ...form.value,
      collection_positions: Object.fromEntries(form.value.collection_ids.map(id => [id, form.value.collection_positions[id] ?? null])),
      color: form.value.color || null,
      image_url: normalizeUrl(form.value.image_url),
      address: useCoordLink.value ? null : form.value.address || null,
      planned_at: visitedChecked.value ? null : form.value.planned_at || null,
      external_url: normalizeUrl(form.value.external_url),
      use_coords: useCoordLink.value,
    })
    rememberPicks(form.value, {
      collection_ids: [...(props.marker?.collections?.map((c) => c.id) ?? []), ...preselected.collection_ids],
      category_ids: [...(props.marker?.categories?.map((c) => c.id) ?? []), ...preselected.category_ids],
      person_ids: [...(props.marker?.persons?.map((p) => p.id) ?? []), ...preselected.person_ids],
    })
  } catch (err) {
    error.value = err.message
  } finally { saving.value = false }
}

async function del() {
  saving.value = true
  error.value = null
  try { await props.deleteMarker(props.marker.id) }
  catch (err) { error.value = err.message }
  finally { saving.value = false }
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
  max-height: calc(100dvh - 32px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.modal:focus { outline: none; }

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

.header-actions { display: flex; align-items: center; gap: 4px; }
.fav-btn {
  background: none;
  color: var(--text-2);
  font-size: 20px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 4px;
  opacity: 0.6;
}
.fav-btn:hover { background: var(--surface-2); opacity: 1; }
.fav-btn.active { color: #e11d48; opacity: 1; }

.view-badges {
.share-btn {
  display: flex;
  align-items: center;
  background: none;
  color: var(--text-2);
  padding: 4px 6px;
  border-radius: 4px;
}
.share-btn:hover { background: var(--surface-2); color: var(--text); }
.share-btn.done { color: var(--accent); }
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 20px 0;
}
.rating-stars { color: #f59e0b; font-size: 15px; letter-spacing: 1px; }
.rating-stars .stars-off { color: var(--border); }
.fav-badge, .planned-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
}
.fav-badge { background: #ffe4e6; color: #9f1239; }
.planned-badge { background: #e0f2fe; color: #075985; }
.view-error { padding: 6px 20px 0; }

.rating-fav-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}
/* Same look as the global form label, for a group without a single input */
.field-label { display: block; font-size: 12px; font-weight: 600; color: var(--text-2); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }
.rating-input { display: flex; gap: 2px; }
.rating-input button {
  background: none;
  border: none;
  padding: 0 2px;
  font-size: 22px;
  line-height: 1;
  color: var(--border);
  cursor: pointer;
}
.rating-input button.on { color: #f59e0b; }
.fav-check { margin: 0; white-space: nowrap; }
.optional { font-weight: 400; color: var(--text-2); font-size: 12px; }

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
.field > label:first-child,
.field > .field-label:first-child { margin-bottom: 8px; }
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

.recent-divider {
  border: none;
  border-top: 1px dashed var(--border);
  margin: 2px 0;
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
.move-btn { margin-left: auto; margin-right: 8px; }

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
