// Sample data for trying Watchlist on this computer: `node try.mjs watchlist --sample` fills a
// separate data folder (data-sample/) with it, never your real data and never on the server.
// Every status for films and series, a show half watched with episodes still to come, one
// with 770 episodes, titles entered by hand, titles without a poster, and 200 films to scroll
// through. Dates are relative to today. Nothing is fetched from TMDB: the catalog data is
// written here, and the posters are small generated JPEGs (what the app stores).
// It goes in through the app's own store functions; only the timestamps are set directly.
// Only fills an empty database; `node try.mjs watchlist --sample --fresh` starts it over.

import * as store from '../server/db.js';
import { savePoster } from '../server/catalog.js';
import { createAuth } from '../server/kit/auth.js';
import { cleanFilmInput, cleanSeriesInput } from '../server/titles.js';

await createAuth({ users: store.users, cookie: 'watchlist_session' }).ensureAdmin();
if (!store.users.countUsers()) {
  console.log('No account to fill (ADMIN_PASSWORD not set?): no sample data');
  process.exit(0);
}
if (store.db.prepare('SELECT (SELECT COUNT(*) FROM films) + (SELECT COUNT(*) FROM series) AS n').get().n) {
  console.log('Sample data is there already (--fresh starts it over)');
  process.exit(0);
}

// --- helpers ---

const today = store.localDate();
const shift = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return store.localDate(d);
};
const day = (n) => shift(today, n);
const at = (iso) => new Date(`${iso}T20:00:00`).toISOString();
const nowIso = store.now();

// Streaming offers as TMDB gives them, without logos (those would be fetched from TMDB)
const offers = (...names) => ({
  link: null,
  flatrate: names.map((name, i) => ({ id: 9000 + i, name, logo: null })),
  free: [],
  rent: [{ id: 2, name: 'Apple TV', logo: null }],
  buy: [],
});

// A poster: sky, sun and hills in a colour of its own, 160×240. Made of flat 8×8 blocks, which a
// JPEG can hold with one number each, so a few lines write a valid file without an image library.
function hsl(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
}

function jpeg(width, height, blockColor) {
  const out = [0xff, 0xd8];
  const segment = (marker, data) => out.push(0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 255, ...data);
  segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]); // JFIF
  segment(0xdb, [0, ...Array(64).fill(1)]); // no quantisation
  segment(0xc0, [8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]);
  segment(0xc4, [0x00, 0, 0, 0, 12, ...Array(12).fill(0), ...Array.from({ length: 12 }, (_, i) => i)]); // DC: sizes 0–11, 4 bits each
  segment(0xc4, [0x10, 1, ...Array(15).fill(0), 0x00]); // AC: only "end of block", 1 bit
  segment(0xda, [3, 1, 0x00, 2, 0x00, 3, 0x00, 0, 63, 0]);
  let byte = 0;
  let bits = 0;
  const put = (value, length) => {
    for (let i = length - 1; i >= 0; i--) {
      byte = (byte << 1) | ((value >> i) & 1);
      if (++bits === 8) {
        out.push(byte);
        if (byte === 0xff) out.push(0);
        byte = 0;
        bits = 0;
      }
    }
  };
  const previous = [0, 0, 0];
  for (let by = 0; by < Math.ceil(height / 8); by++) {
    for (let bx = 0; bx < Math.ceil(width / 8); bx++) {
      const [r, g, b] = blockColor(bx, by);
      const ycc = [
        0.299 * r + 0.587 * g + 0.114 * b,
        128 - 0.168736 * r - 0.331264 * g + 0.5 * b,
        128 + 0.5 * r - 0.418688 * g - 0.081312 * b,
      ];
      ycc.forEach((v, c) => {
        const dc = Math.round(8 * (Math.min(255, Math.max(0, v)) - 128));
        const diff = dc - previous[c];
        previous[c] = dc;
        const size = diff ? 32 - Math.clz32(Math.abs(diff)) : 0;
        put(size, 4);
        if (size) put(diff > 0 ? diff : diff + (1 << size) - 1, size);
        put(0, 1); // end of block
      });
    }
  }
  if (bits) put((1 << (8 - bits)) - 1, 8 - bits);
  out.push(0xff, 0xd9);
  return Buffer.from(out);
}

const hueOf = (text) => [...text].reduce((h, c) => (h * 31 + c.codePointAt(0)) % 360, 7);

function posterImage(title, grey = false) {
  const hue = hueOf(title);
  const s = grey ? 0 : 1;
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const top = hsl(hue, 55 * s, 22);
  const bottom = hsl((hue + 40) % 360, 65 * s, 68);
  const sun = hsl((hue + 180) % 360, 80 * s, 86);
  const hill = hsl(hue, 35 * s, 12);
  return jpeg(160, 240, (bx, by) => {
    if (by >= 22 - Math.round(2 * Math.sin(bx / 2.5 + hue))) return hill;
    if ((bx - 13) ** 2 + (by - 9) ** 2 <= 10) return sun;
    return mix(top, bottom, by / 29);
  });
}

const counts = { films: 0, series: 0, posters: 0, episodes: 0 };
const stamps = []; // [table, id, created, updated]: set at the end

async function addPoster(kind, id, title, source) {
  const file = await savePoster(`${kind === 'films' ? 'f' : 's'}${id}`, posterImage(title, source === 'photo'));
  (kind === 'films' ? store.updateFilm : store.updateSeries)(id, { poster_file: file, poster_source: source }, { touch: false });
  counts.posters++;
}

// From TMDB (tmdb_id set: catalog fields as TMDB fills them) or by hand (checked like the add
// form). watches: dates ('YYYY', 'YYYY-MM', 'YYYY-MM-DD' or null). poster: false for none.
async function film(fields, { watches = [], poster = true, added = -30 } = {}) {
  const row = fields.tmdb_id
    ? { providers: null, providers_at: nowIso, ...fields }
    : cleanFilmInput(fields, { manual: true });
  const id = store.insertFilm(row);
  for (const w of watches) store.addWatch(id, w);
  if (poster) await addPoster('films', id, row.title, fields.tmdb_id ? 'tmdb' : 'photo');
  const lastFull = watches.filter((w) => /^\d{4}-\d\d-\d\d$/.test(w || '')).sort().pop();
  stamps.push(['films', id, day(added), lastFull && lastFull > day(added) ? lastFull : day(added)]);
  counts.films++;
  return id;
}

// seasons: [{ air: first episode's date, count, every: days between episodes (7), runtime }]
async function series(fields, seasons = [], { poster = true, added = -60 } = {}) {
  const manual = !fields.tmdb_id;
  const row = manual
    ? cleanSeriesInput(fields, { manual: true })
    : { providers: null, providers_at: nowIso, refreshed_at: nowIso, ...fields };
  if (!manual) {
    row.seasons = seasons.map((s, i) => ({ number: i + 1, name: `Staffel ${i + 1}`, air_date: s.air ?? null, episode_count: s.count }));
  }
  const id = store.insertSeries(row);
  if (manual) for (const s of seasons) store.addSeason(id, s.count);
  else {
    const episodes = seasons.flatMap((s, i) => Array.from({ length: s.count }, (_, n) => {
      const air = s.air ? shift(s.air, n * (s.every ?? 7)) : null;
      return { season: i + 1, number: n + 1, name: air && air <= today ? `Folge ${n + 1}` : null, air_date: air, runtime: s.runtime ?? null };
    }));
    store.saveEpisodes(id, episodes);
  }
  counts.episodes += store.episodesOf(id).length;
  if (poster) await addPoster('series', id, row.title, manual ? 'photo' : 'tmdb');
  stamps.push(['series', id, day(added), day(added)]);
  counts.series++;
  return id;
}

// Ticks episodes: on(episode, index) gives the date seen, null (seen, date unknown) or false (not seen)
function watch(seriesId, on) {
  const ticks = [];
  store.episodesOf(seriesId).forEach((e, i) => {
    const date = on(e, i);
    if (date !== false && date !== undefined) ticks.push({ id: e.id, on: date });
  });
  store.tickEpisodes(seriesId, ticks);
  const last = ticks.map((t) => t.on).filter(Boolean).sort().pop();
  const stamp = stamps.find(([table, id]) => table === 'series' && id === seriesId);
  if (last && last > stamp[3]) stamp[3] = last;
}

// --- films from TMDB ---

await film({
  tmdb_id: 550, title: 'Fight Club', tagline: 'Mischief. Mayhem. Soap.', release_date: '1999-10-15', runtime: 139,
  overview: 'Ein Versicherungsangestellter leidet an Schlaflosigkeit und findet Halt bei einem Seifenverkäufer, mit dem er einen Untergrund-Boxclub gründet.',
  genres: ['Drama', 'Thriller'], director: 'David Fincher', cast_names: ['Brad Pitt', 'Edward Norton', 'Helena Bonham Carter', 'Meat Loaf'],
  providers: offers('Disney Plus'), status: 'watched', rating: 9,
  notes: 'Die erste Regel: nicht drüber reden. Habe ich trotzdem getan.',
}, { watches: ['2005', '2014-03', day(-400)], added: -900 });

await film({
  tmdb_id: 603, title: 'Matrix', original_title: 'The Matrix', release_date: '1999-03-30', runtime: 136,
  overview: 'Der Hacker Neo erfährt, dass die Welt, wie er sie kennt, eine Simulation ist.',
  genres: ['Action', 'Science Fiction'], director: 'Lana Wachowski, Lilly Wachowski', cast_names: ['Keanu Reeves', 'Laurence Fishburne', 'Carrie-Anne Moss'],
  providers: offers('Netflix', 'WOW'), status: 'watched', rating: 8,
}, { watches: [null, day(-30)], added: -700 }); // once long ago (no idea when), once last month

await film({
  tmdb_id: 13, title: 'Forrest Gump', release_date: '1994-07-06', runtime: 142,
  overview: 'Das Leben ist wie eine Schachtel Pralinen.', genres: ['Komödie', 'Drama', 'Liebesfilm'], director: 'Robert Zemeckis',
  cast_names: ['Tom Hanks', 'Robin Wright', 'Gary Sinise'], status: 'watched', rating: 7,
}, { watches: ['2010'], poster: false, added: -650 }); // no poster

await film({
  tmdb_id: 680, title: 'Pulp Fiction', release_date: '1994-09-10', runtime: 154,
  overview: 'Verflochtene Geschichten aus der Unterwelt von Los Angeles.', genres: ['Thriller', 'Krimi'], director: 'Quentin Tarantino',
  cast_names: ['John Travolta', 'Samuel L. Jackson', 'Uma Thurman', 'Bruce Willis'], providers: offers('Netflix'), status: 'watched', rating: 10,
}, { watches: [day(0)], added: -5 }); // watched today

await film({
  tmdb_id: 27205, title: 'Inception', release_date: '2010-07-15', runtime: 148, genres: ['Action', 'Science Fiction', 'Abenteuer'],
  director: 'Christopher Nolan', cast_names: ['Leonardo DiCaprio', 'Joseph Gordon-Levitt', 'Elliot Page'], status: 'watched',
  overview: 'Ein Dieb, der Geheimnisse aus Träumen stiehlt, soll diesmal einen Gedanken einpflanzen.',
}, { watches: ['2010-08'], added: -800 }); // no rating

await film({
  tmdb_id: 155, title: 'The Dark Knight', release_date: '2008-07-16', runtime: 152, genres: ['Drama', 'Action', 'Krimi', 'Thriller'],
  director: 'Christopher Nolan', cast_names: ['Christian Bale', 'Heath Ledger', 'Aaron Eckhart'], status: 'watched', rating: 9,
}, { watches: ['2008-08-21', '2012-07', day(-120)], added: -1200 });

await film({
  tmdb_id: 194, title: 'Die fabelhafte Welt der Amélie', original_title: 'Le Fabuleux Destin d’Amélie Poulain', release_date: '2001-04-25', runtime: 122,
  tagline: 'Sie wird Ihr Leben verändern.', genres: ['Komödie', 'Liebesfilm'], director: 'Jean-Pierre Jeunet', cast_names: ['Audrey Tautou', 'Mathieu Kassovitz'],
  overview: 'Amélie beschließt, das Leben der Menschen um sie herum heimlich ein wenig schöner zu machen.', providers: offers('Arte'), status: 'watchlist',
}, { added: -2 });

await film({
  tmdb_id: 129, title: 'Chihiros Reise ins Zauberland', original_title: '千と千尋の神隠し', release_date: '2001-07-20', runtime: 125,
  genres: ['Animation', 'Familie', 'Fantasy'], director: 'Hayao Miyazaki', cast_names: ['Rumi Hiiragi', 'Miyu Irino'], providers: offers('Netflix'), status: 'watchlist',
  overview: 'Die zehnjährige Chihiro gerät in eine Welt der Geister und muss ihre Eltern retten, die in Schweine verwandelt wurden.',
}, { added: -20 });

await film({
  tmdb_id: 157336, title: 'Interstellar', release_date: '2014-11-05', runtime: 169, genres: ['Abenteuer', 'Drama', 'Science Fiction'],
  director: 'Christopher Nolan', status: 'watchlist',
}, { poster: false, added: -45 }); // no poster, no overview

await film({
  tmdb_id: 238, title: 'Der Pate', original_title: 'The Godfather', release_date: '1972-03-14', runtime: 175, genres: ['Drama', 'Krimi'],
  director: 'Francis Ford Coppola', cast_names: ['Marlon Brando', 'Al Pacino', 'James Caan'], status: 'dropped',
  notes: 'Nach einer Stunde eingeschlafen. Irgendwann nochmal, aber ausgeschlafen.',
}, { added: -300 });

// --- films entered by hand ---

await film({ title: 'Irgendein Film, den Jonas empfohlen hat', status: 'watchlist' }, { poster: false, added: -1 }); // just a title
await film({
  title: 'Der Film, der erst in ein paar Monaten rauskommt', status: 'watchlist', releaseDate: day(120).slice(0, 7), genres: ['Komödie'],
}, { poster: false, added: -10 });
await film({
  title: 'Hochzeitsvideo Sophie & Tobias', status: 'watched', releaseDate: day(-200), runtime: 94, rating: 6,
  notes: 'Die Rede vom Trauzeugen ab Minute 41.',
}, { watches: [day(-190)], poster: false, added: -195 });
await film({
  title: 'Das wundersame Leben des Herrn Ömer Çelik-Groß, der auszog, das Fürchten zu verlernen – Teil Ⅱ: Rückkehr nach Übersee (Director’s Cut, restaurierte Fassung)',
  status: 'watchlist', releaseDate: '1987', runtime: 213, director: 'Jean-Luc Größenwahn-Ångström', genres: ['Drama', 'Abenteuer', 'Historie', 'Komödie', 'Musik'],
  overview: 'Ein sehr langer Titel, um zu sehen, wie er umbricht. Und eine Beschreibung mit Sonderzeichen: € ½ ° ß — „deutsch“ »französisch« <b>kein HTML</b> & so weiter.',
}, { added: -15 }); // with its own photo
await film({ title: 'Langweiliger Kunstfilm', status: 'dropped', releaseDate: '2019', runtime: 181, notes: 'Nach 20 Minuten aufgegeben.' }, { poster: false, added: -60 });

// 200 films, to scroll through and fill the statistics: five years of watching, some on the
// watchlist, a few dropped, every second one with a poster
const WORDS = ['Sommer', 'Nächte', 'Mord', 'Liebe', 'Regen', 'Schatten', 'Stille', 'Geister', 'Funken', 'Sturm'];
const PLACES = ['Lissabon', 'Wien', 'Kreuzberg', 'Tokio', 'Marseille', 'Oslo', 'Palermo', 'Reykjavík', 'Kopenhagen', 'Dresden',
  'Neapel', 'Kairo', 'Montréal', 'Göteborg', 'Zürich', 'Łódź', 'Brügge', 'Sevilla', 'Tiflis', 'Ålesund'];
const GENRES = ['Drama', 'Komödie', 'Thriller', 'Krimi', 'Liebesfilm', 'Dokumentarfilm', 'Horror', 'Science Fiction', 'Animation', 'Western'];
const DIRECTORS = ['Ingrid Halvorsen', 'Paolo Ferretti', 'Agnieszka Nowak', 'Kenji Morimoto', 'Hélène Durand', 'Max Brenner', 'Aylin Demir'];
for (let i = 0; i < 200; i++) {
  const title = `${WORDS[i % 10]} in ${PLACES[Math.floor(i / 10)]}`;
  const status = i % 7 === 3 ? 'watchlist' : i % 23 === 5 ? 'dropped' : 'watched';
  const watched = day(-((i * 37) % 1800) - 1);
  const watches = status !== 'watched' ? [] : i % 17 === 0 ? [`${Number(watched.slice(0, 4)) - 3}`, watched] : i % 11 === 0 ? [watched.slice(0, 4)] : [watched];
  await film({
    title,
    status,
    releaseDate: String(1960 + ((i * 7) % 66)),
    runtime: 80 + ((i * 13) % 100),
    director: DIRECTORS[i % DIRECTORS.length],
    genres: [GENRES[i % 10], ...(i % 3 ? [] : [GENRES[(i + 4) % 10]])],
    rating: status === 'watched' && i % 4 ? 1 + ((i * 3) % 10) : null,
  }, { watches, poster: i % 2 === 0, added: -((i * 37) % 1800) - 2 });
}

// --- series from TMDB ---

// Half watched: seasons 1 and 2 out, season 3 coming out week by week. Seen up to 2×6.
const severance = await series({
  tmdb_id: 95396, title: 'Severance', tagline: 'Arbeit und Privatleben, sauber getrennt.', first_air_date: '2022-02-18', last_air_date: day(0),
  tmdb_status: 'Returning Series', genres: ['Drama', 'Mystery', 'Science Fiction'], creators: 'Dan Erickson', networks: ['Apple TV+'],
  cast_names: ['Adam Scott', 'Britt Lower', 'Zach Cherry', 'John Turturro'], episode_runtime: 50, next_air_date: day(7),
  overview: 'Die Angestellten von Lumon haben sich einem Eingriff unterzogen, der ihre Erinnerungen an Arbeit und Privatleben trennt.',
  providers: offers('Apple TV+'), status: 'watching', rating: 9,
}, [
  { air: '2022-02-18', count: 9, runtime: 55 },
  { air: '2025-01-17', count: 10, runtime: 50 },
  { air: day(-21), count: 10, runtime: 50 }, // four out (the latest today), six to come
], { added: -400 });
watch(severance, (e, i) => (e.season === 1 ? shift('2024-02-01', i) : e.season === 2 && e.number <= 6 ? day(-60 + e.number * 2) : false));

// Ended, in the middle of season 2
const dark = await series({
  tmdb_id: 70523, title: 'Dark', first_air_date: '2017-12-01', last_air_date: '2020-06-27', tmdb_status: 'Ended',
  genres: ['Krimi', 'Drama', 'Mystery', 'Sci-Fi & Fantasy'], creators: 'Baran bo Odar, Jantje Friese', networks: ['Netflix'],
  cast_names: ['Louis Hofmann', 'Lisa Vicari', 'Maja Schöne', 'Oliver Masucci'], episode_runtime: 55, providers: offers('Netflix'), status: 'watching',
  overview: 'Das Verschwinden zweier Kinder in der Kleinstadt Winden offenbart die Beziehungen von vier Familien – über mehrere Generationen hinweg.',
}, [{ air: '2017-12-01', count: 10, every: 0 }, { air: '2019-06-21', count: 8, every: 0 }, { air: '2020-06-27', count: 8, every: 0 }], { added: -40 });
watch(dark, (e, i) => (i < 13 ? day(-35 + i * 2) : false));

// Caught up with a running show: nothing to watch until the next season starts
const boys = await series({
  tmdb_id: 76479, title: 'The Boys', first_air_date: '2019-07-25', tmdb_status: 'Returning Series', genres: ['Sci-Fi & Fantasy', 'Action & Adventure'],
  creators: 'Eric Kripke', networks: ['Prime Video'], cast_names: ['Karl Urban', 'Jack Quaid', 'Antony Starr'], episode_runtime: 60,
  next_air_date: day(30), providers: offers('Amazon Prime Video'), status: 'watching', rating: 7,
}, [
  { air: '2019-07-26', count: 8, every: 0 }, { air: '2020-09-04', count: 8 }, { air: '2022-06-03', count: 8 }, { air: '2024-06-13', count: 8 },
  { air: day(30), count: 8 },
], { added: -900 });
watch(boys, (e, i) => (e.season < 5 ? (e.season < 4 ? null : day(-500 + i)) : false));

// Finished, but still running: season 4 seen, season 5 coming
const bear = await series({
  tmdb_id: 136315, title: 'The Bear: King of the Kitchen', original_title: 'The Bear', first_air_date: '2022-06-23', tmdb_status: 'Returning Series',
  genres: ['Drama', 'Komödie'], creators: 'Christopher Storer', networks: ['FX'], cast_names: ['Jeremy Allen White', 'Ayo Edebiri', 'Ebon Moss-Bachrach'],
  episode_runtime: 32, next_air_date: day(45), providers: offers('Disney Plus'), status: 'finished', rating: 8,
}, [
  { air: '2022-06-23', count: 8, every: 0 }, { air: '2023-06-22', count: 10, every: 0 }, { air: '2024-06-26', count: 10, every: 0 },
  { air: '2025-06-25', count: 10, every: 0 }, { air: day(45), count: 10, every: 0 },
], { added: -800 });
watch(bear, (e, i) => (e.season < 5 ? shift('2025-07-01', i) : false));

// Paused, with 770 episodes: seasons 1–10 seen (imported, so no dates), the current season running
const simpsons = await series({
  tmdb_id: 456, title: 'Die Simpsons', original_title: 'The Simpsons', first_air_date: '1989-12-17', tmdb_status: 'Returning Series',
  genres: ['Animation', 'Komödie', 'Familie'], creators: 'Matt Groening', networks: ['FOX'], cast_names: ['Dan Castellaneta', 'Julie Kavner', 'Nancy Cartwright', 'Yeardley Smith'],
  episode_runtime: 22, next_air_date: day(4), providers: offers('Disney Plus'), status: 'paused', notes: 'Ab Staffel 11 wird es zäh.',
}, [
  ...Array.from({ length: 34 }, (_, i) => ({ air: `${1989 + i}-09-${i ? '25' : '17'}`, count: 22, runtime: 22 })),
  { air: day(-60), count: 22, runtime: 22 },
], { added: -1500 });
watch(simpsons, (e) => (e.season <= 10 ? null : false));

// Finished and ended; the first seasons imported without dates
const breakingBad = await series({
  tmdb_id: 1396, title: 'Breaking Bad', first_air_date: '2008-01-20', last_air_date: '2013-09-29', tmdb_status: 'Ended', genres: ['Drama', 'Krimi'],
  creators: 'Vince Gilligan', networks: ['AMC'], cast_names: ['Bryan Cranston', 'Aaron Paul', 'Anna Gunn'], episode_runtime: 47,
  providers: offers('Netflix'), status: 'finished', rating: 10,
  overview: 'Ein Chemielehrer mit Krebsdiagnose beginnt, Methamphetamin herzustellen, um die Zukunft seiner Familie zu sichern.',
}, [
  { air: '2008-01-20', count: 7 }, { air: '2009-03-08', count: 13 }, { air: '2010-03-21', count: 13 }, { air: '2011-07-17', count: 13 }, { air: '2012-07-15', count: 16 },
], { added: -2000 });
watch(breakingBad, (e, i) => (e.season <= 3 ? null : shift('2022-01-10', i)));

const chernobyl = await series({
  tmdb_id: 87108, title: 'Chernobyl', first_air_date: '2019-05-06', last_air_date: '2019-06-03', tmdb_status: 'Ended', genres: ['Drama'],
  creators: 'Craig Mazin', networks: ['HBO'], cast_names: ['Jared Harris', 'Stellan Skarsgård', 'Emily Watson'], episode_runtime: 65,
  providers: offers('WOW'), status: 'finished', rating: 9,
}, [{ air: '2019-05-06', count: 5 }], { added: -380 });
watch(chernobyl, (e, i) => day(-370 + i));

// Dropped after season 2
const got = await series({
  tmdb_id: 1399, title: 'Game of Thrones', first_air_date: '2011-04-17', last_air_date: '2019-05-19', tmdb_status: 'Ended',
  genres: ['Sci-Fi & Fantasy', 'Drama', 'Action & Adventure'], creators: 'David Benioff, D. B. Weiss', networks: ['HBO'],
  cast_names: ['Emilia Clarke', 'Kit Harington', 'Peter Dinklage'], episode_runtime: 60, providers: offers('WOW'), status: 'dropped', rating: 5,
  notes: 'Zu viel Gemetzel, zu wenig Drachen.',
}, [
  { air: '2011-04-17', count: 10 }, { air: '2012-04-01', count: 10 }, { air: '2013-03-31', count: 10 }, { air: '2014-04-06', count: 10 },
  { air: '2015-04-12', count: 10 }, { air: '2016-04-24', count: 10 }, { air: '2017-07-16', count: 7 }, { air: '2019-04-14', count: 6 },
], { added: -1100 });
watch(got, (e, i) => (e.season <= 2 ? shift('2021-03-01', i * 3) : false));

// On the watchlist: one with a poster, one without
await series({
  tmdb_id: 100088, title: 'The Last of Us', first_air_date: '2023-01-15', tmdb_status: 'Returning Series', genres: ['Drama', 'Sci-Fi & Fantasy'],
  creators: 'Craig Mazin, Neil Druckmann', networks: ['HBO'], cast_names: ['Pedro Pascal', 'Bella Ramsey'], episode_runtime: 55, providers: offers('WOW'), status: 'watchlist',
}, [{ air: '2023-01-15', count: 9 }, { air: '2025-04-13', count: 7 }], { added: -25 });
await series({
  tmdb_id: 66732, title: 'Stranger Things', first_air_date: '2016-07-15', last_air_date: '2025-12-31', tmdb_status: 'Ended',
  genres: ['Sci-Fi & Fantasy', 'Mystery', 'Drama'], creators: 'Matt Duffer, Ross Duffer', networks: ['Netflix'], episode_runtime: 60, status: 'watchlist',
}, [
  { air: '2016-07-15', count: 8, every: 0 }, { air: '2017-10-27', count: 9, every: 0 }, { air: '2019-07-04', count: 8, every: 0 },
  { air: '2022-05-27', count: 9, every: 0 }, { air: '2025-11-26', count: 8, every: 0 },
], { poster: false, added: -3 });

// --- series entered by hand ---

const videos = await series({ title: 'Omas Urlaubsvideos 1987–1995', status: 'watching', episodeRuntime: 45, notes: 'Von VHS digitalisiert.' }, [{ count: 12 }, { count: 8 }], { poster: false, added: -90 });
watch(videos, (e) => (e.season === 1 ? day(-80 + e.number) : false));
const kommissar = await series({
  title: 'Kommissar Rüdiger Weißgerber-Ölschläger ermittelt: Die unglaublichen Fälle zwischen Nordsee, Ostsee und dem Bodensee',
  status: 'paused', firstAirDate: '1994', creators: 'Hans-Jürgen Großkopf', genres: ['Krimi'], episodeRuntime: 89,
}, [{ count: 6 }], { added: -200 }); // with its own photo
watch(kommissar, (e) => (e.number <= 2 ? day(-190 + e.number) : false));
await series({ title: 'Die Serie, von der alle reden (Titel vergessen)', status: 'watchlist' }, [], { poster: false, added: 0 }); // no episodes

// --- dates: when each was added and last changed (no store function sets these) ---

for (const [table, id, created, updated] of stamps) {
  store.db.prepare(`UPDATE ${table} SET created_at = ?, updated_at = ? WHERE id = ?`).run(at(created), at(updated > today ? today : updated), id);
}

console.log(`Sample data: ${counts.films} films, ${counts.series} series with ${counts.episodes} episodes, ${counts.posters} posters`);
store.db.close();
