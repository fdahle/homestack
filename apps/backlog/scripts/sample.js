// Sample data for trying Backlog on this computer: `node try.mjs backlog --sample` fills a separate
// data folder (data-sample/) with it, never your real data and never on the server. Dates are
// relative to today. Every blog lives on a made-up .example address, which never resolves, so
// nothing here leads to a real site; all blogs count as just scanned, so nothing is fetched on start.
// It goes in through the app's own store functions, the way scans and clicks put it there.
// Only fills an empty database; `node try.mjs backlog --sample --fresh` starts it over.

import * as store from '../server/db.js';
import { createAuth } from '../server/kit/auth.js';

// The old name of the password setting still works (as in server.js)
process.env.ADMIN_PASSWORD ||= process.env.APP_PASSWORD || '';
await createAuth({ users: store.users, cookie: 'backlog_session' }).ensureAdmin();
if (store.db.prepare('SELECT COUNT(*) AS n FROM blogs').get().n) {
  console.log('Sample data is there already (--fresh starts it over)');
  process.exit(0);
}

// --- helpers ---

const DAY = 86_400_000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();
const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
const slug = (s) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const byUrl = (blogId) => new Map(store.listArticles(blogId, { show: 'all' }).map((a) => [a.url, a]));

// A blog with its history, imported `importedDaysAgo` days ago and last checked `checkedHoursAgo`
// hours ago. `fresh`: posts that came after the import (the "New posts" on the home page).
// The first import happens "back then", so only `fresh` counts as new.
function blog({ name, url, strategy, config, posts, fresh = [], importedDaysAgo, checkedHoursAgo, failed }) {
  const id = store.createBlog({ name, url, strategy, config });
  store.upsertArticles(id, posts);
  store.recordScan(id, true, `${posts.length} new, ${posts.length} found (${Math.ceil(posts.length / 40)}s)`);
  const imported = daysAgo(importedDaysAgo);
  store.db.prepare('UPDATE blogs SET created_at = ?, backfilled_at = ? WHERE id = ?').run(imported, imported, id);
  store.db.prepare('UPDATE articles SET discovered_at = ? WHERE blog_id = ?').run(imported, id);
  if (fresh.length) store.upsertArticles(id, fresh);
  if (failed) store.recordScan(id, false, failed);
  else store.recordScan(id, true, `${fresh.length} new, ${posts.length + fresh.length} found (2s)`);
  store.db.prepare('UPDATE blogs SET last_scan_at = ? WHERE id = ?').run(hoursAgo(checkedHoursAgo), id);
  return id;
}

// Posts every `everyDays` days, the newest `newestDaysAgo` days ago, oldest first
function dated(titles, base, { newestDaysAgo, everyDays }) {
  return titles.map((title, i) => ({
    url: `${base}/${slug(title) || `beitrag-${i + 1}`}/`,
    title,
    published: daysAgo(newestDaysAgo + (titles.length - 1 - i) * everyDays),
  }));
}

// --- Kaffeesatz (WordPress): half read, some for later, new posts ---

const kaffee = blog({
  name: 'Kaffeesatz',
  url: 'https://kaffeesatz.example/',
  strategy: 'wordpress',
  config: { apiUrl: 'https://kaffeesatz.example/wp-json/wp/v2/posts', feedUrl: 'https://kaffeesatz.example/feed/' },
  posts: dated([
    'Hallo Welt – warum dieser Blog?', 'Meine erste Handmühle', 'Espresso ohne Maschine: geht das?', 'Was „Third Wave“ eigentlich heißt',
    'Bohnen richtig lagern', 'Wasserhärte und Geschmack', 'Ein Besuch bei der Rösterei am Hafen', 'French Press: die unterschätzte Methode',
    'Kaffee in Äthiopien', 'Warum mein Cappuccino nie so aussieht wie im Café', 'Aeropress-Rezepte im Vergleich', 'Fünf Mühlen unter 100 €',
    'Kaffeesatz im Garten: Mythos oder Dünger?', 'Die Sache mit dem Crema', 'Cold Brew für Ungeduldige', 'Röstgrade erklärt',
    'Kaffee und Schlaf', 'Eine Woche ohne Kaffee (ein Erfahrungsbericht)', 'Filterpapier: gebleicht oder ungebleicht?', 'Der perfekte Mahlgrad',
    'Milchschaum ohne Dampflanze', 'Kaffee auf Reisen', 'Brasilien, Kolumbien, Kenia: ein Blindtest', 'Wie viel Koffein ist zu viel?',
    'Siebträger kaufen: worauf achten?', 'Entkalken, aber richtig', 'Kaffee aus dem Supermarkt im Test', 'Latte Art für Anfänger',
    'Ein Jahr Kaffeesatz', 'Die Geschichte des Kaffeehauses in Wien', 'Kaffee-Abo: lohnt sich das?', 'Tassen, die den Geschmack ändern',
    'Vom Strauch in die Tasse', 'Was Bauern am Kaffee verdienen', 'Decaf ist besser als sein Ruf', 'Mokka auf dem Gasherd',
    'Kaffee und Schokolade', 'Meine liebsten Cafés in Leipzig', 'Ein Gespräch mit einer Röstmeisterin', 'Kaffee im Büro retten',
    'Zwei Jahre Kaffeesatz: was ich gelernt habe', 'Warum Ristretto nicht einfach „weniger Wasser“ ist',
  ], 'https://kaffeesatz.example', { newestDaysAgo: 9, everyDays: 17 }),
  fresh: dated(['Kaffee aus dem Kühlschrank? Ein Experiment', 'Die neue Mühle ist da', 'Winterrezepte: Gewürzkaffee'], 'https://kaffeesatz.example', { newestDaysAgo: 0.2, everyDays: 3 }),
  importedDaysAgo: 8,
  checkedHoursAgo: 2,
});
{
  const posts = store.listArticles(kaffee, { show: 'all' });
  store.markOlderRead(posts[19].id); // read up to post 20, the way "this and all older" does it
  store.setReadMany([posts[24].id, posts[30].id], true); // read out of order
  for (const i of [21, 27, 33]) store.setArticleFlags(posts[i].id, { starred: true });
  store.setArticleFlags(posts[5].id, { starred: true }); // starred and read: not in "Read later"
}

// --- Bahnfahrer (Substack): all read ---

const bahn = blog({
  name: 'Bahnfahrer',
  url: 'https://bahnfahrer.example/',
  strategy: 'substack',
  config: { apiUrl: 'https://bahnfahrer.example/api/v1/archive', feedUrl: 'https://bahnfahrer.example/feed' },
  posts: dated([
    'Mit dem Nachtzug nach Wien', 'Warum der ICE in Fulda hält', 'Die schönsten Nebenbahnen im Harz', 'Deutschlandticket: ein Jahr später',
    'Umsteigen in Hamm (Westf)', 'Der Bahnhof, der nie fertig wurde', 'Von Basel nach Brig über den Lötschberg', 'Interrail mit 40',
    'Verspätung: eine kleine Statistik', 'Zugfahren mit Kindern', 'Die letzte Dampflok im Regelbetrieb', 'Bahnhofsuhren',
    'Sitzplatzreservierung: lohnt sich das noch?', 'Schlafwagen damals und heute', 'Die Brennerbahn', 'Warum Züge pfeifen',
  ], 'https://bahnfahrer.example/p', { newestDaysAgo: 4, everyDays: 14 }),
  importedDaysAgo: 120,
  checkedHoursAgo: 5,
});
store.setReadMany(store.listArticles(bahn, { show: 'all' }).map((a) => a.id), true);

// --- Mittelalter (sitemap): ~250 posts, to see a long list and scrolling ---

const TOPICS = [
  'Burgen', 'Klöster', 'die Hanse', 'Ritterorden', 'Pilgerreisen', 'Handschriften', 'die Pest', 'Stadtrechte', 'Zünfte', 'Kreuzzüge',
  'Hexenprozesse', 'Märkte', 'Bauernkriege', 'Kalender', 'Heilkunde', 'Turniere', 'Münzen', 'Brücken', 'Kathedralen', 'Fehden',
];
const FORMS = [
  (t) => `Was wir über ${t} wirklich wissen`, (t) => `${t[0].toUpperCase()}${t.slice(1)} im Alltag`, (t) => `Fünf Irrtümer über ${t}`,
  (t) => `Eine kurze Geschichte über ${t}`, (t) => `Quellenkunde: ${t}`, (t) => `Leserfrage: Wie war das mit ${t}?`,
  (t) => `${t[0].toUpperCase()}${t.slice(1)} – Teil 2`, (t) => `Bücher über ${t}`, (t) => `${t[0].toUpperCase()}${t.slice(1)} in Süddeutschland`,
  (t) => `Ein Ortsbesuch: ${t}`, (t) => `${t[0].toUpperCase()}${t.slice(1)} und das Wetter`, (t) => `Mythos und Wahrheit: ${t}`, (t) => `Kartenmaterial zu ${t}`,
];
const mittelalterTitles = [];
for (let i = 0; i < 247; i++) mittelalterTitles.push(FORMS[i % FORMS.length](TOPICS[(i * 7) % TOPICS.length]));
const mittelalterPosts = mittelalterTitles.map((title, i) => ({
  url: `https://mittelalter-blog.example/${2014 + Math.floor(i / 25)}/${String((i % 12) + 1).padStart(2, '0')}/${slug(title)}-${i + 1}/`,
  title,
  published: daysAgo(30 + (246 - i) * 18),
}));
// Pages a sitemap has without dates: they sort at the end
mittelalterPosts.push(
  { url: 'https://mittelalter-blog.example/glossar/', title: 'Glossar' },
  { url: 'https://mittelalter-blog.example/ueber-die-quellen/', title: 'Über die Quellen' },
);
const mittelalter = blog({
  name: 'Geschichte & Geschichten: Mittelalter',
  url: 'https://mittelalter-blog.example/',
  strategy: 'sitemap',
  config: { exclude: '/(impressum|datenschutz)/' },
  posts: mittelalterPosts,
  fresh: dated(['Neue Funde aus der Grabung in Lübeck'], 'https://mittelalter-blog.example/2026/11', { newestDaysAgo: 1, everyDays: 1 }),
  importedDaysAgo: 60,
  checkedHoursAgo: 1,
});
{
  const posts = store.listArticles(mittelalter, { show: 'all' });
  store.markOlderRead(posts[63].id);
  for (const i of [70, 88, 140]) store.setArticleFlags(posts[i].id, { starred: true });
  store.setArticleFlags(posts.at(-1).id, { ignored: true }); // hidden: not a post
}

// --- Gartenzwerg (feed only): nothing read, last check failed ---

blog({
  name: 'Gartenzwerg',
  url: 'https://gartenzwerg.example/',
  strategy: 'feed',
  config: { feedUrl: 'https://gartenzwerg.example/rss.xml' },
  posts: dated([
    'Tomaten im November?', 'Laub liegen lassen!', 'Hochbeet Nummer drei', 'Igel im Garten', 'Kompost für Faule', 'Saatgut tauschen',
    'Die Schnecken sind zurück', 'Frühbeet aus alten Fenstern', 'Was im Dezember zu tun ist', 'Kartoffeln im Eimer',
  ], 'https://gartenzwerg.example/posts', { newestDaysAgo: 3, everyDays: 6 }),
  fresh: dated(['Wintergemüse: Grünkohl, Rosenkohl und Pastinaken'], 'https://gartenzwerg.example/posts', { newestDaysAgo: 0.5, everyDays: 1 }),
  importedDaysAgo: 30,
  checkedHoursAgo: 3,
  failed: 'HTTP 503 Service Unavailable',
});

// --- a long name, long titles, a post without a title (archive scraping) ---

const LONG = 'Über Ölfässer, Größenwahn & „Sonderzeichen“: Ein Blog mit einem ungewöhnlich langen Namen, der auf dem Handy umbrechen muss';
const lang = blog({
  name: LONG,
  url: 'https://sehr-langer-name.example/',
  strategy: 'archive',
  config: {
    archiveUrl: 'https://sehr-langer-name.example/archiv/',
    linkSelector: '.post-list h2 a',
    nextSelector: 'a.older-posts',
    order: 'newest-first',
    maxPages: '40',
    include: 'sehr-langer-name\\.example/\\d{4}/',
  },
  posts: [
    {
      url: 'https://sehr-langer-name.example/2019/ein-titel/',
      title: 'Eine wirklich sehr, sehr lange Überschrift, um zu sehen, wie der Titel umbricht, wenn jemand alles in die erste Zeile schreibt – inklusive Ümläuten, ß, Sonderzeichen (€, ½, °C, „Anführungszeichen“, ‚einfache‘, « Guillemets ») und Emoji 🚲',
      published: daysAgo(2400),
    },
    { url: 'https://sehr-langer-name.example/2019/kurz/', title: 'Ö', published: daysAgo(2300) },
    // No title found: the address stands in for it
    { url: 'https://sehr-langer-name.example/2020/03/ein/sehr/langer/pfad/ohne-titel?seite=2&sortierung=aelteste-zuerst', published: daysAgo(2100) },
    { url: 'https://sehr-langer-name.example/2021/ohne-datum/', title: 'Ein Beitrag ohne Datum' },
    { url: 'https://sehr-langer-name.example/2021/html/', title: 'Warum <b>HTML</b> in Titeln & Co. nicht ausgeführt wird' },
    {
      url: 'https://sehr-langer-name.example/2022/wort/',
      title: 'Donaudampfschifffahrtselektrizitätenhauptbetriebswerkbauunterbeamtengesellschaft',
      published: daysAgo(1200),
    },
  ],
  fresh: [
    { url: 'https://sehr-langer-name.example/2026/neu-1/', title: 'Neu: Größere Änderungen an der Seite', published: daysAgo(2) },
    { url: 'https://sehr-langer-name.example/2026/neu-2/', title: 'Noch ein neuer Beitrag mit einem Titel, der auf der Startseite ganz sicher zu lang ist, damit man sieht, wie er gekürzt oder umbrochen wird', published: daysAgo(1.5) },
    { url: 'https://sehr-langer-name.example/2026/neu-3/', title: 'Kurz', published: daysAgo(6) },
    { url: 'https://sehr-langer-name.example/2026/neu-4/', title: 'Gefunden, aber ohne Datum' },
    { url: 'https://sehr-langer-name.example/2026/neu-5/', title: 'Fünfter neuer Beitrag', published: daysAgo(7) },
    { url: 'https://sehr-langer-name.example/2026/neu-6/', title: 'Sechster neuer Beitrag', published: daysAgo(8) },
  ],
  importedDaysAgo: 14,
  checkedHoursAgo: 4,
});
{
  const posts = byUrl(lang);
  store.setArticleFlags(posts.get('https://sehr-langer-name.example/2019/ein-titel/').id, { starred: true });
  store.setArticleFlags(posts.get('https://sehr-langer-name.example/2019/kurz/').id, { read: true });
}

// --- just added, nothing found yet: archive scraping still needs its settings ---

blog({
  name: 'Leeres Archiv',
  url: 'https://leeres-archiv.example/',
  strategy: 'archive',
  config: { archiveUrl: 'https://leeres-archiv.example/' },
  posts: [],
  importedDaysAgo: 0.1,
  checkedHoursAgo: 0.05,
  failed: 'Archive scraping needs a link selector (see blog settings)',
});

// --- Discover: what the posts link to, and suggestions in every state ---

// Some read posts have been visited for their links (well under a quarter of all posts, so
// discovery doesn't start on its own)
const LINKED = ['fahrradzeit.example', 'roestwerk.example', 'staedtebau.example', 'alte-karten.example'];
const visited = [...store.listArticles(kaffee, { show: 'read' }), ...store.listArticles(mittelalter, { show: 'read' }).slice(0, 25)];
visited.forEach((a, i) => {
  const links = LINKED.filter((_, j) => (i + j) % 3 === 0).map((host) => ({ host, url: `https://${host}/${slug(a.title)}` }));
  store.saveHarvest(a.id, { links }, { enrich: false });
});

function suggestion({ host, name, description, sources, samples = [], lastPost, status, ok = true }) {
  store.upsertSuggestion({ host, url: `https://${host}`, name, description, sources });
  const s = store.getSuggestionByHost(host);
  store.saveProbe(s.id, { ok, samples, lastPost });
  if (status) store.setSuggestionStatus(s.id, status);
}
const samplePosts = (host, titles) => titles.map((title, i) => ({ url: `https://${host}/${slug(title)}`, title, published: daysAgo(3 + i * 9) }));

suggestion({
  host: 'fahrradzeit.example',
  name: 'Fahrradzeit',
  description: 'Lange Touren, kurze Texte und viel Werkstatt.',
  sources: { links: { posts: 14, score: 9.6, blogs: [{ name: 'Kaffeesatz', n: 9 }, { name: 'Bahnfahrer', n: 5 }] }, substack: ['Bahnfahrer'] },
  samples: samplePosts('fahrradzeit.example', ['Mit dem Rad über die Alpen', 'Kettenpflege im Winter', 'Ein Jahr ohne Auto']),
  lastPost: daysAgo(3),
});
suggestion({
  host: 'roestwerk.example',
  name: 'Röstwerk',
  description: 'Eine kleine Rösterei schreibt über Bohnen, Herkunft und die Arbeit am Röster. '.repeat(3).trim(),
  sources: { links: { posts: 7, score: 5.2, blogs: [{ name: 'Kaffeesatz', n: 7 }] } },
  samples: samplePosts('roestwerk.example', ['Ernte in Kolumbien', 'Wie wir Preise machen']),
  lastPost: daysAgo(12),
});
suggestion({
  host: 'staedtebau.example',
  sources: { links: { posts: 3, score: 2.1, blogs: [{ name: 'Geschichte & Geschichten: Mittelalter', n: 3 }] } },
  lastPost: null,
});
suggestion({
  host: 'sprachlos.example',
  name: 'Sprachlos – über Wörter, die es nur im Deutschen gibt',
  sources: { ai: 'Wer Kaffeesatz und Mittelalter liest, mag wahrscheinlich auch lange Texte über die Herkunft von Wörtern.' },
  samples: samplePosts('sprachlos.example', ['Fernweh', 'Kummerspeck', 'Schadenfreude', 'Torschlusspanik']),
  lastPost: daysAgo(20),
});
suggestion({
  host: 'alte-karten.example',
  name: 'Alte Karten',
  description: 'Historische Landkarten, eine pro Woche.',
  sources: { links: { posts: 5, score: 3.9, blogs: [{ name: 'Geschichte & Geschichten: Mittelalter', n: 5 }] } },
  samples: samplePosts('alte-karten.example', ['Die Ebstorfer Weltkarte']),
  lastPost: daysAgo(6),
  status: 'later',
});
suggestion({
  host: 'nachtzug.example',
  name: 'Nachtzug-Notizen',
  sources: { substack: ['Bahnfahrer'] },
  lastPost: daysAgo(40),
  status: 'later',
});
suggestion({ host: 'nicht-meins.example', name: 'Nicht meins', sources: { substack: ['Bahnfahrer'] }, status: 'dismissed' });
suggestion({ host: 'gartenzwerg.example', name: 'Gartenzwerg', sources: { ai: 'Garten.' }, status: 'added' });
suggestion({ host: 'nachrichten.example', name: 'Nachrichten', sources: { links: { posts: 30, score: 12, blogs: [{ name: 'Bahnfahrer', n: 30 }] } }, ok: false });
// Not checked yet: counted on the Discover page, not shown
store.upsertSuggestion({ host: 'noch-offen.example', url: 'https://noch-offen.example', sources: { links: { posts: 2, score: 1.4, blogs: [{ name: 'Kaffeesatz', n: 2 }] } } });
store.writeJsonSetting('discover_status', { at: daysAgo(2), ok: true, message: '4 linked sites, 2 Substack recommendations, 8 sites checked' });

// --- done ---

const { n: articles } = store.db.prepare('SELECT COUNT(*) AS n FROM articles').get();
console.log(`Sample data: ${store.listBlogs().length} blogs, ${articles} posts, ${store.suggestionHosts().length} suggestions`);
store.db.close();
