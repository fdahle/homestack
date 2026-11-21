// Tasks and lists. Devices keep them all and sync through the kit (kit/sync.js): POST
// /api/sync with changes of the kinds `task` and `list`, the latest change to a field wins.

import { BadRequest } from './kit/errors.js';
import { cleanStamps, createSync, isoOrNull, text, UUID } from './kit/sync.js';

export { UUID };
export const COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'gray'];

export function createTaskStore(db) {
  db.exec(`
    -- Your own lists ("Haushalt", "Arbeit"). Tasks without a list are in the inbox.
    -- position: the order in the sidebar. purged = 1: deleted for good, only the id is left.
    CREATE TABLE IF NOT EXISTS lists (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '',
      color TEXT,
      position REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      purged INTEGER NOT NULL DEFAULT 0,
      seq INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS lists_user_seq ON lists (user_id, seq);

    -- due_date: 'YYYY-MM-DD', due_time: 'HH:MM' (both local, the server's TZ).
    -- repeat: JSON { unit: day|week|month|year, every, weekdays?: [1..7], day?, from: due|done }.
    --   Ticking off a repeating task moves it to its next date (and keeps a done copy).
    -- priority: 0 none, 1 low, 2 medium, 3 high. subtasks: JSON [{ id, title, done }].
    -- remind: 1 = a push at due_time. done_at / deleted_at: when (NULL: not).
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      list_id TEXT,
      title TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      due_date TEXT,
      due_time TEXT,
      repeat TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      subtasks TEXT NOT NULL DEFAULT '[]',
      remind INTEGER NOT NULL DEFAULT 1,
      done_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      purged INTEGER NOT NULL DEFAULT 0,
      seq INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tasks_user_seq ON tasks (user_id, seq);
    CREATE INDEX IF NOT EXISTS tasks_open ON tasks (user_id, done_at, due_date);
  `);

  const engine = createSync(db, {
    kinds: {
      task: { table: 'tasks', clean: cleanTaskPatch, json: ['repeat', 'subtasks'], bool: ['remind'], out: taskOut },
      list: { table: 'lists', clean: cleanListPatch, out: listOut },
    },
  });

  // POST /api/sync (kit/sync.js)
  const sync = (userId, body) => engine.sync(userId, body).answer;

  // Deleted for longer than `days`: gone for good (deleting keeps them a while for "undo" on other devices)
  function emptyOldTrash(days) {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    engine.transaction(() => {
      for (const row of db.prepare('SELECT id FROM tasks WHERE purged = 0 AND deleted_at IS NOT NULL AND deleted_at < ?').all(cutoff)) {
        db.prepare("UPDATE tasks SET title = '', note = '', subtasks = '[]', repeat = NULL, purged = 1, seq = ? WHERE id = ?").run(engine.nextSeq(), row.id);
      }
      for (const row of db.prepare('SELECT id FROM lists WHERE purged = 0 AND deleted_at IS NOT NULL AND deleted_at < ?').all(cutoff)) {
        db.prepare("UPDATE lists SET name = '', purged = 1, seq = ? WHERE id = ?").run(engine.nextSeq(), row.id);
      }
    });
  }

  // --- for reminders and the calendar ---

  const openTasks = (userId) =>
    db.prepare('SELECT * FROM tasks WHERE user_id = ? AND done_at IS NULL AND deleted_at IS NULL AND purged = 0 AND due_date IS NOT NULL ORDER BY due_date, due_time')
      .all(userId).map(taskOut);

  // Open tasks with a reminder whose time lies between `from` and `to` ('YYYY-MM-DDTHH:MM', local)
  const remindersBetween = (from, to) =>
    db.prepare(`SELECT * FROM tasks WHERE done_at IS NULL AND deleted_at IS NULL AND purged = 0 AND remind = 1
                AND due_time IS NOT NULL AND (due_date || 'T' || due_time) > ? AND (due_date || 'T' || due_time) <= ?`)
      .all(from, to).map((r) => ({ ...taskOut(r), user_id: r.user_id }));

  const listNames = (userId) => new Map(db.prepare('SELECT id, name FROM lists WHERE user_id = ? AND purged = 0').all(userId).map((l) => [l.id, l.name]));

  return { sync, emptyOldTrash, openTasks, remindersBetween, listNames };
}

// --- checking what devices send ---

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function cleanRepeat(repeat) {
  if (repeat === null) return null;
  if (!repeat || typeof repeat !== 'object' || Array.isArray(repeat)) throw new BadRequest('bad_repeat');
  const unit = repeat.unit;
  const every = Number(repeat.every ?? 1);
  if (!['day', 'week', 'month', 'year'].includes(unit) || !Number.isInteger(every) || every < 1 || every > 365) throw new BadRequest('bad_repeat');
  const out = { unit, every, from: repeat.from === 'done' ? 'done' : 'due' };
  if (unit === 'week' && repeat.weekdays != null) {
    if (!Array.isArray(repeat.weekdays) || !repeat.weekdays.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) throw new BadRequest('bad_repeat');
    const days = [...new Set(repeat.weekdays)].sort();
    if (days.length) out.weekdays = days;
  }
  if ((unit === 'month' || unit === 'year') && repeat.day != null) {
    if (!Number.isInteger(repeat.day) || repeat.day < 1 || repeat.day > 31) throw new BadRequest('bad_repeat');
    out.day = repeat.day;
  }
  return out;
}

function cleanSubtasks(subtasks) {
  if (!Array.isArray(subtasks) || subtasks.length > 200) throw new BadRequest('bad_subtasks');
  return subtasks.map((s) => {
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !s.id || s.id.length > 40) throw new BadRequest('bad_subtasks');
    return { id: s.id, title: text(s.title ?? '', 'subtasks', 500), done: Boolean(s.done) };
  });
}

export function cleanTaskPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new BadRequest('bad_patch');
  const out = {};
  if ('title' in patch) out.title = text(patch.title, 'title', 500);
  if ('note' in patch) out.note = text(patch.note, 'note', 20_000);
  if ('list_id' in patch) {
    if (patch.list_id !== null && !UUID.test(String(patch.list_id))) throw new BadRequest('bad_list_id');
    out.list_id = patch.list_id;
  }
  if ('due_date' in patch) {
    if (patch.due_date !== null && (!DATE.test(String(patch.due_date)) || Number.isNaN(Date.parse(patch.due_date)))) throw new BadRequest('bad_due_date');
    out.due_date = patch.due_date;
  }
  if ('due_time' in patch) {
    if (patch.due_time !== null && !TIME.test(String(patch.due_time))) throw new BadRequest('bad_due_time');
    out.due_time = patch.due_time;
  }
  if ('repeat' in patch) out.repeat = cleanRepeat(patch.repeat);
  if ('priority' in patch) {
    if (![0, 1, 2, 3].includes(patch.priority)) throw new BadRequest('bad_priority');
    out.priority = patch.priority;
  }
  if ('subtasks' in patch) out.subtasks = cleanSubtasks(patch.subtasks);
  if ('remind' in patch) out.remind = Boolean(patch.remind);
  if ('done_at' in patch) out.done_at = isoOrNull(patch.done_at, 'done_at');
  return cleanStamps(patch, out);
}

export function cleanListPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new BadRequest('bad_patch');
  const out = {};
  if ('name' in patch) {
    out.name = text(patch.name, 'name', 60).trim();
    if (!out.name) throw new BadRequest('bad_name');
  }
  if ('color' in patch) {
    if (patch.color !== null && !COLORS.includes(patch.color)) throw new BadRequest('bad_color');
    out.color = patch.color;
  }
  if ('position' in patch) {
    if (typeof patch.position !== 'number' || !Number.isFinite(patch.position)) throw new BadRequest('bad_position');
    out.position = patch.position;
  }
  return cleanStamps(patch, out);
}

export function taskOut(row) {
  if (row.purged) return { id: row.id, seq: row.seq, purged: true };
  return {
    id: row.id,
    list_id: row.list_id,
    title: row.title,
    note: row.note,
    due_date: row.due_date,
    due_time: row.due_time,
    repeat: row.repeat ? JSON.parse(row.repeat) : null,
    priority: row.priority,
    subtasks: JSON.parse(row.subtasks),
    remind: Boolean(row.remind),
    done_at: row.done_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    seq: row.seq,
  };
}

export function listOut(row) {
  if (row.purged) return { id: row.id, seq: row.seq, purged: true };
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    position: row.position,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    seq: row.seq,
  };
}
