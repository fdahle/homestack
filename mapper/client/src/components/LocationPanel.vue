<template>
  <Transition name="panel">
    <div v-if="open" class="location-panel" :class="{ 'is-poi': isPoi }">
      <div class="panel-header">
        <div class="header-main">
          <h2>{{ loading ? 'Looking up…' : (displayTitle || 'Location') }}</h2>
          <div v-if="!loading && categoryLabel" class="category-badge">
            <span>{{ categoryIcon }}</span>
            {{ categoryLabel }}
          </div>
        </div>
        <button class="close-btn" @click="$emit('close')">✕</button>
      </div>

      <div class="panel-body">
        <div v-if="loading" class="loading">
          <span class="spinner" />
          Fetching location info…
        </div>

        <div v-else class="info-rows">
          <!-- POI-specific rich fields -->
          <template v-if="isPoi">
            <div v-if="cuisine" class="info-row">
              <span class="info-label">Cuisine</span>
              <span class="info-value">{{ cuisine }}</span>
            </div>
            <div v-if="openingHours" class="info-row">
              <span class="info-label">Hours</span>
              <span class="info-value">{{ openingHours }}</span>
            </div>
            <div v-if="phone" class="info-row">
              <span class="info-label">Phone</span>
              <a class="info-value info-link" :href="`tel:${phone}`">{{ phone }}</a>
            </div>
            <div v-if="website" class="info-row">
              <span class="info-label">Website</span>
              <a class="info-value info-link" :href="website" target="_blank" rel="noopener">{{ websiteDisplay }}</a>
            </div>
          </template>

          <!-- Address fields (always shown) -->
          <div v-if="streetLine" class="info-row">
            <span class="info-label">Street</span>
            <span class="info-value">{{ streetLine }}</span>
          </div>
          <div v-if="cityLine" class="info-row">
            <span class="info-label">City</span>
            <span class="info-value">{{ cityLine }}</span>
          </div>
          <div v-if="countryLine" class="info-row">
            <span class="info-label">Country</span>
            <span class="info-value">{{ countryLine }}</span>
          </div>
          <div v-if="!streetLine && !cityLine && info?.display_name && !isPoi" class="info-row">
            <span class="info-label">Location</span>
            <span class="info-value">{{ info.display_name }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Coords</span>
            <span class="info-value mono">{{ latStr }}, {{ lngStr }}</span>
          </div>

          <!-- Inline hint while Overpass is still resolving -->
          <div v-if="poiLoading && !isPoi" class="poi-checking">
            <span class="spinner-sm" />
            Checking for nearby places…
          </div>
        </div>
      </div>

      <div class="panel-footer">
        <button
          class="btn-save"
          :disabled="loading"
          @click="$emit('save-as-marker', { latlng, suggestedLabel })"
        >
          + Save as Marker
        </button>
        <div class="footer-links">
          <a
            v-if="osmLink"
            :href="osmLink"
            target="_blank"
            rel="noopener"
            class="btn-link"
          >OSM ↗</a>
          <a
            :href="googleMapsLink"
            target="_blank"
            rel="noopener"
            class="btn-link"
          >Google Maps ↗</a>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  latlng: { type: Object, default: null },
  info: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  poiData: { type: Object, default: null },
  poiLoading: { type: Boolean, default: false },
})

defineEmits(['close', 'save-as-marker'])

const TYPE_ICONS = {
  restaurant: '🍽', cafe: '☕', bar: '🍺', pub: '🍺', fast_food: '🍔',
  hospital: '🏥', clinic: '🏥', pharmacy: '💊',
  school: '🎓', university: '🎓', college: '🎓', library: '📚',
  fuel: '⛽', parking: '🅿', bank: '🏦', atm: '💳',
  place_of_worship: '⛪',
  hotel: '🏨', hostel: '🏨', motel: '🏨', guest_house: '🏨',
  museum: '🏛', gallery: '🖼', attraction: '📍', viewpoint: '👁',
  park: '🌳', garden: '🌷', playground: '🎠', sports_centre: '🏋',
  peak: '⛰', beach: '🏖', water: '💧', wood: '🌲',
  supermarket: '🛒', mall: '🛍', bakery: '🥖', convenience: '🏪',
}

const CAT_ICONS = {
  amenity: '🏪', tourism: '📍', leisure: '🌳', natural: '🌿',
  shop: '🛍', highway: '🛣', historic: '🏛', landuse: '🏙',
  building: '🏢', waterway: '💧', railway: '🚂',
}

function fmt(s) { return s?.replace(/_/g, ' ') }
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s }

const isPoi = computed(() => !!props.poiData)

const categoryIcon = computed(() => {
  if (props.poiData) {
    return TYPE_ICONS[props.poiData.categoryValue] || CAT_ICONS[props.poiData.categoryKey] || '📌'
  }
  if (!props.info) return null
  return TYPE_ICONS[props.info.type] || CAT_ICONS[props.info.category] || '📌'
})

const categoryLabel = computed(() => {
  if (props.poiData) {
    const cat = cap(fmt(props.poiData.categoryKey))
    const typ = cap(fmt(props.poiData.categoryValue))
    if (typ && typ.toLowerCase() !== cat?.toLowerCase()) return `${cat} · ${typ}`
    return cat
  }
  if (!props.info?.category) return null
  const cat = cap(fmt(props.info.category))
  const typ = cap(fmt(props.info.type))
  if (typ && typ.toLowerCase() !== cat.toLowerCase()) return `${cat} · ${typ}`
  return cat
})

const displayTitle = computed(() => {
  if (props.poiData?.name) return props.poiData.name
  if (!props.info) return null
  return props.info.name || props.info.address?.road || null
})

// POI extra fields from Overpass tags
const cuisine = computed(() => {
  const c = props.poiData?.tags?.cuisine
  return c ? cap(fmt(c)) : null
})

const openingHours = computed(() => props.poiData?.tags?.opening_hours || null)

const phone = computed(() => {
  const t = props.poiData?.tags
  return t?.phone || t?.['contact:phone'] || null
})

const website = computed(() => {
  const t = props.poiData?.tags
  return t?.website || t?.['contact:website'] || null
})

const websiteDisplay = computed(() => {
  if (!website.value) return null
  try {
    const url = new URL(website.value)
    const host = url.hostname.replace(/^www\./, '')
    return host.length > 30 ? host.slice(0, 30) + '…' : host
  } catch {
    return website.value.slice(0, 30)
  }
})

// Address rows from Nominatim
const streetLine = computed(() => {
  const a = props.info?.address
  if (!a) return null
  const parts = [a.house_number, a.road].filter(Boolean)
  return parts.length ? parts.join(' ') : null
})

const cityLine = computed(() => {
  const a = props.info?.address
  if (!a) return null
  const city = a.city || a.town || a.village || a.hamlet || a.municipality
  const parts = [a.postcode, city].filter(Boolean)
  return parts.length ? parts.join(' ') : null
})

const countryLine = computed(() => props.info?.address?.country || null)

const latStr = computed(() => props.latlng?.lat.toFixed(5) ?? '')
const lngStr = computed(() => props.latlng?.lng.toFixed(5) ?? '')

// External links
const osmLink = computed(() => {
  if (props.poiData) {
    const typeMap = { node: 'node', way: 'way', relation: 'relation' }
    const t = typeMap[props.poiData.osmType]
    if (t) return `https://www.openstreetmap.org/${t}/${props.poiData.id}`
  }
  return null
})

const googleMapsLink = computed(() => {
  if (!props.latlng) return null
  const addr = props.info?.display_name
  return addr
    ? `https://www.google.com/maps?q=${encodeURIComponent(addr)}`
    : `https://www.google.com/maps?q=${props.latlng.lat},${props.latlng.lng}`
})

const suggestedLabel = computed(() => {
  if (props.poiData?.name) return props.poiData.name
  if (!props.info) return ''
  return props.info.name ||
    [props.info.address?.road, props.info.address?.city || props.info.address?.town]
      .filter(Boolean).join(', ') ||
    ''
})
</script>

<style scoped>
.location-panel {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 320px;
  background: var(--surface);
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.18);
  z-index: 1010;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

@media (max-width: 640px) {
  .location-panel { width: 100vw; }
}

/* Slide-in transition */
.panel-enter-active,
.panel-leave-active {
  transition: transform 0.22s ease;
}
.panel-enter-from,
.panel-leave-to {
  transform: translateX(-100%);
}

.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 20px 16px 14px;
  border-bottom: 1px solid var(--border);
  gap: 8px;
}

.is-poi .panel-header {
  border-left: 3px solid var(--accent);
  padding-left: 13px;
}

.header-main {
  flex: 1;
  min-width: 0;
}

h2 {
  font-size: 17px;
  font-weight: 700;
  line-height: 1.3;
  margin-bottom: 6px;
  word-break: break-word;
}

.category-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 2px 10px 2px 7px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.is-poi .category-badge {
  background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
  color: var(--accent);
}

.close-btn {
  background: none;
  color: var(--text-2);
  padding: 4px 7px;
  font-size: 14px;
  border-radius: 4px;
  flex-shrink: 0;
}
.close-btn:hover { background: var(--surface-2); color: var(--text); }

.panel-body {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
}

.loading {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-2);
  font-size: 14px;
}

.spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

.spinner-sm {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 1.5px solid var(--border);
  border-top-color: var(--text-2);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

.poi-checking {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-2);
  margin-top: 2px;
}

@keyframes spin { to { transform: rotate(360deg); } }

.info-rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.info-row {
  display: flex;
  gap: 12px;
  font-size: 14px;
  line-height: 1.4;
}

.info-label {
  color: var(--text-2);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  width: 56px;
  flex-shrink: 0;
  padding-top: 1px;
}

.info-value {
  color: var(--text);
  flex: 1;
  min-width: 0;
}

.info-link {
  color: var(--accent);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.info-link:hover { text-decoration: underline; }

.mono {
  font-family: monospace;
  font-size: 13px;
  color: var(--text-2);
}

.panel-footer {
  padding: 12px 16px 16px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.btn-save {
  width: 100%;
  background: var(--accent);
  color: #fff;
  font-weight: 600;
  font-size: 14px;
  padding: 10px;
  border-radius: var(--radius);
  border: none;
}
.btn-save:hover:not(:disabled) { background: var(--accent-hover); }
.btn-save:disabled { opacity: 0.5; cursor: default; }

.footer-links {
  display: flex;
  gap: 8px;
}

.btn-link {
  flex: 1;
  text-align: center;
  padding: 7px 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  text-decoration: none;
}
.btn-link:hover { color: var(--text); background: var(--surface); }
</style>
