// Covers from Comic Vine, in the background and separate from the GCD queue:
// 1. each collected series is linked to a Comic Vine volume (automatically when
//    one clearly fits: same start year, similar issue count, same publisher;
//    otherwise it waits for the user to pick one),
// 2. the volume's issue list gives every issue the cover URL for its number,
// 3. the covers are downloaded one at a time and stored like the others.
// Covers you photographed and covers already stored are never replaced.

import * as store from './db.js';
import { downloadCover, removeCoverFiles } from './catalog.js';
import { COMICVINE_ENABLED, ComicVineBusyError, matchScore, searchVolumes, volumeIssues } from './comicvine.js';

const DAY_MS = 24 * 3_600_000;
const DOWNLOAD_SPACING_MS = 2000;
const AUTO_MIN_SCORE = 6; // e.g. same start year + issue count within 10%

let wakeUp = null;
export const wakeCovers = () => wakeUp?.();

// Comic Vine volumes for a series, best fits first
export async function volumeCandidates(series, query) {
  const issueCount = store.db.prepare('SELECT COUNT(DISTINCT number) AS n FROM issues WHERE series_id = ?').get(series.id).n;
  const volumes = await searchVolumes(query || series.name);
  return volumes
    .map((v) => ({ ...v, score: matchScore(series, v, issueCount) }))
    .sort((a, b) => b.score - a.score);
}

// Links a series to a volume (or to none) and replaces the covers that came from Comic Vine
export async function linkVolume(seriesId, volume) {
  await removeCoverFiles(store.clearCvCovers(seriesId));
  store.setCvVolume(seriesId, volume ? { volumeId: volume.id, name: volume.name, state: 'manual' } : { state: 'none' });
  wakeCovers();
}

export function seriesCvStatus(seriesId) {
  const s = store.getSeries(seriesId);
  const q = store.seriesCvQueue(seriesId);
  return {
    enabled: COMICVINE_ENABLED,
    state: s?.cv_state ?? null,
    volume: s?.cv_volume_id ? { id: s.cv_volume_id, name: s.cv_volume_name } : null,
    synced: Boolean(s?.cv_synced_at),
    waiting: q.waiting,
    doneAt: q.last ? new Date(Date.now() + q.last * DOWNLOAD_SPACING_MS).toISOString() : null,
  };
}

async function matchOne(series) {
  const candidates = await volumeCandidates(series);
  const [best, second] = candidates;
  if (best && best.score >= AUTO_MIN_SCORE && (!second || best.score - second.score >= 2)) {
    store.setCvVolume(series.id, { volumeId: best.id, name: best.name, state: 'auto' });
    console.log(`Comic Vine: "${series.name}" linked to "${best.name}" (${best.id})`);
  } else {
    store.setCvVolume(series.id, { state: 'unmatched' });
  }
}

async function runOnce() {
  const toMatch = store.seriesNeedingCvMatch();
  if (toMatch) {
    await matchOne(toMatch);
    return 0;
  }
  const toSync = store.seriesNeedingCvSync(new Date(Date.now() - 7 * DAY_MS).toISOString());
  if (toSync) {
    store.assignCvCovers(toSync.id, await volumeIssues(toSync.cv_volume_id));
    return 0;
  }
  const issue = store.nextCvCover();
  if (issue) {
    try {
      await downloadCover(issue.id, issue.cv_cover_url, 'cv');
    } catch (err) {
      // Don't try this one again until the next sync of the series
      console.warn(`Comic Vine cover for issue ${issue.id}: ${err.message}`);
      store.updateIssueInfo(issue.id, { cv_cover_url: null });
    }
    return DOWNLOAD_SPACING_MS;
  }
  return 10 * 60_000;
}

export async function startCoverWorker() {
  if (!COMICVINE_ENABLED) return;
  for (;;) {
    let delay;
    try {
      delay = await runOnce();
    } catch (err) {
      if (err instanceof ComicVineBusyError) delay = Math.max(60_000, Date.parse(err.retryAt) - Date.now());
      else {
        console.warn(`Comic Vine: ${err.message}`);
        delay = 5 * 60_000;
      }
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, delay);
      wakeUp = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    wakeUp = null;
  }
}
