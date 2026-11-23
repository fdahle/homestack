import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameKey, ownedGame, planSteam, steamChanges, steamIdInput } from './steam.js';

const TODAY = '2026-11-23';
const utcDay = (d) => d.toISOString().slice(0, 10);

test('Steam ID: the number, the profile name or the profile address', () => {
  assert.deepEqual(steamIdInput('76561197960287930'), { id: '76561197960287930' });
  assert.deepEqual(steamIdInput('https://steamcommunity.com/profiles/76561197960287930/'), { id: '76561197960287930' });
  assert.deepEqual(steamIdInput('https://steamcommunity.com/id/felix/'), { name: 'felix' });
  assert.deepEqual(steamIdInput(' felix '), { name: 'felix' });
});

test("an entry of Steam's list", () => {
  const g = ownedGame({ appid: 1086940, name: "Baldur's Gate 3", playtime_forever: 4523, playtime_deck_forever: 600, rtime_last_played: 1763856000 }, utcDay);
  assert.deepEqual(g, { appid: 1086940, name: "Baldur's Gate 3", minutes: 4523, deck_minutes: 600, last_played: '2025-11-23' });
  // Never played: no time, no day
  assert.deepEqual(ownedGame({ appid: 7, name: '', playtime_forever: 0, rtime_last_played: 0 }, utcDay),
    { appid: 7, name: 'Steam 7', minutes: 0, deck_minutes: 0, last_played: null });
});

const steam = (over = {}) => ({ appid: 100, name: 'Hades', minutes: 0, deck_minutes: 0, last_played: null, igdb_id: null, ...over });
const game = (over = {}) => ({ id: 1, name: 'Hades', igdb_id: null, status: 'backlog', played_on: [], steam_appid: null, ...over });

test('linking: play time, the platforms Steam counted, a bought wishlist game goes to the backlog', () => {
  assert.deepEqual(steamChanges(game({ status: 'wishlist' }), steam({ minutes: 300, deck_minutes: 120, last_played: '2024-02-01' }), TODAY), {
    steam_appid: 100, steam_minutes: 300, steam_deck_minutes: 120, steam_last_played: '2024-02-01',
    played_on: ['PC', 'Steam Deck'], status: 'backlog',
  });
  // A platform you ticked already (in your spelling) isn't added twice
  assert.deepEqual(steamChanges(game({ played_on: ['pc'] }), steam({ minutes: 50 }), TODAY), {
    steam_appid: 100, steam_minutes: 50, steam_deck_minutes: 0,
  });
});

test('played in the last two weeks: a game you had not started moves to "playing", once', () => {
  const first = steamChanges(game(), steam({ minutes: 90, last_played: '2026-11-20' }), TODAY);
  assert.equal(first.status, 'playing');
  assert.equal(first.started_on, '2026-11-20');
  // You set it back to the backlog; the next sync with the same last day leaves it there
  const linked = game({ ...first, status: 'backlog', steam_appid: 100, started_on: '2026-11-20' });
  assert.deepEqual(steamChanges(linked, steam({ minutes: 90, last_played: '2026-11-20' }), TODAY), {});
  // Played again: playing again, the start date you have stays
  assert.deepEqual(steamChanges(linked, steam({ minutes: 150, last_played: '2026-11-23' }), TODAY),
    { steam_minutes: 150, steam_last_played: '2026-11-23', status: 'playing' });
  // Longer ago, or a game you finished or dropped: the status stays
  assert.equal(steamChanges(game(), steam({ minutes: 90, last_played: '2026-10-01' }), TODAY).status, undefined);
  for (const status of ['finished', 'completed', 'dropped', 'playing']) {
    assert.equal(steamChanges(game({ status }), steam({ minutes: 90, last_played: '2026-11-22' }), TODAY).status, undefined);
  }
});

test('a platform you unticked stays unticked; time on a new device ticks that one', () => {
  const linked = game({ steam_appid: 100, steam_minutes: 300, steam_deck_minutes: 0, steam_last_played: '2024-01-01', played_on: [] });
  assert.deepEqual(steamChanges(linked, steam({ minutes: 400, last_played: '2024-01-01' }), TODAY), { steam_minutes: 400 });
  assert.deepEqual(steamChanges(linked, steam({ minutes: 400, deck_minutes: 100, last_played: '2024-01-01' }), TODAY),
    { steam_minutes: 400, steam_deck_minutes: 100, played_on: ['Steam Deck'] });
});

test('which game is which: linked before, the same IGDB game, else the same name', () => {
  const games = [
    game({ id: 1, name: 'Celeste', igdb_id: 9, steam_appid: 504230, steam_minutes: 10, steam_deck_minutes: 0, steam_last_played: null }),
    game({ id: 2, name: 'Hades', igdb_id: 113112 }),
    game({ id: 3, name: 'The Witcher 3: Wild Hunt', igdb_id: null }),
    game({ id: 4, name: 'Doom', igdb_id: 7351 }),
    game({ id: 5, name: 'Stardew Valley', igdb_id: 17000 }),
  ];
  const plan = planSteam([
    steam({ appid: 504230, name: 'Celeste', minutes: 10, igdb_id: 9 }),
    steam({ appid: 1145360, name: 'Hades', igdb_id: 113112 }),
    steam({ appid: 292030, name: 'The Witcher® 3: Wild Hunt' }),
    // IGDB says it's another game of the same name (2016's DOOM, not 1993's): not linked
    steam({ appid: 379720, name: 'DOOM', igdb_id: 9999 }),
    // No IGDB game for it (or no IGDB at all): the name decides
    steam({ appid: 413150, name: 'Stardew Valley' }),
    steam({ appid: 1, name: 'Something else' }),
  ], games, TODAY);
  assert.equal(plan.unchanged, 1);
  assert.deepEqual(plan.update.map((u) => [u.id, u.fields.steam_appid]), [[2, 1145360], [3, 292030], [5, 413150]]);
  assert.deepEqual(plan.unlinked, [379720, 1]);
});

test('name keys', () => {
  assert.equal(nameKey('The Witcher® 3: Wild Hunt'), 'the witcher 3 wild hunt');
  assert.equal(nameKey('Pokémon™ Smaragd'), 'pokemon smaragd');
});
