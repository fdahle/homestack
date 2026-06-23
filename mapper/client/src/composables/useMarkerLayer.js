import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import { useStyleStore } from '../stores/style.js'

const PIN_PATH = 'M11 0C4.9 0 0 4.9 0 11c0 8.25 11 21 11 21S22 19.25 22 11C22 4.9 17.1 0 11 0z'
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/
const FALLBACK_COLOR = '#6c757d'
function safeHex(color) {
  return HEX_COLOR_RE.test(color) ? color : FALLBACK_COLOR
}

let _pinId = 0

export function useMarkerLayer(getMap, onMarkerClick) {
  const leafletMarkers = new Map()
  let clusterGroup = null
  const styleStore = useStyleStore()

  function markerColors(m) {
    const fallback = '#6c757d'
    const mode = styleStore.colorMode
    if (mode === 'marker') {
      return [m.color || fallback]
    }
    if (mode === 'category') {
      const colors = (m.categories || []).map((c) => c.color).filter(Boolean)
      return colors.length ? colors.slice(0, 4) : [fallback]
    }
    if (mode === 'person') {
      const colors = (m.persons || []).map((p) => p.color).filter(Boolean)
      return colors.length ? colors.slice(0, 4) : [fallback]
    }
    // collection
    const colors = (m.collections || []).map((c) => c.color).filter(Boolean)
    return colors.length ? colors.slice(0, 4) : [fallback]
  }

  function makePinIcon(colors) {
    _pinId = (_pinId + 1) % 1000000
    const id = _pinId
    const n = colors.length
    let defs = ''
    let paths = ''

    if (n === 1) {
      paths = `<path d="${PIN_PATH}" fill="${safeHex(colors[0])}"/>`
    } else if (n === 2) {
      const [c1, c2] = colors.map(safeHex)
      defs = `<clipPath id="p${id}_0"><rect x="0" y="0" width="11" height="32"/></clipPath>
              <clipPath id="p${id}_1"><rect x="11" y="0" width="11" height="32"/></clipPath>`
      paths = `<path clip-path="url(#p${id}_0)" d="${PIN_PATH}" fill="${c1}"/>
               <path clip-path="url(#p${id}_1)" d="${PIN_PATH}" fill="${c2}"/>`
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
        defs += `<clipPath id="p${id}_${i}"><path d="${slicePath}"/></clipPath>`
        paths += `<path clip-path="url(#p${id}_${i})" d="${PIN_PATH}" fill="${safeHex(colors[i])}"/>`
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
        defs += `<clipPath id="p${id}_${i}">${clips[i]}</clipPath>`
        paths += `<path clip-path="url(#p${id}_${i})" d="${PIN_PATH}" fill="${safeHex(colors[i])}"/>`
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

  function makeLeafletMarker(m) {
    const marker = L.marker([m.lat, m.lng], {
      icon: makePinIcon(markerColors(m)),
    })

    marker.bindTooltip(m.label || `(${m.lat.toFixed(4)}, ${m.lng.toFixed(4)})`, {
      direction: 'top',
      offset: [0, -32],
    })

    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e)
      onMarkerClick(m)
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
      clusterGroup = L.markerClusterGroup({ maxClusterRadius: 40 })
      map.addLayer(clusterGroup)
    }
  }

  function renderMarkers(markers) {
    const map = getMap()
    if (!map) return

    const ids = new Set(markers.map((m) => m.id))

    for (const [id, marker] of leafletMarkers) {
      if (!ids.has(id)) {
        if (clusterGroup) clusterGroup.removeLayer(marker)
        else marker.remove()
        leafletMarkers.delete(id)
      }
    }

    for (const m of markers) {
      if (leafletMarkers.has(m.id)) {
        const marker = leafletMarkers.get(m.id)
        marker.setLatLng([m.lat, m.lng])
        marker.setIcon(makePinIcon(markerColors(m)))
        marker.setTooltipContent(m.label || `(${m.lat.toFixed(4)}, ${m.lng.toFixed(4)})`)
        marker.off('click')
        marker.on('click', (e) => { L.DomEvent.stopPropagation(e); onMarkerClick(m) })
      } else {
        const marker = makeLeafletMarker(m)
        if (clusterGroup) clusterGroup.addLayer(marker)
        else marker.addTo(map)
        leafletMarkers.set(m.id, marker)
      }
    }
  }

  function clearAll() {
    if (clusterGroup) {
      clusterGroup.clearLayers()
    } else {
      for (const marker of leafletMarkers.values()) marker.remove()
    }
    leafletMarkers.clear()
  }

  function reconfigureClustering(useClustering, currentMarkers) {
    const map = getMap()
    if (!map) return

    const markers = [...leafletMarkers.entries()]

    if (clusterGroup) {
      clusterGroup.clearLayers()
      clusterGroup.remove()
      clusterGroup = null
    } else {
      for (const [, marker] of markers) marker.remove()
    }

    if (useClustering) {
      clusterGroup = L.markerClusterGroup({ maxClusterRadius: 40 })
      map.addLayer(clusterGroup)
    }

    for (const [, marker] of markers) {
      if (clusterGroup) clusterGroup.addLayer(marker)
      else marker.addTo(map)
    }

    if (currentMarkers) renderMarkers(currentMarkers)
  }

  return { leafletMarkers, initClusterGroup, renderMarkers, clearAll, reconfigureClustering }
}
