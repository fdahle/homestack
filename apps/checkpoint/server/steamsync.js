// The Steam sync: reads your Steam library (steam.js), finds each game's IGDB game, and brings
// the games already in Checkpoint up to date. Runs at the start, every STEAM_SYNC_HOURS and
// from the Steam page. Games not in Checkpoint wait there until you bring them in (importSteam).

import * as store from './db.js';
import { gameDetailsMany, IGDB_ENABLED, igdbIdsForSteam } from './igdb.js';
import { nameKey, ownedGames, planSteam, STEAM_ENABLED, steamChanges } from './steam.js';

// A Steam game IGDB didn't know is looked up again after this many days
const RECHECK_DAYS = 30;

export const lastSteamSync = () => store.getJsonSetting('steam_last_sync');

let running = null;

// One sync at a time; a second call while one runs gets the same result.
// → { at, ok, total, updated, waiting, ms, error }
export function syncSteam() {
  running ??= run().finally(() => (running = null));
  return running;
}
export const steamSyncRunning = () => running !== null;

async function run() {
  const started = Date.now();
  const result = { at: store.now(), ok: false, total: 0, updated: 0, waiting: 0 };
  try {
    if (!STEAM_ENABLED) throw Object.assign(new Error('Steam is not set up'), { code: 'steam_not_configured' });
    const owned = await ownedGames();
    store.saveSteamLibrary(owned);
    await matchIgdb();
    const plan = planSteam(store.steamGames(owned.map((g) => g.appid)), store.allGames(), store.localDate());
    for (const { id, fields } of plan.update) store.updateGame(id, fields, { touch: false });
    Object.assign(result, { ok: true, total: owned.length, updated: plan.update.length, waiting: store.steamWaitingCount() });
  } catch (err) {
    result.error = err.code || 'steam_failed';
    result.message = err.message;
  }
  result.ms = Date.now() - started;
  store.setJsonSetting('steam_last_sync', result);
  console.log(result.ok
    ? `Steam sync: ${result.total} games, ${result.updated} updated, ${result.waiting} waiting (${result.ms} ms)`
    : `Steam sync failed: ${result.message}`);
  return result;
}

// IGDB games for the Steam games that don't have one yet (new ones, and once a month the ones
// IGDB didn't know). Without IGDB they stay unmatched and come in by name.
async function matchIgdb() {
  if (!IGDB_ENABLED) return;
  const before = new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString();
  const appids = store.steamGamesToMatch(before);
  if (!appids.length) return;
  try {
    store.setSteamIgdb(appids, await igdbIdsForSteam(appids));
  } catch (err) {
    // Next time; the rest of the sync works without it
    console.warn(`Steam → IGDB: ${err.message}`);
  }
}

// Brings Steam games into Checkpoint: with IGDB's details where IGDB knows them, else by name.
// A game you already have (same IGDB game) is linked instead of added twice.
// → { added: [game ids, for their covers], linked: n }
export async function importSteam(appids) {
  const waiting = new Set(store.steamWaiting().map((g) => g.appid));
  const rows = store.steamGames(appids.filter((a) => waiting.has(a)));
  const today = store.localDate();
  const all = store.allGames();
  const known = new Map(all.filter((g) => g.igdb_id).map((g) => [g.igdb_id, g]));
  // Without an IGDB game, one of the same name (as the sync matches them)
  const byName = new Map(all.filter((g) => !g.steam_appid).map((g) => [nameKey(g.name), g]));
  const details = IGDB_ENABLED ? await gameDetailsMany(rows.filter((r) => r.igdb_id && !known.has(r.igdb_id)).map((r) => r.igdb_id)) : new Map();

  const added = [];
  let linked = 0;
  for (const s of rows) {
    const existing = s.igdb_id ? known.get(s.igdb_id) : byName.get(nameKey(s.name));
    if (existing) {
      // Already in Checkpoint, linked to another Steam game (a second copy): leave this one hidden
      if (existing.steam_appid) store.setSteamHidden(s.appid, true);
      else {
        store.updateGame(existing.id, steamChanges(existing, s, today));
        linked++;
      }
      continue;
    }
    const base = details.get(s.igdb_id) || { name: s.name };
    const fresh = { status: 'backlog', played_on: [] };
    const id = store.insertGame({ ...base, ...fresh, ...steamChanges(fresh, s, today) });
    added.push(id);
    // Two Steam games for the same IGDB game: the second is the copy above
    if (base.igdb_id) known.set(base.igdb_id, { id, steam_appid: s.appid });
    else byName.set(nameKey(s.name), { id, steam_appid: s.appid });
  }
  return { added, linked };
}
