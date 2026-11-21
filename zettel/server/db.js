import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createUserStore } from './kit/users.js';
import { createNoteStore } from './notes.js';

export const DATA_DIR = process.env.DATA_DIR || './data';
export const FILE_DIR = join(DATA_DIR, 'files');

// The database with everything in it: accounts (kit), notes, attached files.
// `path` ':memory:' gives an empty one for the tests.
export function openDatabase(path = join(DATA_DIR, 'zettel.db')) {
  if (path !== ':memory:') mkdirSync(FILE_DIR, { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const users = createUserStore(db);
  const notes = createNoteStore(db);
  return { db, users, notes };
}
