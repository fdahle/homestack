// The whole Steam sync against a fresh database in a temp folder, with Steam's answers made up
// (no network; without IGDB the games are matched and brought in by name)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'checkpoint-steam-'));
Object.assign(process.env, { DATA_DIR: dataDir, STEAM_API_KEY: 'test-key', STEAM_ID: '76561197960287930', IGDB_CLIENT_ID: '', IGDB_CLIENT_SECRET: '' });

// What Steam answers: set per test
let steamAnswer = null;
const requests = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = new URL(url);
  if (u.hostname !== 'api.steampowered.com') throw new Error(`unexpected request to ${u.hostname}`);
  requests.push(u);
  return new Response(JSON.stringify(steamAnswer), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const store = await import('./db.js');
const { importSteam, syncSteam } = await import('./steamsync.js');

test.after(() => {
  globalThis.fetch = realFetch;
  store.db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const daysAgo = (n) => Math.floor(Date.now() / 1000) - n * 86_400;
const byName = (name) => store.allGames().find((g) => g.name === name);

test('sync: games you have are linked and brought up to date, the rest wait', async () => {
  store.insertGame({ name: 'Hades', status: 'backlog', played_on: [] });
  store.insertGame({ name: 'Celeste', status: 'wishlist', played_on: [] });
  store.insertGame({ name: 'Outer Wilds', status: 'finished', played_on: ['PS4'], rating: 10 });
  steamAnswer = { response: { game_count: 4, games: [
    { appid: 1145360, name: 'Hades', playtime_forever: 1800, playtime_deck_forever: 0, rtime_last_played: daysAgo(2) },
    { appid: 504230, name: 'Celeste', playtime_forever: 0, rtime_last_played: 0 },
    { appid: 753640, name: 'Outer Wilds', playtime_forever: 900, playtime_deck_forever: 900, rtime_last_played: daysAgo(1) },
    { appid: 620, name: 'Portal 2', playtime_forever: 600, rtime_last_played: daysAgo(400) },
  ] } };

  const result = await syncSteam();
  assert.equal(result.ok, true, result.message);
  assert.deepEqual({ total: result.total, updated: result.updated, waiting: result.waiting }, { total: 4, updated: 3, waiting: 1 });
  assert.equal(requests.at(-1).searchParams.get('steamid'), '76561197960287930');

  const hades = byName('Hades');
  assert.deepEqual([hades.steam_appid, hades.steam_minutes, hades.status, hades.played_on], [1145360, 1800, 'playing', ['PC']]);
  assert.ok(hades.started_on);
  // Bought: from the wishlist to the backlog, not played yet
  assert.deepEqual([byName('Celeste').status, byName('Celeste').played_on], ['backlog', []]);
  // Finished stays finished; played on the Deck only
  const wilds = byName('Outer Wilds');
  assert.deepEqual([wilds.status, wilds.rating, wilds.played_on], ['finished', 10, ['PS4', 'Steam Deck']]);
});

test('bringing in a waiting game, and a deleted one stays away', async () => {
  const { added, linked } = await importSteam([620]);
  assert.equal(added.length, 1);
  assert.equal(linked, 0);
  const portal = byName('Portal 2');
  // Played long ago: the backlog, with where it was played
  assert.deepEqual([portal.steam_appid, portal.status, portal.played_on, portal.steam_minutes], [620, 'backlog', ['PC'], 600]);
  assert.equal(store.steamWaitingCount(), 0);

  // Deleting it in Checkpoint hides it (the server does this on delete)
  store.deleteGame(portal.id);
  store.setSteamHidden(620, true);
  assert.equal(store.steamWaitingCount(), 0);
  assert.equal(store.steamWaiting().find((g) => g.appid === 620).hidden, 1);
  // A game already in Checkpoint is never added twice
  assert.deepEqual(await importSteam([1145360]), { added: [], linked: 0 });
});

test('a private profile is an error in the result, not a crash, and changes nothing', async () => {
  const before = store.allGames();
  steamAnswer = { response: {} };
  const result = await syncSteam();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'steam_private');
  assert.deepEqual(store.allGames(), before);
});
