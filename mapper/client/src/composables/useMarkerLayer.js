import { markerColors, safeHex, tooltipText } from '../utils/mapStyle.js'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import { useStyleStore } from '../stores/style.js'

const PIN_PATH = 'M11 0C4.9 0 0 4.9 0 11c0 8.25 11 21 11 21S22 19.25 22 11C22 4.9 17.1 0 11 0z'

// One icon per colour combination, shared by all markers using it. The clipPath ids derive from
// the colours, so the duplicated SVGs in the page define identical clips under each id.
const iconCache = new Map()
function pinIcon(colors) {
  const key = colors.map(safeHex).join(',')
  let icon = iconCache.get(key)
  if (!icon) iconCache.set(key, icon = makePinIcon(colors.map(safeHex), 'p' + key.replace(/[#,]/g, '')))
  return { icon, key }
}

function makePinIcon(colors, id) {
  const n = colors.length
  let defs = ''
  let paths = ''

  if (n === 1) {
    paths = `<path d="${PIN_PATH}" fill="${colors[0]}"/>`
  } else if (n === 2) {
    const [c1, c2] = colors
    defs = `<clipPath id="${id}_0"><rect x="0" y="0" width="11" height="32"/></clipPath>
            <clipPath id="${id}_1"><rect x="11" y="0" width="11" height="32"/></clipPath>`
    paths = `<path clip-path="url(#${id}_0)" d="${PIN_PATH}" fill="${c1}"/>
             <path clip-path="url(#${id}_1)" d="${PIN_PATH}" fill="${c2}"/>`
  } else if (n === 3) {
    // Three 120° pie slices centred at (11, 11). Angles in SVG coords (0=right, clockwise).
    // Starting from top (−90°): slice boundaries at −90°, 30°, 150°, 270°.
    const cx = 11, cy = 11, r = 60
    const angles = [-90, 30, 150, 270].map((deg) => {
      const rad = (deg * Math.PI) / 180
      return [+(cx + r * Math.cos(rad)).toFixed(2), +(cy + r * Math.sin(rad)).toFixed(2)]
    })
    for (let i = 0; i < 3; i++) {
      const [sx, sy] = angles[i]
      const [ex, ey] = angles[i + 1]
      const slicePath = `M ${cx} ${cy} L ${sx} ${sy} A ${r} ${r} 0 0 1 ${ex} ${ey} Z`
      defs += `<clipPath id="${id}_${i}"><path d="${slicePath}"/></clipPath>`
      paths += `<path clip-path="url(#${id}_${i})" d="${PIN_PATH}" fill="${colors[i]}"/>`
    }
  } else {
    // Four corner quadrants split at (11, 11)
    const clips = [
      `<rect x="0" y="0" width="11" height="11"/>`,
      `<rect x="11" y="0" width="11" height="11"/>`,
      `<rect x="0" y="11" width="11" height="21"/>`,
      `<rect x="11" y="11" width="11" height="21"/>`,
    ]
    for (let i = 0; i < 4; i++) {
      defs += `<clipPath id="${id}_${i}">${clips[i]}</clipPath>`
      paths += `<path clip-path="url(#${id}_${i})" d="${PIN_PATH}" fill="${colors[i]}"/>`
    }
  }

  return L.divIcon({
    className: '',
    html: `<svg width="22" height="32" viewBox="0 0 22 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      ${defs ? `<defs>${defs}</defs>` : ''}
      ${paths}
      <circle cx="11" cy="11" r="4.5" fill="white"/>
    </svg>`,
    iconSize: [22, 32],
    iconAnchor: [11, 32],
    tooltipAnchor: [0, -32],
  })
}

const labelOf = (m) => m.label || `(${m.lat.toFixed(4)}, ${m.lng.toFixed(4)})`

export function useMarkerLayer(getMap, onMarkerClick) {
  const leafletMarkers = new Map()
  // id -> { marker (data object last rendered), mode, iconKey, label }
  const snapshots = new Map()
  let clusterGroup = null
  const styleStore = useStyleStore()

  // Many markers are added and removed at once (filter switches), so the cluster group gets them
  // in bulk; chunkedLoading keeps the page responsive while it clusters thousands of pins.
  const newClusterGroup = () => L.markerClusterGroup({ maxClusterRadius: 40, chunkedLoading: true })

  function makeLeafletMarker(m, icon) {
    const marker = L.marker([m.lat, m.lng], { icon })
    marker.bindTooltip(tooltipText(labelOf(m)), { direction: 'top', offset: [0, -32] })
    // Bound once and reads the current data, so updates never touch the listeners: a bare
    // off('click') would also drop the handler Leaflet uses to show tooltips on touch devices.
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e)
      const current = snapshots.get(m.id)?.marker
      if (current) onMarkerClick(current)
    })
    return marker
  }

  function initClusterGroup(useClustering) {
    const map = getMap()
    if (!map) return

    if (clusterGroup) {
      clusterGroup.remove()
      clusterGroup = null
    }

    if (useClustering) {
      clusterGroup = newClusterGroup()
      map.addLayer(clusterGroup)
    }
  }

  function addAll(markers) {
    if (clusterGroup) clusterGroup.addLayers(markers)
    else markers.forEach((marker) => marker.addTo(getMap()))
  }

  function renderMarkers(markers) {
    const map = getMap()
    if (!map) return

    const ids = new Set(markers.map((m) => m.id))
    const removed = []
    for (const [id, marker] of leafletMarkers) {
      if (ids.has(id)) continue
      removed.push(marker)
      leafletMarkers.delete(id)
      snapshots.delete(id)
    }
    if (clusterGroup) clusterGroup.removeLayers(removed)
    else removed.forEach((marker) => marker.remove())

    const added = []
    const mode = styleStore.colorMode
    for (const m of markers) {
      const prev = snapshots.get(m.id)
      if (prev?.marker === m && prev.mode === mode) continue
      const { icon, key: iconKey } = pinIcon(markerColors(m, mode))
      const label = labelOf(m)
      snapshots.set(m.id, { marker: m, mode, iconKey, label })
      const existing = leafletMarkers.get(m.id)
      if (existing) {
        const pos = existing.getLatLng()
        if (pos.lat !== m.lat || pos.lng !== m.lng) existing.setLatLng([m.lat, m.lng])
        if (prev?.iconKey !== iconKey) existing.setIcon(icon)
        if (prev?.label !== label) existing.setTooltipContent(tooltipText(label))
      } else {
        const marker = makeLeafletMarker(m, icon)
        leafletMarkers.set(m.id, marker)
        added.push(marker)
      }
    }
    addAll(added)
  }

  function clearAll() {
    if (clusterGroup) {
      clusterGroup.clearLayers()
    } else {
      for (const marker of leafletMarkers.values()) marker.remove()
    }
    leafletMarkers.clear()
    snapshots.clear()
  }

  function reconfigureClustering(useClustering, currentMarkers) {
    const map = getMap()
    if (!map) return

    const markers = [...leafletMarkers.values()]

    if (clusterGroup) {
      clusterGroup.clearLayers()
      clusterGroup.remove()
      clusterGroup = null
    } else {
      for (const marker of markers) marker.remove()
    }

    if (useClustering) {
      clusterGroup = newClusterGroup()
      map.addLayer(clusterGroup)
    }
    addAll(markers)

    if (currentMarkers) renderMarkers(currentMarkers)
  }

  return { leafletMarkers, initClusterGroup, renderMarkers, clearAll, reconfigureClustering }
}
