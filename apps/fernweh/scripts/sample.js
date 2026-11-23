// Sample data for trying Fernweh on this computer: `node try.mjs fernweh --sample` fills a separate
// database (data-sample/mapper.db) with it, never your real data and never on the server. Places all
// over Europe in every category, a past road trip with numbered stops and route legs, a planned one,
// friends with their homes, share links, something in the trash, and 200 saved places in Berlin to
// see how the map copes with a crowd. Dates are relative to today.
// Nothing goes over the network: addresses and countries are written in (so the app has nothing to
// look up), there are no pictures, and the route legs are stored as the app stores them, unrouted.
// The account's password is fernweh-sample, set the way the first visit's set-up does it.
// Only fills an empty database; `node try.mjs fernweh --sample --fresh` starts it over.

import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..')
// Run by hand (without try.mjs), it still stays out of your real data
process.env.MAPPER_DB_PATH ||= join(appDir, 'data-sample', 'mapper.db')

const { default: db } = await import('../api/db.js')
const { saveMarker } = await import('../api/utils/markers.js')
const { saveTrip } = await import('../api/utils/trips.js')
const { trashMarker } = await import('../api/utils/trash.js')
const { transaction } = await import('../api/utils/transaction.js')
const { normalizeShareFilter, validateCollection, validateColor, validateShare } = await import('../api/utils/validation.js')
const bcrypt = createRequire(join(appDir, 'api', 'index.js'))('bcryptjs')

const PASSWORD = 'fernweh-sample'

// The account, as POST /api/auth/setup makes it (unless one was set up already)
let madeAccount = false
if (!db.prepare('SELECT id FROM users LIMIT 1').get()) {
  db.prepare('INSERT INTO users (password_hash, session_version) VALUES (?, ?)').run(await bcrypt.hash(PASSWORD, 12), randomBytes(32).toString('hex'))
  madeAccount = true
}
const filled = db.prepare('SELECT (SELECT COUNT(*) FROM markers) + (SELECT COUNT(*) FROM categories) + (SELECT COUNT(*) FROM collections) + (SELECT COUNT(*) FROM persons) AS n').get().n
if (filled) {
  console.log('Sample data is there already (--fresh starts it over)')
  db.close()
  process.exit(0)
}

// --- helpers ---

const day = (n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
// Countries by English name, as the app stores them
const regions = new Intl.DisplayNames(['en'], { type: 'region' })
const country = (code) => regions.of(code)

// The same made-up places every time
let seed = 11
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}

// Categories, collections, persons and share links have no store function; these insert what
// their POST routes insert, after the same checks.
function category(name, color) {
  validateColor(color)
  return Number(db.prepare("INSERT INTO categories (name, color, created_at) VALUES (?, ?, datetime('now'))").run(name, color).lastInsertRowid)
}

function collection(fields) {
  validateCollection(fields)
  const { name, description, is_trip, start_date, end_date, color, show_route_line, show_exact_route } = fields
  return Number(db.prepare("INSERT INTO collections (name, description, is_trip, start_date, end_date, color, show_route_line, show_exact_route, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))")
    .run(name, description || null, is_trip ? 1 : 0, start_date || null, end_date || null, color, is_trip && show_route_line ? 1 : 0, is_trip && show_exact_route ? 1 : 0).lastInsertRowid)
}

function person(firstName, lastName, color, addressMarkerId = null) {
  validateColor(color)
  const name = [firstName, lastName].filter(Boolean).join(' ')
  return Number(db.prepare("INSERT INTO persons (name, first_name, last_name, color, address_marker_id, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))")
    .run(name, firstName, lastName || null, color, addressMarkerId).lastInsertRowid)
}

async function shareLink({ name, filter, password, expiresAt }) {
  validateShare({ name, filter, password, expiresAt })
  db.prepare('INSERT INTO share_links (token, name, password_hash, filter_json, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(randomBytes(24).toString('base64url'), name, password ? await bcrypt.hash(password, 12) : null, JSON.stringify(normalizeShareFilter(filter)), expiresAt || null)
}

// A marker through the app's own save (checks, links, stop numbers).
// cats/cols/people: ids; stops: { collectionId: stop number }
function place(label, lat, lng, code, fields = {}) {
  const { cats = [], cols = [], people = [], stops = {}, ...rest } = fields
  return saveMarker({
    lat, lng, label, country: country(code), category_ids: cats, collection_ids: [...new Set([...cols, ...Object.keys(stops).map(Number)])],
    collection_positions: stops, person_ids: people, ...rest,
  }).id
}

const counts = { markers: 0, legs: 0 }
let ids // for the share links, which hash their passwords outside the transaction

transaction(db, () => {
  // --- categories ---

  const restaurant = category('Restaurant', '#ef4444')
  const cafe = category('Café', '#b45309')
  const bar = category('Bar', '#db2777')
  const museum = category('Museum', '#7c3aed')
  const hike = category('Hike', '#16a34a')
  const view = category('Viewpoint', '#0ea5e9')
  const beach = category('Beach', '#f59e0b')
  const castle = category('Castle', '#64748b')
  const city = category('City', '#2563eb')
  const camp = category('Campsite', '#65a30d')
  const shop = category('Shop', '#0d9488')
  category('Ski area', '#94a3b8') // nothing in it yet

  // --- collections and trips ---

  const alps = collection({
    name: 'Alps road trip', is_trip: 1, start_date: day(-125), end_date: day(-111), color: '#0ea5e9', show_route_line: 1,
    description: 'Two weeks by car: Munich, the Zugspitze, over the Brenner into the Dolomites, Lake Garda and back via Verona.',
  })
  const portugal = collection({ name: 'Lisbon & Porto', is_trip: 1, start_date: day(38), end_date: day(47), color: '#f97316', show_route_line: 1, description: 'Booked! Flights to Lisbon, back from Porto.' })
  const scandinavia = collection({ name: 'Scandinavia 2019', is_trip: 1, start_date: '2019-07', end_date: '2019-08', color: '#14b8a6', description: 'Interrail, before stop numbers were a thing.' })
  const bucket = collection({ name: 'Bucket list', color: '#a855f7', description: 'One day.' })
  const coffee = collection({ name: 'Coffee worth a detour', color: '#92400e' })
  const berlin = collection({ name: 'Berlin saved places', color: '#e11d48', description: 'Imported from Google Maps: everything friends ever recommended in Berlin.' })
  collection({ name: 'Ideas for next year', color: '#64748b' }) // still empty

  // --- friends and their homes ---

  const annaHome = place('Anna & Tom', 53.5530, 9.9260, 'DE', { address: 'Große Brunnenstraße 12, 22763 Hamburg, Germany' })
  const jonasHome = place('Jonas', 48.1620, 11.5860, 'DE', { address: 'Hohenzollernstraße 45, 80801 München, Germany' })
  const lenaHome = place('Lena', 51.3125, 12.3760, 'DE', { address: 'Bornaische Straße 3, 04277 Leipzig, Germany' })
  const mehmetHome = place('Mehmet', 52.4970, 13.4170, 'DE', { address: 'Oranienstraße 180, 10999 Berlin, Germany' })
  const anna = person('Anna', 'Schmidt', '#ec4899', annaHome)
  const jonas = person('Jonas', 'Weber', '#3b82f6', jonasHome)
  const lena = person('Lena', 'Fischer', '#10b981', lenaHome)
  const mehmet = person('Mehmet', 'Yılmaz', '#f59e0b', mehmetHome)
  const sophie = person('Sophie', null, '#8b5cf6') // no address
  for (const [id, p] of [[annaHome, anna], [jonasHome, jonas], [lenaHome, lena], [mehmetHome, mehmet]]) saveMarker({ person_ids: [p] }, id)

  // --- the past road trip: numbered stops, one place on the way without a number ---

  const a = [
    place('Viktualienmarkt', 48.1351, 11.5762, 'DE', { cats: [restaurant, city], stops: { [alps]: 1 }, people: [jonas], visited_at: day(-125), rating: 4, address: 'Viktualienmarkt 3, 80331 München, Germany' }),
    place('Zugspitze', 47.4211, 10.9853, 'DE', { cats: [view], stops: { [alps]: 2 }, people: [jonas], visited_at: day(-124), rating: 5, is_favorite: 1, external_url: 'https://zugspitze.de', description: 'Took the cable car up from Eibsee, walked down to the Sonnalpin. Go early, it gets crowded by ten.' }),
    place('Nordkette', 47.3122, 11.3847, 'AT', { cats: [view, hike], stops: { [alps]: 3 }, people: [jonas], visited_at: day(-122), rating: 4, address: 'Hafelekar, 6020 Innsbruck, Austria' }),
    place('Seceda', 46.5986, 11.7227, 'IT', { cats: [hike, view], stops: { [alps]: 4 }, people: [jonas], visited_at: day(-120), rating: 5, is_favorite: 1 }),
    place('Lago di Braies', 46.6946, 12.0852, 'IT', {
      cats: [view, hike], stops: { [alps]: 5 }, people: [jonas], visited_at: day(-118), rating: 5,
      description: [
        'Pragser Wildsee / Lago di Braies, at the foot of the Seekofel (Croda del Becco), 1,496 m.',
        'We walked the loop around the lake (about 3.5 km, one hour without stops, more like two with photos). The west shore is flat and busy; the east side climbs a little over roots and steps and is much quieter. The famous view with the wooden boathouse is right by the hotel — be there before eight, after that it is shoulder to shoulder.',
        'Getting there: in summer the road from Welsberg/Monguelfo is closed to cars from about 9:30 to 16:00 unless you have booked a parking slot online (we did, 38 €, worth it). Otherwise the bus 442 from Niederdorf/Villabassa runs every half hour. Rowing boats cost 35 € for half an hour and 45 € for an hour, cash only when we were there, and the queue was long by eleven.',
        'Longer hike for next time: up to the Seekofelhütte (Rifugio Biella, 2,327 m) via the Nabigen Loch — about 3 hours up, steep in the last part, with a view over the whole Fanes plateau. Jonas wants to go up to the summit of the Seekofel as well (2,810 m, easy scrambling, secured in places).',
        'Food: the Hotel Pragser Wildsee is expensive; the kiosk by the car park has decent Speckbrot and Apfelstrudel. Water is fine from the fountain at the start of the loop. Swimming is not allowed (and at 14 °C in August nobody would want to).',
        'Notes for the photos: the morning light comes from behind the boathouse until about 9:30; in the afternoon the Seekofel is lit from the west and the water turns properly turquoise. Polarising filter helps. Drone flying is not allowed (nature park Fanes-Sennes-Prags).',
        'Weather: we had 9 °C at 7 am and 24 °C at noon. Thunderstorms build up most afternoons in July and August, so plan the longer walks for the morning.',
      ].join('\n\n'),
    }),
    place('Rifugio Auronzo – Tre Cime', 46.6127, 12.2952, 'IT', { cats: [hike, restaurant], stops: { [alps]: 6 }, people: [jonas], visited_at: day(-117), rating: 4, description: 'Toll road 30 € per car. The loop around the Drei Zinnen takes about 4 hours.' }),
    place('Sirmione', 45.4970, 10.6066, 'IT', { cats: [city, beach], stops: { [alps]: 7 }, people: [jonas], visited_at: day(-115), rating: 3, description: 'Pretty, but very full. Jamaica Beach is nice in the evening.' }),
    place('Camping Bella Italia', 45.4405, 10.6830, 'IT', { cats: [camp], stops: { [alps]: 8 }, people: [jonas], visited_at: day(-114), rating: 3, address: 'Via Bella Italia 2, 37019 Peschiera del Garda, Italy' }),
    place('Arena di Verona', 45.4390, 10.9944, 'IT', { cats: [museum, city], stops: { [alps]: 9 }, people: [jonas], visited_at: day(-112), rating: 5, description: 'Aida in the open air. Bring a cushion for the stone steps.' }),
  ]
  place('Gelateria in Bozen', 46.4983, 11.3548, 'IT', { cats: [cafe], cols: [alps, coffee], people: [jonas], visited_at: day(-121), rating: 4, address: 'Obstmarkt 14, 39100 Bozen, Italy' })
  // Route legs as the app stores them: by car, one over a pass (a via point), one by bike
  const via = { 1: [{ lat: 47.3637, lng: 10.8377 }], 2: [{ lat: 47.0026, lng: 11.5058 }], 3: [{ lat: 46.5497, lng: 11.8070 }] }
  const alpsLegs = a.slice(1).map((to, k) => ({ from_marker_id: a[k], to_marker_id: to, mode: k === 6 ? 'bike' : 'drive', via_points: via[k] || [] }))
  saveTrip(alps, a.map((id, k) => ({ marker_id: id, position: k + 1 })), alpsLegs, { replaceSegments: true })
  counts.legs += alpsLegs.length

  // --- the planned trip ---

  const p = [
    place('Miradouro da Senhora do Monte', 38.7190, -9.1325, 'PT', { cats: [view], stops: { [portugal]: 1 }, people: [lena], planned_at: day(38), description: 'Sunset. Tram 28 to Graça.' }),
    place('Pastéis de Belém', 38.6975, -9.2032, 'PT', { cats: [cafe], stops: { [portugal]: 2 }, cols: [coffee], people: [lena], planned_at: day(39), address: 'Rua de Belém 84-92, 1300-085 Lisboa, Portugal' }),
    place('Palácio da Pena', 38.7876, -9.3906, 'PT', { cats: [castle], stops: { [portugal]: 3 }, people: [lena], planned_at: day(40), external_url: 'https://www.parquesdesintra.pt' }),
    place('Praia da Ursa', 38.7898, -9.4908, 'PT', { cats: [beach, hike], stops: { [portugal]: 4 }, people: [lena], planned_at: day(40), description: 'Steep path down, proper shoes.' }),
    place('Livraria Lello', 41.1469, -8.6149, 'PT', { cats: [shop], stops: { [portugal]: 5 }, people: [lena], planned_at: day(43), description: 'Tickets online, 10 € (counted towards a book).' }),
    place('Ribeira', 41.1405, -8.6131, 'PT', { cats: [city, restaurant], stops: { [portugal]: 6 }, people: [lena], planned_at: day(44) }),
  ]
  place('Time Out Market', 38.7069, -9.1459, 'PT', { cats: [restaurant], cols: [portugal], description: 'If it rains.' })
  const portugalLegs = p.slice(1).map((to, k) => ({ from_marker_id: p[k], to_marker_id: to, mode: ['bike', 'drive', 'drive', 'drive', 'walk'][k], via_points: k === 3 ? [{ lat: 40.2033, lng: -8.4103 }] : [] }))
  saveTrip(portugal, p.map((id, k) => ({ marker_id: id, position: k + 1 })), portugalLegs, { replaceSegments: true })
  counts.legs += portugalLegs.length

  // --- an old trip without stop numbers ---

  place('Torvehallerne', 55.6838, 12.5694, 'DK', { cats: [restaurant], cols: [scandinavia], people: [anna], visited_at: '2019-07-12', rating: 4 })
  place('Preikestolen', 58.9864, 6.1904, 'NO', { cats: [hike, view], cols: [scandinavia], people: [anna, sophie], visited_at: '2019-07-20', rating: 5, is_favorite: 1, description: '2 hours up, 604 m above the Lysefjord.' })
  place('Fotografiska', 59.3178, 18.0857, 'SE', { cats: [museum, cafe], cols: [scandinavia], people: [sophie], visited_at: '2019-08-02', rating: 4 })

  // --- all over Europe ---

  place('Elbphilharmonie', 53.5413, 9.9841, 'DE', { cats: [view, city], people: [anna], visited_at: 'yes', color: '#1d4ed8', address: 'Platz der Deutschen Einheit 4, 20457 Hamburg, Germany', description: 'The Plaza is free, tickets at the door.' })
  place('Fischmarkt', 53.5455, 9.9466, 'DE', { cats: [restaurant], people: [anna], visited_at: day(-30), rating: 3, description: 'Sundays from 5 am (7 in winter).' })
  place('Neuschwanstein Castle', 47.5576, 10.7498, 'DE', { cats: [castle], visited_at: '2018-05', rating: 4, external_url: 'https://www.neuschwanstein.de' })
  place('Musée d’Orsay', 48.8600, 2.3266, 'FR', { cats: [museum], visited_at: day(-400), rating: 5, is_favorite: 1 })
  place('Café de Flore', 48.8541, 2.3326, 'FR', { cats: [cafe], cols: [coffee], visited_at: day(-401), rating: 3, description: 'Overpriced, but once is a must.' })
  place('Rijksmuseum', 52.3600, 4.8852, 'NL', { cats: [museum], visited_at: 'yes', rating: 5 })
  place('Arthur’s Seat', 55.9441, -3.1618, 'GB', { cats: [hike, view], visited_at: '2022-09-10', rating: 4 })
  place('Old Man of Storr', 57.5074, -6.1830, 'GB', { cats: [hike], visited_at: '2022-09-14', rating: 5, is_favorite: 1 })
  place('Sagrada Família', 41.4036, 2.1744, 'ES', { cats: [museum], visited_at: '2023-04', rating: 5 })
  place('Bunkers del Carmel', 41.4190, 2.1617, 'ES', { cats: [view], visited_at: '2023-04', rating: 4 })
  place('Caló des Moro', 39.3164, 3.1294, 'ES', { cats: [beach], planned_at: day(200) })
  place('Pantheon', 41.8986, 12.4769, 'IT', { cats: [museum, city], visited_at: '2016' })
  place('Plitvice Lakes', 44.8654, 15.5820, 'HR', { cats: [hike], people: [sophie], visited_at: '2021-08-03', rating: 4 })
  place('Seljalandsfoss', 63.6156, -19.9886, 'IS', { cats: [view], visited_at: '2024-06-18', rating: 5, is_favorite: 1 })
  place('Wawel Castle', 50.0540, 19.9354, 'PL', { cats: [castle], visited_at: '2017' })
  place('Charles Bridge', 50.0865, 14.4114, 'CZ', { cats: [city], visited_at: 'yes' })
  place('Café Sperl', 48.1990, 16.3600, 'AT', { cats: [cafe], cols: [coffee], visited_at: day(-70), rating: 4, address: 'Gumpendorfer Straße 11, 1060 Wien, Austria' })
  place('Széchenyi Baths', 47.5186, 19.0823, 'HU', { cats: [city], visited_at: '2019-03', rating: 4 })
  place('Kaffeehaus Riquet', 51.3396, 12.3777, 'DE', { cats: [cafe], cols: [coffee], people: [lena], visited_at: day(-9), rating: 4 })
  place('Restaurant & Weinstube „Zum goldenen Hirschen“ am alten Marktplatz – Familienbetrieb seit 1872, Reservierung empfohlen', 49.4106, 8.7101, 'DE', { cats: [restaurant], rating: 2, visited_at: day(-3), description: 'Long name, short visit: cold Spätzle.' })
  place('', 54.4440, 12.4480, 'DE', { use_coords: 1, description: 'Parking spot by the dunes, no address. Label still to do.' })

  // Bucket list: nothing visited yet
  for (const [label, lat, lng, code, cats] of [
    ['Reine', 67.9324, 13.0887, 'NO', [view]], ['Gásadalur', 62.1110, -7.4350, 'FO', [view, hike]], ['Sentiero degli Dei', 40.6250, 14.5390, 'IT', [hike]],
    ['Meteora', 39.7217, 21.6306, 'GR', [view, castle]], ['Navagio Beach', 37.8595, 20.6249, 'GR', [beach]], ['Transfăgărășan', 45.6034, 24.6166, 'RO', [view]],
    ['Vernazza', 44.1349, 9.6849, 'IT', [city, beach]],
  ]) place(label, lat, lng, code, { cats, cols: [bucket], ...(label === 'Gásadalur' ? { planned_at: day(260) } : {}) })

  // --- a crowd: 200 places in Berlin, imported from a Google Maps list ---

  const kinds = [['Café', cafe], ['Bäckerei', cafe], ['Bar', bar], ['Weinbar', bar], ['Restaurant', restaurant], ['Imbiss', restaurant], ['Pizzeria', restaurant], ['Buchhandlung', shop], ['Plattenladen', shop], ['Galerie', museum]]
  const names = ['Kranich', 'Lindenblatt', 'Zur Spree', 'Mondschein', 'Kiezperle', 'Goldener Hahn', 'Hinterhof', 'Eckhaus', 'Fräulein Grün', 'Kastanie',
    'Blauer Elefant', 'Zum Schusterjungen', 'Morgenrot', 'Kleine Welt', 'Weltempfänger', 'Rosengarten', 'Nachtfalter', 'Sonnendeck', 'Tante Käthe', 'Pfefferkorn']
  const districts = [['Kreuzberg', 52.497, 13.410, '10999'], ['Neukölln', 52.480, 13.435, '12047'], ['Mitte', 52.524, 13.402, '10119'], ['Prenzlauer Berg', 52.539, 13.420, '10437'],
    ['Friedrichshain', 52.512, 13.455, '10245'], ['Wedding', 52.550, 13.360, '13353'], ['Schöneberg', 52.488, 13.355, '10827'], ['Charlottenburg', 52.507, 13.305, '10627']]
  const streets = ['Hauptstraße', 'Bergmannstraße', 'Weserstraße', 'Kastanienallee', 'Simon-Dach-Straße', 'Torstraße', 'Goltzstraße', 'Kantstraße', 'Müllerstraße', 'Boxhagener Straße']
  for (let i = 0; i < 200; i++) {
    const [kind, cat] = kinds[i % kinds.length]
    const [district, lat, lng, postcode] = districts[Math.floor(random() * districts.length)]
    const visited = random() < 0.25
    place(`${kind} ${names[Math.floor(i / kinds.length)]}`, +(lat + (random() - 0.5) * 0.024).toFixed(5), +(lng + (random() - 0.5) * 0.04).toFixed(5), 'DE', {
      cats: [cat],
      cols: [berlin],
      source: 'google_maps_csv',
      address: `${streets[Math.floor(random() * streets.length)]} ${1 + Math.floor(random() * 180)}, ${postcode} Berlin, Germany`,
      ...(i % 9 === 0 ? { description: `Tip from ${['Mehmet', 'Anna', 'Lena'][i % 3]}. ${district}.` } : {}),
      ...(visited ? { visited_at: day(-Math.floor(random() * 700)), rating: 1 + Math.floor(random() * 5) } : {}),
      ...(i % 23 === 0 ? { is_favorite: 1 } : {}),
      ...(i % 17 === 0 ? { people: [mehmet] } : {}),
    })
  }

  // --- the trash: a place deleted the other day ---

  trashMarker(place('Bäckerei Krume (closed down)', 52.4890, 13.4250, 'DE', { cats: [cafe], visited_at: '2023' }))

  counts.markers = db.prepare('SELECT COUNT(*) AS n FROM markers').get().n
  ids = { alps, museum }
})

// --- share links: one trip for a friend, everything behind a password, and an expired one ---

await shareLink({ name: 'Alps road trip for Jonas', filter: { collections: [ids.alps] } })
await shareLink({ name: 'Everything (password share-sample)', filter: { all: true }, password: 'share-sample', expiresAt: day(30) })
await shareLink({ name: 'Museums (expired)', filter: { categories: [ids.museum] }, expiresAt: day(-10) })

const n = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n
console.log(`Sample data: ${counts.markers} markers, ${n('categories')} categories, ${n('collections')} collections (3 trips, ${counts.legs} route legs), `
  + `${n('persons')} persons, ${n('share_links')} share links, ${n('deleted_markers')} in the trash${madeAccount ? `; password ${PASSWORD}` : ''}`)
db.close()
