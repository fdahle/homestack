import { ref, computed, watch } from 'vue'
import L from 'leaflet'
import { useMarkersStore } from '../stores/markers.js'
import { useCollectionsStore } from '../stores/collections.js'
import { safeHex } from '../utils/mapStyle.js'
import { fetchSegmentRoute } from './useTripRouting.js'
import { haversineMeters, formatDistance, formatDuration, summarizeLegs } from '../utils/trip.js'

const MODE_LABELS = { walk: 'walking', hike: 'hiking', bike: 'cycling', drive: 'driving' }

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

  const activeTrip = computed(() => {
    const filter = markersStore.activeGroupFilter
    if (filter?.type !== 'collection' || filter.id === '__none__') return null
    const col = collectionsStore.items.find((c) => c.id === filter.id)
    return col?.is_trip && (col.show_route_line || col.show_exact_route) ? col : null
  })

  const tripRouteMarkers = computed(() => {
    const col = activeTrip.value
    if (!col) return null
    return markersStore.filtered
      .map((m) => ({ m, pos: m.collections.find((c) => c.id === col.id)?.position ?? null }))
      .filter(({ pos }) => pos !== null)
      .sort((a, b) => a.pos - b.pos)
      .map(({ m }) => m)
  })

  // Re-route only when the stops, their coordinates or the route settings change,
  // not whenever any marker object is replaced.
  const tripRouteKey = computed(() => {
    const col = activeTrip.value
    const markers = tripRouteMarkers.value
    if (!col || !markers) return ''
    return JSON.stringify([col.id, col.color, col.show_route_line, col.show_exact_route, markers.map((m) => [m.id, m.lat, m.lng])])
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

  function addEditHandles(map, col, color, from, to, mode, viaPoints, routedPoly) {
    const edit = (newVia) => onEdit(col.id, from.id, to.id, mode, newVia, viaPoints)
    const point = (latlng) => ({ lat: +latlng.lat.toFixed(6), lng: +latlng.lng.toFixed(6) })
    const allWps = [{ lat: from.lat, lng: from.lng }, ...viaPoints, { lat: to.lat, lng: to.lng }]

    // Click on the routed line to insert a via-point between the nearest pair of waypoints
    routedPoly.on('click', (e) => {
      L.DomEvent.stopPropagation(e)
      let bestIdx = 0, bestDist = Infinity
      for (let k = 0; k < allWps.length - 1; k++) {
        const d = (e.latlng.lat - (allWps[k].lat + allWps[k + 1].lat) / 2) ** 2 + (e.latlng.lng - (allWps[k].lng + allWps[k + 1].lng) / 2) ** 2
        if (d < bestDist) { bestDist = d; bestIdx = k }
      }
      const newVia = [...viaPoints]
      newVia.splice(bestIdx, 0, point(e.latlng))
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

  async function render() {
    abort?.abort()
    abort = new AbortController()
    const signal = abort.signal
    const token = ++renderToken
    clear()
    tripSummary.value = null
    const col = activeTrip.value
    const markers = tripRouteMarkers.value
    if (!getMap() || !col || !markers || markers.length < 2) return

    const color = safeHex(col.color || '#3b82f6')
    const showStraight = !!col.show_route_line
    const showExact = !!col.show_exact_route

    let segmentMap
    try { segmentMap = await getSegments(col.id, signal) } catch (err) { if (!signal.aborted) routeError.value = err.message; return }
    if (token !== renderToken) return
    const legs = []

    for (let i = 0; i < markers.length - 1; i++) {
      const map = getMap()
      if (!map) return
      const from = markers[i]
      const to = markers[i + 1]
      const seg = segmentMap[`${from.id}-${to.id}`]
      const viaPoints = seg?.via_points || []
      const mode = seg?.mode || 'walk'
      const straightPath = [[from.lat, from.lng], [to.lat, to.lng]]
      const leg = { path: straightPath, distance: haversineMeters(from, to), duration: null }
      legs.push(leg)

      // Straight reference line
      if (showStraight) {
        polylines.push(L.polyline(straightPath, {
          color, weight: showExact ? 2 : 3, opacity: showExact ? 0.4 : 0.8, dashArray: showExact ? '6,5' : null,
        }).addTo(map))
      }
      if (!showExact) continue

      try {
        const route = await fetchSegmentRoute(from, to, viaPoints, mode, signal)
        Object.assign(leg, { path: route.path, distance: route.distance ?? leg.distance, duration: route.duration })
      } catch (err) { if (!signal.aborted) routeError.value = 'Route unavailable; showing a straight line. ' + err.message }
      if (token !== renderToken || !getMap()) return

      const routedPoly = L.polyline(leg.path, { color, weight: 4, opacity: 0.88 }).addTo(map)
      routedPoly.bindTooltip([formatDistance(leg.distance), formatDuration(leg.duration), MODE_LABELS[mode]].filter(Boolean).join(' · '), { sticky: true })
      polylines.push(routedPoly)
      if (onEdit) addEditHandles(map, col, color, from, to, mode, viaPoints, routedPoly)
    }
    if (token !== renderToken) return
    tripSummary.value = { name: col.name || 'Trip', stops: markers, legs, routed: showExact, ...summarizeLegs(legs) }
  }

  function dispose() {
    renderToken++
    abort?.abort()
    clear()
  }

  watch(tripRouteKey, () => render())

  return { tripSummary, routeError, render, dispose }
}
