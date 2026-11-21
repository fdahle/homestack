// Imports a Watcharr database (or export file) into Watchlist:
//
//   npm run import:watcharr -- <watcharr.db or watcharr-export.json> [--user <name>]
//
// The database is opened read-only. Stop Watcharr first: what it wrote last may still sit
// in its write-ahead log next to the file. With several Watcharr accounts in it, --user picks one.
// Needs TMDB_TOKEN or TMDB_API_KEY (from .env), and DATA_DIR pointing at Watchlist's data.

import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { entriesFromRows } from './watcharr.js';

const args = process.argv.slice(2);
const userFlag = args.indexOf('--user');
const userName = userFlag >= 0 ? args[userFlag + 1] : null;
const path = args.find((a, i) => !a.startsWith('--') && (userFlag < 0 || i !== userFlag + 1));

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!path) fail('Usage: npm run import:watcharr -- <watcharr.db or watcharr-export.json> [--user <name>]');
if (!process.env.TMDB_TOKEN && !process.env.TMDB_API_KEY) fail('TMDB_TOKEN or TMDB_API_KEY is needed: every title is looked up on TMDB.');

function readDatabase(file) {
  const wdb = new DatabaseSync(file, { readOnly: true });
  const tables = new Set(wdb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
  if (!tables.has('watcheds') || !tables.has('contents')) fail(`${file} doesn't look like a Watcharr database (no watcheds/contents tables).`);
  const columns = (table) => new Set(wdb.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));

  // Whose list: the one user there is, or the one named with --user
  const accounts = wdb.prepare('SELECT id, username FROM users ORDER BY id').all();
  let user = accounts[0];
  if (userName) {
    user = accounts.find((u) => u.username.toLowerCase() === userName.toLowerCase());
    if (!user) fail(`No Watcharr user "${userName}". There are: ${accounts.map((u) => u.username).join(', ')}`);
  } else if (accounts.length > 1) {
    fail(`This Watcharr has several users (${accounts.map((u) => u.username).join(', ')}). Pick one with --user <name>.`);
  }
  if (!user) fail('This Watcharr database has no users.');

  const watchedCols = columns('watcheds');
  const watched = wdb.prepare(`SELECT w.id, w.status, w.rating, w.thoughts, w.created_at, w.updated_at, w.content_id,
      ${watchedCols.has('game_id') ? 'w.game_id' : 'NULL AS game_id'}, c.tmdb_id, c.title, c.type, c.release_date
    FROM watcheds w LEFT JOIN contents c ON c.id = w.content_id
    WHERE w.user_id = ? AND w.deleted_at IS NULL ORDER BY w.id`).all(user.id);
  const ids = new Set(watched.map((w) => w.id));
  const mine = (rows) => rows.filter((r) => ids.has(r.watched_id));

  const actCols = tables.has('activities') ? columns('activities') : new Set();
  const activities = tables.has('activities')
    ? mine(wdb.prepare(`SELECT watched_id, type, data, created_at, ${actCols.has('custom_date') ? 'custom_date' : 'NULL AS custom_date'},
        ${actCols.has('count_as_play') ? 'count_as_play' : '0 AS count_as_play'} FROM activities WHERE deleted_at IS NULL`).all())
    : [];
  const seasons = tables.has('watched_seasons')
    ? mine(wdb.prepare('SELECT watched_id, season_number, status, created_at, updated_at FROM watched_seasons').all())
    : [];
  const episodes = tables.has('watched_episodes')
    ? mine(wdb.prepare('SELECT watched_id, season_number, episode_number, status, created_at, updated_at FROM watched_episodes').all())
    : [];
  wdb.close();
  console.log(`Watcharr user "${user.username}": ${watched.length} entries`);
  return entriesFromRows({ watched, activities, seasons, episodes });
}

// Watchlist's database (DATA_DIR) opens only now, once the arguments are fine
const { importWatcharr } = await import('./importer.js');
const entries = /\.json$/i.test(path) ? JSON.parse(readFileSync(path, 'utf8')) : readDatabase(path);

let lastLine = '';
const report = await importWatcharr(entries, {
  onProgress: ({ done, total, current }) => {
    const line = current ? `${done + 1}/${total} ${current}` : '';
    if (line && line !== lastLine && process.stdout.isTTY) process.stdout.write(`\r\x1b[K${line}`);
    lastLine = line;
  },
});
if (process.stdout.isTTY) process.stdout.write('\r\x1b[K');

const counts = (c) => `${c.added} added, ${c.updated} updated, ${c.unchanged} already there`;
console.log(`Films:  ${counts(report.films)}`);
console.log(`Series: ${counts(report.series)}`);
if (report.games) console.log(`Games:  ${report.games} skipped (Watchlist keeps films and series only)`);
for (const s of report.skipped) console.log(`Skipped: ${s.title || '(no title)'} (${s.reason})`);
for (const f of report.failed) console.log(`Failed:  ${f.title} (${f.error})`);
process.exit(report.failed.length ? 2 : 0);
