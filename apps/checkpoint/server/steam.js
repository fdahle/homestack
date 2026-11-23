// Steam: the games you own, how long you played each and when you last did. Steam → Checkpoint
// only: Checkpoint never changes anything on Steam.
//
// The Steam Web API (https://steamcommunity.com/dev) needs a key and your Steam ID: the long
// number (SteamID64) or the name in your profile's address (steamcommunity.com/id/<name>).
// Your profile's game details must be public, or Steam answers with an empty list.
//
// The rules (which Checkpoint game a Steam game is, what a sync changes) are at the bottom,
// without network or database, so they can be tested on their own.

export const STEAM_API_KEY = process.env.STEAM_API_KEY || '';
export const STEAM_ID = (process.env.STEAM_ID || '').trim();
export const STEAM_ENABLED = Boolean(STEAM_API_KEY && STEAM_ID);
export const STEAM_SYNC_HOURS = Math.max(0, Number(process.env.STEAM_SYNC_HOURS ?? 6) || 0);

export class SteamError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

async function steamGet(path, params) {
  const url = new URL(`https://api.steampowered.com/${path}`);
  url.searchParams.set('key', STEAM_API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new SteamError('steam_failed', `Steam: ${err.message}`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    // A wrong key: 401 or 403
    if (res.status === 401 || res.status === 403) throw new SteamError('steam_key_invalid', `Steam answered ${res.status}`);
    throw new SteamError(res.status === 429 ? 'steam_busy' : 'steam_failed', `Steam answered ${res.status}`);
  }
  return res.json();
}

// STEAM_ID as given, or the profile's address: '7656119…', 'felix', 'https://steamcommunity.com/id/felix/'
export function steamIdInput(value) {
  const s = String(value || '').trim().replace(/^https?:\/\/steamcommunity\.com\/(id|profiles)\//i, '').replace(/\/+$/, '');
  return /^\d{17}$/.test(s) ? { id: s } : { name: s };
}

let resolvedId = null;
async function steamId() {
  if (resolvedId) return resolvedId;
  const { id, name } = steamIdInput(STEAM_ID);
  if (id) return (resolvedId = id);
  const data = await steamGet('ISteamUser/ResolveVanityURL/v1/', { vanityurl: name });
  if (data.response?.success !== 1 || !/^\d{17}$/.test(String(data.response.steamid))) throw new SteamError('steam_id_unknown');
  return (resolvedId = String(data.response.steamid));
}

// Every game you own on Steam, free ones you played included
export async function ownedGames(timeZoneDay = localDay) {
  const data = await steamGet('IPlayerService/GetOwnedGames/v1/', { steamid: await steamId(), include_appinfo: 1, include_played_free_games: 1 });
  const games = data.response?.games;
  // Private game details answer with an empty response (an empty library has game_count 0)
  if (!Array.isArray(games)) {
    if (data.response?.game_count === 0) return [];
    throw new SteamError('steam_private');
  }
  return games.map((g) => ownedGame(g, timeZoneDay)).filter((g) => g.appid > 0);
}

// 'YYYY-MM-DD' in the server's time zone (TZ)
export function localDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// One entry of GetOwnedGames → { appid, name, minutes, deck_minutes, last_played: 'YYYY-MM-DD' or null }
export function ownedGame(g, day = localDay) {
  const appid = Number(g.appid);
  return {
    appid: Number.isInteger(appid) ? appid : 0,
    name: String(g.name || '').trim() || `Steam ${appid}`,
    minutes: Math.max(0, Math.round(Number(g.playtime_forever) || 0)),
    deck_minutes: Math.max(0, Math.round(Number(g.playtime_deck_forever) || 0)),
    last_played: g.rtime_last_played > 0 ? day(new Date(g.rtime_last_played * 1000)) : null,
  };
}

// --- the sync rules ---

// Games you haven't started: Steam may move these to "playing"
export const NOT_STARTED = ['wishlist', 'backlog'];
// "Played recently": in the last two weeks
export const RECENT_DAYS = 14;

const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// What a Steam game changes on its Checkpoint game (only what differs). s: from ownedGame (or the
// steam_games table). Your rating, dates and notes are never touched; the status only like this:
// - a game on your wishlist that you now own on Steam goes to the backlog;
// - a game you haven't started and played on Steam in the last two weeks goes to "playing",
//   only when Steam saw you play it since the last sync, so setting it back yourself stays.
// "Played on" gets PC or Steam Deck when Steam first counts time there, so unticking it stays too.
export function steamChanges(game, s, today) {
  const out = {};
  const linking = game.steam_appid !== s.appid;
  if (linking) out.steam_appid = s.appid;
  if ((game.steam_minutes ?? null) !== s.minutes) out.steam_minutes = s.minutes;
  if ((game.steam_deck_minutes ?? null) !== s.deck_minutes) out.steam_deck_minutes = s.deck_minutes;
  if ((game.steam_last_played ?? null) !== (s.last_played ?? null)) out.steam_last_played = s.last_played ?? null;

  const oldDeck = linking ? 0 : game.steam_deck_minutes || 0;
  const oldPc = linking ? 0 : (game.steam_minutes || 0) - oldDeck;
  const add = [];
  if (s.minutes - s.deck_minutes > 0 && oldPc <= 0) add.push('PC');
  if (s.deck_minutes > 0 && oldDeck <= 0) add.push('Steam Deck');
  const playedOn = game.played_on || [];
  const missing = add.filter((p) => !playedOn.some((x) => same(x, p)));
  if (missing.length) out.played_on = [...playedOn, ...missing];

  let status = game.status;
  if (linking && status === 'wishlist') status = out.status = 'backlog';
  const newlyPlayed = s.last_played && s.last_played > ((linking ? null : game.steam_last_played) || '')
    && daysBetween(s.last_played, today) <= RECENT_DAYS;
  if (newlyPlayed && NOT_STARTED.includes(status)) {
    out.status = 'playing';
    if (!game.started_on) out.started_on = s.last_played;
  }
  return out;
}

// "The Witcher® 3: Wild Hunt" → "the witcher 3 wild hunt"
export const nameKey = (s) => String(s || '').replace(/[™®©]/g, '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();

// Which Checkpoint game each Steam game is: the one linked to it before, else the one with the
// same IGDB game, else (when IGDB has no game for it) one with the same name. Each game is used once.
// steamGames: [{ appid, …, igdb_id }], games: every Checkpoint game.
// → { update: [{ id, fields }], unlinked: [appid], unchanged: n }
export function planSteam(steamGames, games, today) {
  const byAppid = new Map(games.filter((g) => g.steam_appid).map((g) => [g.steam_appid, g]));
  const free = games.filter((g) => !g.steam_appid);
  const byIgdb = new Map(free.filter((g) => g.igdb_id).map((g) => [g.igdb_id, g]));
  const byName = new Map();
  for (const g of free) if (!byName.has(nameKey(g.name))) byName.set(nameKey(g.name), g);

  const used = new Set();
  const plan = { update: [], unlinked: [], unchanged: 0 };
  for (const s of steamGames) {
    // By name only without an IGDB game: with one, a game of the same name is another game (Doom, DOOM)
    const game = [byAppid.get(s.appid), s.igdb_id && byIgdb.get(s.igdb_id), !s.igdb_id && byName.get(nameKey(s.name))]
      .find((g) => g && !used.has(g.id));
    if (!game) {
      plan.unlinked.push(s.appid);
      continue;
    }
    used.add(game.id);
    const fields = steamChanges(game, s, today);
    if (Object.keys(fields).length) plan.update.push({ id: game.id, fields });
    else plan.unchanged++;
  }
  return plan;
}
