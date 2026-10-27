import { ref, computed, watch } from 'vue'
import L from 'leaflet'
import { useMarkersStore } from '../stores/markers.js'
import { useCollectionsStore } from '../stores/collections.js'
import { safeHex } from '../utils/mapStyle.js'
import { settingsRevision } from '../utils/settings.js'
import { fetchSegmentRoute, getOrsApiKey } from './useTripRouting.js'
import { haversineMeters, formatDistance, formatDuration, summarizeLegs, viaInsertIndex } from '../utils/trip.js'

const MODE_LABELS = { walk: 'walking', hike: 'hiking', bike: 'cycling', drive: 'driving' }
// Legs are routed a few at a time: fast for long trips without hammering the public servers.
const ROUTE_CONCURRENCY = 3

// Draws the route of the trip collection currently selected in the sidebar.
// getSegments(collectionId, signal) resolves to { 'fromId-toId': { mode, via_points } }.
// Passing onEdit(collectionId, fromId, toId, mode, newViaPoints, previousViaPoints) makes
// via-points editable (click the line to add, drag to move, click a point to delete).
export function useTripRouteLayer(getMap, { getSegments, onEdit = null }) {
  const markersStore = useMarkersStore()
  const collectionsStore = useCollectionsStore()
  const tripSummary = ref(null)
  const routeError = ref('')
  let polylines = []
  let handles = []
  let renderToken = 0
  let abort = null
  let ownError = ''

  const activeTrip = computed(() => {
    const filter = markersStore.activeGroupFilter
    if (filter?.type !== 'collection' || filter.id === '__none__') return null
    const col = collectionsStore.items.find((c) => c.id === filter.id)
    return col?.is_trip && (col.show_route_line || col.show_exact_route) ? col : null
  })

  const tripRouteMarkers = computed(() => {
    const col = activeTrip.value
    if (!col) return null
    // All stops, also those hidden by refinements: legs and their saved via-points belong to
    // consecutive stops, so a route through only the shown ones would invent legs.
    return markersStore.items
      .map((m) => ({ m, pos: m.collections?.find((c) => c.id === col.id)?.position ?? null }))
      .filter(({ pos }) => pos !== null)
      .sort((a, b) => a.pos - b.pos)
      .map(({ m }) => m)
  })

  // Re-route only when the stops, their coordinates, the route settings, the saved legs
  // (routeRevision: modes and via-points) or the routing service change, not whenever any
  // marker object is replaced.
  const tripRouteKey = computed(() => {
    const col = activeTrip.value
    const markers = tripRouteMarkers.value
    if (!col || !markers) return ''
    settingsRevision.value
    const service = col.show_exact_route ? getOrsApiKey() : ''
    return JSON.stringify([col.id, col.color, col.show_route_line, col.show_exact_route, markersStore.routeRevision, service, markers.map((m) => [m.id, m.lat, m.lng])])
  })

  function clear() {
    polylines.forEach((p) => p.remove())
    handles.forEach((h) => h.remove())
    polylines = []
    handles = []
  }

  function handleIcon(html, size) {
    return L.divIcon({ className: '', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
  }

  function addEditHandles(map, col, color, leg, routedPoly) {
    const { from, to, mode, viaPoints } = leg
    const edit = (newVia) => onEdit(col.id, from.id, to.id, mode, newVia, viaPoints)
    const point = (latlng) => ({ lat: +latlng.lat.toFixed(6), lng: +latlng.lng.toFixed(6) })
    const allWps = [{ lat: from.lat, lng: from.lng }, ...viaPoints, { lat: to.lat, lng: to.lng }]

    // Click on the routed line to insert a via-point where the click lies along the drawn path
    routedPoly.on('click', (e) => {
      L.DomEvent.stopPropagation(e)
      const newVia = [...viaPoints]
      newVia.splice(viaInsertIndex(leg.path, viaPoints, e.latlng), 0, point(e.latlng))
      edit(newVia)
    })

    // Existing via-point handles: drag to move, click to delete
    viaPoints.forEach((vp, j) => {
      const handle = L.marker([vp.lat, vp.lng], {
        draggable: true,
        title: 'Drag to move · Click to delete',
        icon: handleIcon(`<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;cursor:grab;box-shadow:0 1px 5px rgba(0,0,0,0.45)"></div>`, 14),
      }).addTo(map)
      handle.on('dragend', (e) => edit(viaPoints.map((v, k) => k === j ? point(e.target.getLatLng()) : v)))
      handle.on('click', (ev) => { L.DomEvent.stopPropagation(ev); edit(viaPoints.filter((_, k) => k !== j)) })
      handles.push(handle)
    })

    // Ghost "add" handles at midpoints between consecutive waypoints
    for (let j = 0; j < allWps.length - 1; j++) {
      const handle = L.marker([(allWps[j].lat + allWps[j + 1].lat) / 2, (allWps[j].lng + allWps[j + 1].lng) / 2], {
        draggable: true,
        title: 'Drag to add a waypoint here',
        icon: handleIcon(`<div style="width:10px;height:10px;border-radius:50%;background:#fff;border:2px solid ${color};opacity:0.75;cursor:grab;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`, 10),
        zIndexOffset: -100,
      }).addTo(map)
      handle.on('dragend', (e) => {
        const newVia = [...viaPoints]
        newVia.splice(j, 0, point(e.target.getLatLng()))
        edit(newVia)
      })
      handles.push(handle)
    }
  }

  // Errors this layer reported itself are replaced on the next render; errors set by the caller
  // (e.g. a failed via-point save) stay until dismissed.
  function setError(message) {
    if (routeError.value === ownError) routeError.value = message
    ownError = message
  }

  async function render() {
    abort?.abort()
    abort = new AbortController()
    const signal = abort.signal
    const token = ++renderToken
    const stale = () => token !== renderToken || !getMap()
    clear()
    tripSummary.value = null
    setError('')
    const col = activeTrip.value
    const markers = tripRouteMarkers.value
    const map = getMap()
    if (!map || !col || !markers || markers.length < 2) return

    const color = safeHex(col.color || '#3b82f6')
    const showStraight = !!col.show_route_line
    const showExact = !!col.show_exact_route
    const legs = markers.slice(0, -1).map((from, i) => {
      const to = markers[i + 1]
      return { from, to, path: [[from.lat, from.lng], [to.lat, to.lng]], distance: haversineMeters(from, to), duration: null, mode: 'walk', viaPoints: [] }
    })
    const summarize = (routed) => { tripSummary.value = { name: col.name || 'Trip', stops: markers, legs, routed, ...summarizeLegs(legs) } }

    // Straight reference lines
    if (showStraight) {
      for (const leg of legs) {
        polylines.push(L.polyline(leg.path, {
          color, weight: showExact ? 2 : 3, opacity: showExact ? 0.4 : 0.8, dashArray: showExact ? '6,5' : null,
        }).addTo(map))
      }
    }
    if (!showExact) return summarize(false)

    let segmentMap
    try { segmentMap = await getSegments(col.id, signal) } catch (err) {
      if (stale() || signal.aborted) return
      setError('Could not load the trip legs; showing straight distances. ' + err.message)
      return summarize(false)
    }
    if (stale()) return

    const failures = []
    const warnings = new Set()
    async function routeLeg(leg) {
      const seg = segmentMap[`${leg.from.id}-${leg.to.id}`]
      leg.viaPoints = seg?.via_points || []
      leg.mode = seg?.mode || 'walk'
      try {
        const route = await fetchSegmentRoute(leg.from, leg.to, leg.viaPoints, leg.mode, signal)
        Object.assign(leg, { path: route.path, distance: route.distance ?? leg.distance, duration: route.duration })
        if (route.warning) warnings.add(route.warning)
      } catch (err) {
        if (signal.aborted) return
        failures.push(err.message)
      }
      if (stale()) return
      const routedPoly = L.polyline(leg.path, { color, weight: 4, opacity: 0.88 }).addTo(getMap())
      routedPoly.bindTooltip([formatDistance(leg.distance), formatDuration(leg.duration), MODE_LABELS[leg.mode]].filter(Boolean).join(' · '), { sticky: true })
      polylines.push(routedPoly)
      if (onEdit) addEditHandles(getMap(), col, color, leg, routedPoly)
    }

    let next = 0
    const worker = async () => { while (next < legs.length && !stale()) await routeLeg(legs[next++]) }
    await Promise.all(Array.from({ length: Math.min(ROUTE_CONCURRENCY, legs.length) }, worker))
    if (stale()) return

    if (failures.length) {
      const scope = failures.length === legs.length ? 'Route unavailable' : `${failures.length} of ${legs.length} legs could not be routed`
      setError(`${scope}; showing straight lines. ${failures[0]}`)
    } else if (warnings.size) setError([...warnings][0])
    summarize(failures.length < legs.length)
  }

  function dispose() {
    renderToken++
    abort?.abort()
    clear()
  }

  watch(tripRouteKey, () => render())
  watch(() => activeTrip.value?.id, () => { routeError.value = ''; ownError = '' })

  return { tripSummary, routeError, render, dispose }
}
