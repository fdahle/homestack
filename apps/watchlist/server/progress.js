// Where you are in a series: what has aired, what you have seen, what comes next,
// and when the status changes by itself. Plain functions over episode lists
// ({ id, season, number, air_date, watched, watched_on, runtime }), so they can be tested.

// TMDB's statuses for a show that won't get new episodes
export const ENDED = ['Ended', 'Canceled'];
export const isEnded = (tmdbStatus) => ENDED.includes(tmdbStatus);

export const byEpisode = (a, b) => a.season - b.season || a.number - b.number;

// Episodes from TMDB without a date haven't aired yet. Episodes entered by hand
// have no dates at all, so for those everything counts as aired.
export const isAired = (ep, today, manual = false) => (ep.air_date ? ep.air_date <= today : manual);

const counted = (episodes) => episodes.filter((e) => e.season > 0).sort(byEpisode);

// The episode to watch next: the one after the last one you have seen (so a season
// you skipped on purpose doesn't come back), if it has aired already.
export function nextEpisode(episodes, today, manual = false) {
  const list = counted(episodes);
  let last = -1;
  list.forEach((e, i) => {
    if (e.watched) last = i;
  });
  const next = list[last + 1];
  return next && isAired(next, today, manual) ? next : null;
}

// Episodes still to come, nearest first
export function upcomingEpisodes(episodes, today, limit = 3) {
  return counted(episodes).filter((e) => e.air_date && e.air_date > today && !e.watched).slice(0, limit);
}

// Everything the library and the stats need about one series
export function summary(episodes, today, { manual = false, runtime = null } = {}) {
  const list = counted(episodes);
  const aired = list.filter((e) => isAired(e, today, manual));
  const seen = list.filter((e) => e.watched);
  const years = {};
  let lastWatched = null;
  let minutes = 0;
  for (const e of seen) {
    minutes += e.runtime || runtime || 0;
    if (e.watched_on) {
      const y = e.watched_on.slice(0, 4);
      years[y] = (years[y] || 0) + 1;
      if (!lastWatched || e.watched_on > lastWatched) lastWatched = e.watched_on;
    }
  }
  const next = nextEpisode(list, today, manual);
  return {
    aired: aired.length,
    watched: seen.length,
    // What a progress bar counts: aired episodes, and any you saw before their date
    total: list.filter((e) => e.watched || isAired(e, today, manual)).length,
    left: aired.filter((e) => !e.watched).length,
    next: next ? { id: next.id, season: next.season, number: next.number, name: next.name ?? null, air_date: next.air_date ?? null } : null,
    upcoming: upcomingEpisodes(list, today, 1)[0]?.air_date || null,
    last_watched: lastWatched,
    minutes,
    years,
  };
}

// Whether ticking or unticking episodes moves the series to another status (null = stays).
// Starting a show from the watchlist means you are watching it; having seen every aired
// episode of a show that has ended means you are through with it; and a show you had
// finished, with episodes not seen any more, is one you are watching again.
export function autoStatus(series, episodes, today) {
  const manual = !series.tmdb_id;
  const list = counted(episodes);
  const watched = list.filter((e) => e.watched).length;
  const aired = list.filter((e) => isAired(e, today, manual));
  const allSeen = watched > 0 && aired.length > 0 && aired.every((e) => e.watched);
  const done = allSeen && isEnded(series.tmdb_status);
  if (series.status === 'watchlist' && watched > 0) return done ? 'finished' : 'watching';
  if ((series.status === 'watching' || series.status === 'paused') && done) return 'finished';
  if (series.status === 'finished' && aired.length && !allSeen) return 'watching';
  return null;
}

// The "up next" page. series: [{ id, status, tmdb_status, tmdb_id, episodes, … }].
// next: for each series you are watching, the episode after the last one you saw.
// upcoming: the next dates of shows you follow (watching, paused, or finished but still running).
export function upNext(seriesList, today) {
  const next = [];
  const upcoming = [];
  for (const s of seriesList) {
    const manual = !s.tmdb_id;
    const { episodes, ...series } = s;
    if (s.status === 'watching') {
      const ep = nextEpisode(episodes, today, manual);
      if (ep) {
        const left = counted(episodes).filter((e) => !e.watched && isAired(e, today, manual)).length;
        next.push({ series, episode: ep, left });
      }
    }
    if (['watching', 'paused', 'finished'].includes(s.status) && !isEnded(s.tmdb_status)) {
      for (const ep of upcomingEpisodes(episodes, today, 3)) upcoming.push({ series, episode: ep });
    }
  }
  // Shows you watched most recently first, then the ones waiting longest
  next.sort((a, b) => (b.series.last_watched || '').localeCompare(a.series.last_watched || '') || (b.series.updated_at || '').localeCompare(a.series.updated_at || ''));
  upcoming.sort((a, b) => a.episode.air_date.localeCompare(b.episode.air_date) || a.series.title.localeCompare(b.series.title) || byEpisode(a.episode, b.episode));
  return { next, upcoming };
}
