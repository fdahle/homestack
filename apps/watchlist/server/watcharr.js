// Watcharr's data → Watchlist's. Watcharr (github.com/sbondCo/Watcharr) keeps one "watched"
// entry per title and user, and exports them from its profile page as a JSON array:
//
//   [{ status: 'PLANNED' | 'WATCHING' | 'FINISHED' | 'HOLD' | 'DROPPED', rating: 0–10 (decimals allowed, 0 = none),
//      thoughts, createdAt, updatedAt,
//      content: { tmdbId, title, type: 'movie' | 'tv', release_date, … },     (or game: {…} for games)
//      activity: [{ type, data, customDate, createdAt, countAsPlay }],
//      watchedSeasons: [{ seasonNumber, status, updatedAt }],
//      watchedEpisodes: [{ seasonNumber, episodeNumber, status, createdAt, updatedAt }] }]
//
// Its SQLite database has the same things in the tables watcheds, contents, activities,
// watched_seasons and watched_episodes; import-watcharr.js turns those rows into this shape.
// No database and no network here, so it can be tested on its own.

const FILM_STATUS = { PLANNED: 'watchlist', FINISHED: 'watched', DROPPED: 'dropped' };
const SERIES_STATUS = { PLANNED: 'watchlist', WATCHING: 'watching', HOLD: 'paused', FINISHED: 'finished', DROPPED: 'dropped' };

// Watcharr's times: ISO from the export, '2024-03-01 20:15:00.123+01:00' from its database.
// Go's zero time (year 1) means "not set". → 'YYYY-MM-DD' in the server's time zone.
export function timeOf(value) {
  if (!value) return null;
  const s = String(value).trim();
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T').replace(/ ?([+-]\d{2}:?\d{2}|Z)$/, '$1'));
  return Number.isNaN(d.getTime()) || d.getFullYear() < 1900 ? null : d;
}

export function dayOf(value) {
  const d = timeOf(value);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null;
}

const activityDay = (a) => dayOf(a.customDate) || dayOf(a.createdAt);

function parseData(data) {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

// Activities that mean "watched it (again)": Watcharr marks them as plays (countAsPlay,
// newer versions); older ones only have the status change to FINISHED.
function isPlay(a) {
  if (a.countAsPlay) return true;
  if (a.type === 'STATUS_CHANGED') return a.data === 'FINISHED';
  if (a.type === 'ADDED_WATCHED') return parseData(a.data)?.status === 'FINISHED';
  return a.type === 'IMPORTED_ADDED_WATCHED';
}

// The days a film was watched, oldest first, one per day
export function watchDays(activity) {
  return [...new Set((activity || []).filter((a) => !a.deletedAt && isPlay(a)).map(activityDay).filter(Boolean))].sort();
}

function rating(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(10, n) : null;
}

const notes = (v) => String(v || '').trim().slice(0, 20_000) || null;

// One Watcharr entry → { mode: 'films', tmdbId, title, … } or { mode: 'series', … },
// or { skip: reason } for what Watchlist doesn't keep (games, entries without TMDB id).
//
// Films: PLANNED → watchlist, FINISHED → watched, DROPPED → dropped. WATCHING and HOLD
// (started, not finished) → watched if Watcharr has a watch date for it, else watchlist.
// Each play becomes a watch; a FINISHED film without any date gets one undated watch.
//
// Series: PLANNED → watchlist, WATCHING → watching, HOLD → paused, FINISHED → finished,
// DROPPED → dropped. Episodes and seasons marked FINISHED become watched episodes; a
// FINISHED series also gets all its aired episodes ticked (allWatched).
export function fromWatcharr(entry) {
  if (!entry || typeof entry !== 'object') return { skip: 'invalid' };
  if (entry.deletedAt && !String(entry.deletedAt).startsWith('0001')) return { skip: 'deleted' };
  const content = entry.content;
  if (!content) return { skip: entry.game ? 'game' : 'invalid' };
  const title = String(content.title || '').trim() || `TMDB ${content.tmdbId}`;
  const tmdbId = Number(content.tmdbId);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return { skip: 'no_tmdb_id', title };
  const base = {
    tmdbId,
    title,
    rating: rating(entry.rating),
    notes: notes(entry.thoughts),
    createdAt: timeOf(entry.createdAt)?.toISOString() || null,
  };

  if (content.type === 'movie') {
    const watches = watchDays(entry.activity);
    let status = FILM_STATUS[entry.status];
    if (!status) status = watches.length ? 'watched' : 'watchlist';
    if (status === 'watched' && !watches.length) watches.push(null);
    return { mode: 'films', ...base, status, watches };
  }

  if (content.type === 'tv') {
    const episodes = (entry.watchedEpisodes || [])
      .filter((e) => e.status === 'FINISHED' && e.seasonNumber > 0 && e.episodeNumber > 0)
      .map((e) => ({ season: e.seasonNumber, number: e.episodeNumber, on: dayOf(e.updatedAt) || dayOf(e.createdAt) }));
    const seasons = (entry.watchedSeasons || [])
      .filter((s) => s.status === 'FINISHED' && s.seasonNumber > 0)
      .map((s) => ({ season: s.seasonNumber, on: dayOf(s.updatedAt) || dayOf(s.createdAt) }));
    let status = SERIES_STATUS[entry.status];
    if (!status) status = episodes.length || seasons.length ? 'watching' : 'watchlist';
    // When the show was marked as finished: the last change to FINISHED, if Watcharr kept one
    const finishedOn = status === 'finished'
      ? (entry.activity || []).filter((a) => a.type === 'STATUS_CHANGED' && a.data === 'FINISHED').map(activityDay).filter(Boolean).sort().pop() || null
      : null;
    return { mode: 'series', ...base, status, episodes, seasons, allWatched: status === 'finished', finishedOn };
  }

  return { skip: 'other_type', title };
}

// Rows from Watcharr's database → entries shaped like its export (column names are
// gorm's snake_case versions of the fields above).
export function entriesFromRows({ watched, activities = [], seasons = [], episodes = [] }) {
  const group = (rows) => {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.watched_id)) map.set(r.watched_id, []);
      map.get(r.watched_id).push(r);
    }
    return map;
  };
  const acts = group(activities);
  const seas = group(seasons);
  const eps = group(episodes);
  return watched.map((w) => ({
    status: w.status,
    rating: w.rating,
    thoughts: w.thoughts,
    createdAt: w.created_at,
    updatedAt: w.updated_at,
    content: w.content_id != null ? { tmdbId: w.tmdb_id, title: w.title, type: w.type, release_date: w.release_date } : undefined,
    game: w.content_id == null && w.game_id != null ? { id: w.game_id } : undefined,
    activity: (acts.get(w.id) || []).map((a) => ({ type: a.type, data: a.data, customDate: a.custom_date, createdAt: a.created_at, countAsPlay: Boolean(a.count_as_play) })),
    watchedSeasons: (seas.get(w.id) || []).map((s) => ({ seasonNumber: s.season_number, status: s.status, createdAt: s.created_at, updatedAt: s.updated_at })),
    watchedEpisodes: (eps.get(w.id) || []).map((e) => ({ seasonNumber: e.season_number, episodeNumber: e.episode_number, status: e.status, createdAt: e.created_at, updatedAt: e.updated_at })),
  }));
}

// Watched episodes for a series whose episodes are known: [{ id, on }] of the
// episodes not ticked yet. episodes: Watchlist's list ({ id, season, number, air_date, watched }).
export function episodesToTick(imported, episodes, today) {
  const out = new Map();
  const mark = (e, on) => {
    if (!e.watched && !out.has(e.id)) out.set(e.id, on ?? null);
  };
  const find = (season, number) => episodes.find((e) => e.season === season && e.number === number);
  for (const x of imported.episodes || []) {
    const e = find(x.season, x.number);
    if (e) mark(e, x.on);
  }
  for (const s of imported.seasons || []) {
    for (const e of episodes) if (e.season === s.season) mark(e, s.on);
  }
  if (imported.allWatched) {
    for (const e of episodes) if (e.season > 0 && e.air_date && e.air_date <= today) mark(e, imported.finishedOn);
  }
  return [...out].map(([id, on]) => ({ id, on }));
}
