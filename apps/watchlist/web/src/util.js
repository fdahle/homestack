import { ref } from 'vue';
import { compareText, formatNumber, toDate } from './kit/util.js';
import { hasText, lang, t } from './i18n.js';
import { api } from './api.js';

export * from './kit/util.js';

// --- the two modes: films and series never mix ---

export const MODES = ['films', 'series'];

// Each mode's pages; switching modes keeps you on the same kind of page
export const PATHS = {
  films: { library: '/filme', add: '/filme/neu', stats: '/filme/statistik' },
  series: { library: '/serien', add: '/serien/neu', stats: '/serien/statistik', upnext: '/serien/weiter' },
};

const MODE_KEY = 'watchlist.mode';
function storedMode() {
  try {
    return localStorage.getItem(MODE_KEY) === 'series' ? 'series' : 'films';
  } catch {
    return 'films';
  }
}

// The mode you were in last (the start page opens it; settings keep its tabs)
export const lastMode = ref(storedMode());

export function rememberMode(mode) {
  if (!MODES.includes(mode)) return;
  lastMode.value = mode;
  document.documentElement.dataset.mode = mode;
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // private window: the mode is only remembered until the page closes
  }
}

// Where a film or series opens (base: another list page that shows it beside itself)
export const itemPath = (mode, id, base = PATHS[mode].library) => `${base}/${id}`;

// --- statuses ---

export const FILM_STATUSES = ['watchlist', 'watched', 'dropped'];
export const SERIES_STATUSES = ['watchlist', 'watching', 'paused', 'finished', 'dropped'];
export const STATUSES = { films: FILM_STATUSES, series: SERIES_STATUSES };
export const STATUS_ICONS = { watchlist: 'bookmark', watched: 'eye', watching: 'play', paused: 'pause', finished: 'check', dropped: 'stop' };
// What you watched (at least some of), not just meant to
export const SEEN = { films: ['watched', 'dropped'], series: ['watching', 'paused', 'finished', 'dropped'] };

// --- posters ---

export const posterUrl = (item) => (item?.poster_file ? `/posters/${item.poster_file}` : null);
// TMDB's pictures through the server: search thumbnails, streaming logos
export const tmdbImage = (path, size = 'w92') => (path ? `/api/tmdb/image/${size}${path}` : null);
export const POSTER_SIZE = { width: 500, height: 750 };

// --- formatting ---

// 136 → "2 Std. 16 Min."
export function formatRuntime(minutes) {
  if (!minutes) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return t('time.minutes', { m });
  return m ? t('time.hoursMinutes', { h, m }) : t('time.hours', { h: formatNumber(h) });
}

// Many minutes as hours: 7260 → "121 Std."
export const formatHours = (minutes) => t('time.hours', { h: formatNumber(Math.round(minutes / 60)) });

export const episodeCode = (ep) => t('episode.code', { s: ep.season, e: ep.number });
export const episodeName = (ep) => ep.name || t('episode.numbered', { n: ep.number });

// '2026-11-20' → "20. Nov. 2026"; with weekday: "Fr., 20. Nov."
export function formatDay(iso, { weekday = false } = {}) {
  if (!iso) return '';
  const opts = weekday ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' };
  return new Intl.DateTimeFormat(lang.value, opts).format(toDate(iso));
}

// The years a series ran: "2008–2013", "seit 2019", "2024"
export function airYears(s) {
  const from = s.first_air_date?.slice(0, 4);
  if (!from) return '';
  const ended = ['Ended', 'Canceled'].includes(s.tmdb_status);
  const to = s.last_air_date?.slice(0, 4);
  if (ended) return to && to !== from ? `${from}–${to}` : from;
  return s.tmdb_id ? t('series.since', { year: from }) : from;
}

// --- lists ---

// Counts per year (Map year → n) as bar rows, newest first. Years without any are shown
// when the span is short (a gap is worth seeing); over a long span only the years with entries.
export function yearRows(counts) {
  const years = [...counts.keys()].sort((a, b) => b - a);
  if (years[0] - years[years.length - 1] > 12) return years.map((y) => [String(y), counts.get(y)]);
  const rows = [];
  for (let y = years[0]; y >= years[years.length - 1]; y--) rows.push([String(y), counts.get(y) || 0]);
  return rows;
}

export const byTitle = (a, b) => compareText(a.title, b.title);

// --- the server's settings (TMDB on or off, streaming country), asked for once ---

let settingsRequest = null;
export function serverSettings() {
  settingsRequest ??= api('/settings').catch((err) => {
    settingsRequest = null;
    throw err;
  });
  return settingsRequest;
}
// After changing them on the settings page
export const replaceServerSettings = (settings) => (settingsRequest = Promise.resolve(settings));

// Streaming offers change; the page asks for new ones when they are older than this
export const providersStale = (item) => item?.tmdb_id && (!item.providers_at || Date.now() - Date.parse(item.providers_at) > 3 * 86_400_000);

// The last change made on a film's or series' page: { mode, id, item } or { mode, id, deleted: true }.
// The library beside it watches this instead of loading everything again.
export const itemChange = ref(null);

// --- countries a title comes from (ISO codes from TMDB: 'US', 'DE', …) ---

// Every country there is, for picking one for a title entered by hand
export const COUNTRY_CODES = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI '
  + 'CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP '
  + 'GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK '
  + 'LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA '
  + 'PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF '
  + 'TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ');

let regionNames = null;
// 'DE' → "Deutschland" in the interface language. Countries that no longer exist (TMDB still
// uses SU, YU, …) and a few long official names come from i18n.js.
export function countryName(code) {
  if (hasText(`countries.${code}`)) return t(`countries.${code}`);
  if (regionNames?.lang !== lang.value) {
    try {
      regionNames = { lang: lang.value, names: new Intl.DisplayNames([lang.value], { type: 'region' }) };
    } catch {
      return code;
    }
  }
  try {
    return regionNames.names.of(code) || code;
  } catch {
    return code;
  }
}

export const countriesText = (item) => (item?.countries || []).map(countryName).join(', ');
