import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { createPinia, setActivePinia } from 'pinia'
import { useMarkersStore } from '../src/stores/markers.js'
import { useCategoriesStore } from '../src/stores/categories.js'
import { useCollectionsStore } from '../src/stores/collections.js'
import { useImportExport } from '../src/composables/useImportExport.js'
import { parsePlaces, detectFormat, htmlToText, readKmz } from '../src/utils/geoImport.js'

// Node has no DOMParser. This stand-in builds just the part of the DOM the parsers use
// (documentElement, children, localName, textContent, getAttribute, parsererror) and,
// like the browser's, reports malformed XML instead of guessing.
class MiniElement {
  constructor(name, attrs) {
    this.localName = name.slice(name.indexOf(':') + 1)
    this.tagName = name
    this.attrs = attrs
    this.children = []
    this.nodes = []
  }
  getAttribute(name) { return this.attrs.get(name) ?? null }
  get textContent() { return this.nodes.map(n => typeof n === 'string' ? n : n.textContent).join('') }
}
const XML_ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
function decodeXml(text) {
  return text.replace(/&([^;]*);?/g, (match, code) => {
    if (!match.endsWith(';')) throw new Error('Bad entity')
    if (code[0] === '#') return String.fromCodePoint(code[1] === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10))
    if (!(code in XML_ENTITIES)) throw new Error('Unknown entity')
    return XML_ENTITIES[code]
  })
}
function parseXmlTree(text) {
  const token = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>|([^<]+)/y
  const stack = []
  let root = null
  while (token.lastIndex < text.length) {
    const at = token.lastIndex
    const m = token.exec(text)
    if (!m) throw new Error('Unexpected markup at ' + at)
    const [, cdata, close, open, attrText, selfClosing, chars] = m
    const parent = stack.at(-1)
    if (cdata != null) { if (!parent) throw new Error('CDATA outside root'); parent.nodes.push(cdata) }
    else if (chars != null) {
      if (parent) parent.nodes.push(decodeXml(chars))
      else if (chars.trim()) throw new Error('Text outside root')
    } else if (close) {
      if (stack.pop()?.tagName !== close) throw new Error('Mismatched </' + close + '>')
    } else if (open) {
      if (!parent && root) throw new Error('Two root elements')
      const attrs = new Map([...attrText.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(a => [a[1], decodeXml(a[2] ?? a[3])]))
      const el = new MiniElement(open, attrs)
      if (parent) { parent.children.push(el); parent.nodes.push(el) } else root = el
      if (!selfClosing) stack.push(el)
    }
  }
  if (!root || stack.length) throw new Error('Unclosed element')
  return root
}
class MiniDOMParser {
  parseFromString(text) {
    try {
      const root = parseXmlTree(text)
      return { documentElement: root, getElementsByTagName: () => [] }
    } catch {
      const error = new MiniElement('parsererror', new Map())
      return { documentElement: error, getElementsByTagName: name => name === 'parsererror' ? [error] : [] }
    }
  }
}
const parse = (text, name) => parsePlaces(text, name, { DOMParser: MiniDOMParser })

// A minimal zip writer (CRCs are not checked by readKmz).
function zip(files) {
  const locals = [], centrals = []
  let offset = 0
  for (const { name, text, store = false } of files) {
    const raw = Buffer.from(text), data = store ? raw : deflateRawSync(raw), nameBytes = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(store ? 0 : 8, 8)
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(store ? 0 : 8, 10)
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42)
    locals.push(local, nameBytes, data)
    centrals.push(central, nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  const buffer = Buffer.concat([...locals, directory, end])
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length)
}

// Shaped like a Google My Maps export: layers as Folders, data columns in ExtendedData and
// repeated as HTML in the description, photos in gx_media_links, shapes next to points.
const MY_MAPS_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document>
    <name>Lisbon trip</name>
    <description/>
    <Style id="icon-1899-0288D1-normal"><IconStyle><scale>1</scale></IconStyle></Style>
    <Folder>
      <name>Food &amp; drinks</name>
      <Placemark>
        <name>Pastéis de Belém</name>
        <description><![CDATA[Best <b>pastel de nata</b><br>Open daily<br><img src="https://example.com/x.jpg" onerror="alert(1)"><script>alert(2)</script>]]></description>
        <styleUrl>#icon-1899-0288D1</styleUrl>
        <ExtendedData>
          <Data name="gx_media_links"><value><![CDATA[https://mymaps.usercontent.google.com/hostedimage/abc]]></value></Data>
          <Data name="Website"><value>https://pasteisdebelem.pt</value></Data>
        </ExtendedData>
        <Point><coordinates>
          -9.2032,38.6975,0
        </coordinates></Point>
      </Placemark>
      <Placemark>
        <name>Time Out Market</name>
        <ExtendedData>
          <Data name="Adresse"><value>Av. 24 de Julho 49, Lisboa</value></Data>
          <Data name="Rating"><value>5</value></Data>
          <Data name="Note"><value>&lt;i&gt;crowded&lt;/i&gt; at noon</value></Data>
        </ExtendedData>
        <Point><coordinates>-9.1458,38.7069</coordinates></Point>
      </Placemark>
    </Folder>
    <Folder>
      <name>Sights</name>
      <Folder>
        <name>Day 2</name>
        <Placemark>
          <name>Torre de Belém</name>
          <ExtendedData><SchemaData schemaUrl="#s"><SimpleData name="opening">10:00</SimpleData></SchemaData></ExtendedData>
          <MultiGeometry><Point><coordinates>-9.2160,38.6916</coordinates></Point></MultiGeometry>
        </Placemark>
      </Folder>
      <Placemark>
        <name>Walk along the river</name>
        <LineString><tessellate>1</tessellate><coordinates>-9.20,38.69,0 -9.15,38.70,0</coordinates></LineString>
      </Placemark>
      <Placemark>
        <name>Alfama</name>
        <Polygon><outerBoundaryIs><LinearRing><coordinates>-9.13,38.71 -9.12,38.71 -9.12,38.72 -9.13,38.71</coordinates></LinearRing></outerBoundaryIs></Polygon>
      </Placemark>
      <Placemark>
        <name>Drive</name>
        <gx:Track><when>2024-01-01T00:00:00Z</when><gx:coord>-9.1 38.7 0</gx:coord></gx:Track>
      </Placemark>
      <Placemark>
        <name>Castelo</name>
        <address>Castelo de São Jorge, Lisboa</address>
      </Placemark>
      <Placemark><name>Nowhere</name></Placemark>
      <Placemark><name>Off the globe</name><Point><coordinates>38.7,-200</coordinates></Point></Placemark>
    </Folder>
  </Document>
</kml>`

let stored
beforeEach(() => {
  setActivePinia(createPinia())
  stored = {}
  globalThis.localStorage = { getItem: key => stored[key] ?? null, setItem: (key, value) => { stored[key] = value } }
})
afterEach(() => { delete globalThis.FileReader; delete globalThis.DOMParser })

test('Google My Maps KML: folders, ExtendedData, CDATA HTML, lon/lat order, shapes skipped', () => {
  const { format, rows, skipped } = parse(MY_MAPS_KML, 'Lisbon trip.kml')
  assert.equal(format, 'kml')
  assert.deepEqual(rows.map(r => r.label), ['Pastéis de Belém', 'Time Out Market', 'Torre de Belém', 'Castelo'])
  assert.equal(skipped, 5) // line, polygon, track, no position, invalid position
  const [nata, market, tower, castle] = rows
  assert.deepEqual(nata.coords, { lat: 38.6975, lng: -9.2032 })
  assert.equal(nata.description, 'Best pastel de nata\nOpen daily') // tags, script and image dropped
  assert.equal(nata.external_url, 'https://pasteisdebelem.pt')
  assert.equal(nata.image_url, 'https://mymaps.usercontent.google.com/hostedimage/abc')
  assert.equal(nata.group, 'Food & drinks')
  assert.equal(nata.source, 'kml')
  assert.equal(market.address, 'Av. 24 de Julho 49, Lisboa')
  assert.equal(market.description, 'crowded at noon')
  assert.equal(tower.group, 'Day 2') // the innermost folder
  assert.equal(tower.description, 'opening: 10:00') // data columns only when there is no description
  assert.deepEqual(tower.coords, { lat: 38.6916, lng: -9.216 })
  // No point but an address: geocoded like a CSV row.
  assert.equal(castle.coords, null)
  assert.equal(castle.title, 'Castelo de São Jorge, Lisboa')
  assert.equal(castle.group, 'Sights')
})

test('Google Takeout "Saved Places.json" (old and new shape) is GeoJSON with [lng, lat]', () => {
  const takeout = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [2.2945, 48.8584] }, properties: {
        Title: 'Eiffel Tower', 'Google Maps URL': 'http://maps.google.com/?cid=123', Published: '2020-01-01T00:00:00Z',
        Location: { Address: 'Champ de Mars, 75007 Paris, France', 'Business Name': 'Tour Eiffel', 'Country Code': 'FR', 'Geo Coordinates': { Latitude: '48.8584', Longitude: '2.2945' } },
      } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {
        date: '2023-05-01T00:00:00Z', google_maps_url: 'http://maps.google.com/?cid=456', Comment: 'Try the cake',
        location: { name: 'Café Sacher', address: 'Philharmoniker Str. 4, 1010 Wien, Austria', country_code: 'AT' },
      } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { google_maps_url: 'http://maps.google.com/?q=1' } },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 1], [1, 2]] }, properties: { name: 'Route' } },
    ],
  })
  const { format, rows, skipped } = parse(takeout, 'Saved Places.json')
  assert.equal(format, 'geojson')
  assert.equal(skipped, 2)
  const [eiffel, sacher] = rows
  assert.deepEqual(eiffel.coords, { lat: 48.8584, lng: 2.2945 })
  assert.equal(eiffel.label, 'Eiffel Tower')
  assert.equal(eiffel.address, 'Champ de Mars, 75007 Paris, France')
  assert.equal(eiffel.country, 'France')
  assert.equal(eiffel.external_url, 'http://maps.google.com/?cid=123')
  // [0, 0] means "no coordinates": found by geocoding its address.
  assert.equal(sacher.coords, null)
  assert.equal(sacher.label, 'Café Sacher')
  assert.equal(sacher.title, 'Philharmoniker Str. 4, 1010 Wien, Austria')
  assert.equal(sacher.description, 'Try the cake')
  assert.equal(sacher.country, 'Austria')
})

test('GeoJSON: Feature, bare geometry, MultiPoint, folder property, invalid positions', () => {
  assert.deepEqual(parse(JSON.stringify({ type: 'Point', coordinates: [13.4, 52.5] }), 'p.geojson').rows[0].coords, { lat: 52.5, lng: 13.4 })
  const feature = parse(JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [13.4, 52.5, 34] }, properties: { name: 'Berlin', category: 'Cities', description: 'a < b' } }), 'f.json')
  assert.equal(feature.rows[0].group, 'Cities')
  assert.equal(feature.rows[0].description, 'a < b') // plain text is not mangled
  const multi = parse(JSON.stringify({ type: 'Feature', geometry: { type: 'MultiPoint', coordinates: [[1, 2], [3, 4], [200, 4]] }, properties: { name: 'Pair' } }), 'm.geojson')
  assert.deepEqual(multi.rows.map(r => r.coords), [{ lat: 2, lng: 1 }, { lat: 4, lng: 3 }])
  assert.equal(multi.skipped, 1)
  const swapped = parse(JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [52.5, 113.4] }, properties: { name: 'Lat/lng swapped' } }), 's.geojson')
  assert.equal(swapped.rows.length, 0) // latitude 113.4 is impossible: skipped, not geocoded by name
  assert.equal(swapped.skipped, 1)
})

test('GPX: waypoints become places; tracks and routes are not places', () => {
  const gpx = `<?xml version="1.0"?>
<gpx version="1.1" creator="Test" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Hike</name></metadata>
  <wpt lat="47.5596" lon="7.5886"><ele>260</ele><name>Basel Münster</name><desc>View &amp; terrace</desc><link href="https://www.baslermuenster.ch"><text>Site</text></link><sym>Flag, Blue</sym><type>Churches</type></wpt>
  <wpt lat="47.55" lon="7.59"><name>Hut</name><cmt>&lt;p&gt;Water&lt;/p&gt;</cmt><link href="javascript:alert(1)"/></wpt>
  <wpt lat="95" lon="7.59"><name>Broken</name></wpt>
  <rte><name>Plan</name><rtept lat="47.1" lon="7.1"><name>Turn left</name></rtept></rte>
  <trk><name>Track</name><trkseg><trkpt lat="47.5" lon="7.5"/><trkpt lat="47.6" lon="7.6"/></trkseg></trk>
</gpx>`
  const { format, rows, skipped } = parse(gpx, 'hike.gpx')
  assert.equal(format, 'gpx')
  assert.equal(skipped, 3)
  assert.deepEqual(rows.map(r => r.label), ['Basel Münster', 'Hut'])
  assert.deepEqual(rows[0].coords, { lat: 47.5596, lng: 7.5886 })
  assert.equal(rows[0].description, 'View & terrace')
  assert.equal(rows[0].external_url, 'https://www.baslermuenster.ch')
  assert.equal(rows[0].group, 'Churches')
  assert.equal(rows[1].description, 'Water')
  assert.equal(rows[1].external_url, undefined) // only http(s) links
  // GPX 1.0 keeps the link in <url>
  const old = parse('<gpx version="1.0"><wpt lat="1" lon="2"><name>A</name><url>http://a.example</url></wpt></gpx>', 'old.gpx')
  assert.equal(old.rows[0].external_url, 'http://a.example')
})

test('formats are detected by content; malformed files give readable errors', () => {
  assert.equal(detectFormat('export.xml', '﻿<?xml version="1.0"?>\n<!-- x --><kml xmlns="http://www.opengis.net/kml/2.2"></kml>'), 'kml')
  assert.equal(detectFormat('track.txt', '<gpx version="1.1"></gpx>'), 'gpx')
  assert.equal(detectFormat('places.json', ' {"type":"FeatureCollection"}'), 'json')
  assert.equal(detectFormat('Saved.csv', 'Title,Note,URL\n'), 'csv')
  assert.throws(() => parse('<kml><Document><Placemark></Document></kml>', 'bad.kml'), /not valid XML/)
  assert.throws(() => parse('<svg></svg>', 'x.kml'), /Not a KML file|expected KML or GPX/)
  assert.throws(() => parse('{"type": "Feature", ', 'x.geojson'), /not valid JSON/)
  assert.throws(() => parse(JSON.stringify({ version: 5, type: 'export', markers: [] }), 'mapmarker-export.json'), /Fernweh export/)
  assert.throws(() => parse(JSON.stringify({ hello: 1 }), 'x.json'), /Not a GeoJSON file/)
  assert.throws(() => parsePlaces('<kml></kml>', 'x.kml', { DOMParser: undefined }), /cannot be read/)
  assert.equal(htmlToText('<p>One</p><p>Two &amp; <a href="x">three</a></p><style>p{}</style>'), 'One\nTwo & three')
  assert.equal(htmlToText('A&nbsp;&nbsp;<b>B</b>\n\n\n\nC'), 'A B\n\nC')
  assert.equal(htmlToText('   '), null)
})

test('large KML files parse in one pass', () => {
  const placemarks = Array.from({ length: 5000 }, (_, i) => `<Placemark><name>P${i}</name><Point><coordinates>${(i % 360) - 180},${(i % 170) - 85}</coordinates></Point></Placemark>`).join('')
  const started = Date.now()
  const { rows } = parse(`<kml><Document><Folder><name>All</name>${placemarks}</Folder></Document></kml>`, 'big.kml')
  assert.equal(rows.length, 5000)
  assert.equal(rows[4999].label, 'P4999')
  assert.ok(Date.now() - started < 5000)
})

test('KMZ: the zipped doc.kml is unpacked (deflated or stored)', async () => {
  const kml = '<kml><Placemark><name>Zipped</name><Point><coordinates>10,50</coordinates></Point></Placemark></kml>'
  const text = await readKmz(zip([{ name: 'files/icon.png', text: 'PNG', store: true }, { name: 'doc.kml', text: kml }]))
  assert.equal(parse(text, 'x.kmz').rows[0].label, 'Zipped')
  assert.equal(await readKmz(zip([{ name: 'map.kml', text: kml, store: true }])), kml)
  await assert.rejects(readKmz(zip([{ name: 'readme.txt', text: 'hi' }])), /contains no KML/)
  await assert.rejects(readKmz(new TextEncoder().encode('not a zip').buffer), /not a valid zip/)
})

test('KML import reuses the CSV flow: no geocoding, folders become collections, duplicates skipped', async () => {
  globalThis.DOMParser = MiniDOMParser
  globalThis.FileReader = class { readAsText(file) { this.onload({ target: { result: file.text } }) } }
  const markers = useMarkersStore()
  markers.items = [{ id: 1, lat: 38.7069, lng: -9.1458, label: 'Time Out Market' }]
  const collections = useCollectionsStore()
  collections.items = [{ id: 7, name: 'Sights' }]
  const created = [], imported = []
  globalThis.fetch = async (url, options) => {
    const data = JSON.parse(options.body)
    if (url === '/api/collections') { created.push(data.name); return new Response(JSON.stringify({ id: 20 + created.length, ...data })) }
    if (url.endsWith('/import')) { imported.push(...data.markers); return new Response(JSON.stringify({ results: data.markers.map((m, index) => ({ index, marker: { id: index + 100, ...m } })) })) }
    throw new Error('Unexpected request ' + url) // e.g. a Nominatim lookup for a place that has coordinates
  }
  const transfer = useImportExport(markers, useCategoriesStore(), collections)
  await transfer.onCsvSelected({ target: { files: [{ name: 'Lisbon trip.kml', text: MY_MAPS_KML }] } })
  assert.equal(transfer.csvError.value, null)
  assert.match(transfer.csvNotice.value, /^5 skipped/)
  transfer.csvRows.value = transfer.csvRows.value.filter(r => r.coords) // leave out the one that needs geocoding
  await transfer.doGeocode()
  assert.equal(transfer.geocodedMarkers.value.length, 3)
  assert.equal(transfer.groupAs.value, 'collection')
  await transfer.doCsvImport()
  assert.deepEqual(created, ['Food & drinks', 'Day 2']) // "Sights" already exists; no folder created twice
  assert.deepEqual(imported.map(m => m.label), ['Pastéis de Belém', 'Torre de Belém']) // the market is a duplicate
  assert.deepEqual(imported.map(m => m.collection_ids), [[21], [22]])
  assert.equal(imported[0].source, 'kml')
  assert.equal(imported[0].external_url, 'https://pasteisdebelem.pt')
  assert.equal(imported[0].group, undefined)
  assert.match(transfer.csvStatus.value, /^Done — 2 imported, 1 duplicates skipped, 0 failed/)
})

test('folders can become categories or be ignored; the export import refuses GeoJSON', async () => {
  globalThis.DOMParser = MiniDOMParser
  const sent = []
  globalThis.fetch = async (url, options) => {
    const data = JSON.parse(options.body)
    if (url === '/api/categories') return new Response(JSON.stringify({ id: 5, ...data }))
    sent.push(...data.markers)
    return new Response(JSON.stringify({ results: data.markers.map((m, index) => ({ index, marker: { id: index + 1, ...m } })) }))
  }
  const transfer = useImportExport(useMarkersStore(), useCategoriesStore(), useCollectionsStore())
  transfer.groupAs.value = 'category'
  await transfer.doCsvImport([{ lat: 1, lng: 2, label: 'A', group: 'Food', source: 'gpx' }])
  transfer.groupAs.value = ''
  await transfer.doCsvImport([{ lat: 3, lng: 4, label: 'B', group: 'Food' }])
  assert.deepEqual(sent.map(m => [m.category_ids, m.collection_ids, m.source]), [[[5], [], 'gpx'], [[], [], 'google_maps_csv']])

  globalThis.FileReader = class { readAsText(file) { this.onload({ target: { result: file.text } }) } }
  transfer.onFileSelected({ target: { files: [{ name: 'places.json', text: JSON.stringify({ type: 'FeatureCollection', features: [] }) }] } })
  assert.match(transfer.importError.value, /GeoJSON/)
  assert.equal(transfer.importMarkers.value, null)
})
