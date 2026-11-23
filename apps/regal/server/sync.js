// The Calibre sync: reads the library (calibre.js), applies the plan to Regal's books
// and copies new covers. Runs at the start, every CALIBRE_SYNC_HOURS and from the settings.

import { copyFile, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import * as store from './db.js';
import { planSync, readLibrary } from './calibre.js';
import { STATUSES } from './books.js';

export const CALIBRE_LIBRARY = process.env.CALIBRE_LIBRARY || '';
export const CALIBRE_SYNC_HOURS = Math.max(0, Number(process.env.CALIBRE_SYNC_HOURS ?? 6) || 0);
export const CALIBRE_WEB_URL = (process.env.CALIBRE_WEB_URL || '').replace(/\/+$/, '');

// The status books new from Calibre get (a setting, 'unread' unless you change it)
export const defaultStatus = () => {
  const s = store.users.getSetting('calibre_default_status');
  return STATUSES.includes(s) ? s : 'unread';
};

export const lastSync = () => store.getJsonSetting('calibre_last_sync');

// size and time of a cover.jpg; null if there is none
async function coverStamp(path) {
  try {
    const s = await stat(path);
    return s.isFile() && s.size > 0 ? `${s.size}-${Math.round(s.mtimeMs)}` : null;
  } catch {
    return null;
  }
}

// Copies Calibre's cover unless the book has your own photo or already this very cover
async function syncCover(book, coverPath) {
  if (!coverPath || book.cover_source === 'photo') return false;
  const stamp = await coverStamp(coverPath);
  // The same cover.jpg as last time, and its copy still there
  if (!stamp || (book.cover_source === 'calibre' && book.calibre_cover === stamp && book.cover_file && existsSync(join(store.COVER_DIR, book.cover_file)))) return false;
  const file = `${book.id}-${randomBytes(6).toString('hex')}.jpg`;
  await copyFile(coverPath, join(store.COVER_DIR, file));
  store.updateBook(book.id, { cover_file: file, cover_source: 'calibre', calibre_cover: stamp, cover_url: null }, { touch: false });
  if (book.cover_file) await unlink(join(store.COVER_DIR, book.cover_file)).catch(() => {});
  return true;
}

let running = null;

// One sync at a time; a second call while one runs gets the same result.
// ignored: uuids of Calibre books you deleted in Regal, left out.
// → { at, ok, total, added, updated, linked, gone, covers, ms, error, problems }
export function syncCalibre({ library = CALIBRE_LIBRARY, ignored = new Set() } = {}) {
  running ??= run(library, ignored).finally(() => (running = null));
  return running;
}
export const syncRunning = () => running !== null;

async function run(library, ignored) {
  const started = Date.now();
  const result = { at: store.now(), ok: false, total: 0, added: 0, updated: 0, linked: 0, gone: 0, covers: 0, problems: [] };
  try {
    if (!library) throw Object.assign(new Error('CALIBRE_LIBRARY is not set'), { code: 'calibre_not_configured' });
    const calibreBooks = (await readLibrary(library, store.DATA_DIR)).filter((c) => !ignored.has(c.calibre_uuid));
    const plan = planSync(calibreBooks, store.allBooks(), { defaultStatus: defaultStatus() });
    store.transaction(() => {
      for (const fields of plan.add) store.insertBook(fields);
      for (const { id, fields } of plan.update) store.updateBook(id, fields, { touch: false });
      for (const id of plan.gone) store.updateBook(id, { in_calibre: 0 }, { touch: false });
    });
    Object.assign(result, {
      total: calibreBooks.length,
      added: plan.add.length,
      updated: plan.update.filter((u) => !u.linked).length,
      linked: plan.update.filter((u) => u.linked).length,
      gone: plan.gone.length,
    });

    // Covers after the books are written, one by one: a cover that can't be copied costs only that cover
    const byUuid = new Map(store.allBooks().filter((b) => b.calibre_uuid).map((b) => [b.calibre_uuid, b]));
    for (const c of calibreBooks) {
      const book = byUuid.get(c.calibre_uuid);
      if (!book) continue;
      try {
        if (await syncCover(book, c.cover)) result.covers++;
      } catch (err) {
        if (result.problems.length < 10) result.problems.push(`${c.title}: ${err.code || err.message}`);
      }
    }
    result.ok = true;
  } catch (err) {
    result.error = err.code || 'calibre_failed';
    result.message = err.message;
    console.warn(`Calibre sync: ${err.message}`);
  }
  result.ms = Date.now() - started;
  store.setJsonSetting('calibre_last_sync', result);
  if (result.ok) console.log(`Calibre sync: ${result.total} books, ${result.added} new, ${result.updated} updated, ${result.linked} linked, ${result.gone} gone, ${result.covers} covers (${result.ms} ms)`);
  return result;
}
