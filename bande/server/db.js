import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const DATA_DIR = process.env.DATA_DIR || './data';
export const PHOTO_DIR = join(DATA_DIR, 'photos');
mkdirSync(PHOTO_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'bande.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    lang TEXT NOT NULL DEFAULT 'de',
    session_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- birthday: 'YYYY-MM-DD', or '--MM-DD' when the year is unknown.
  -- met_on: 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD', as precise as you remember it.
  -- contact_weeks: remind me when we haven't been in touch for this long (NULL = never).
  CREATE TABLE IF NOT EXISTS friends (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    nickname TEXT,
    photo_file TEXT,
    birthday TEXT,
    met_on TEXT,
    met_story TEXT,
    city TEXT,
    phone TEXT,
    email TEXT,
    contact_weeks INTEGER,
    notes TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Groups of friends: "Uni", "Klettern", "Arbeit"
  CREATE TABLE IF NOT EXISTS circles (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  );

  CREATE TABLE IF NOT EXISTS friend_circles (
    friend_id INTEGER NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
    circle_id INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    PRIMARY KEY (friend_id, circle_id)
  );
  CREATE INDEX IF NOT EXISTS friend_circles_circle ON friend_circles (circle_id);

  -- Free-form things worth remembering: "Partnerin: Anna", "vegetarisch", "Schuhgröße 44"
  CREATE TABLE IF NOT EXISTS facts (
    id INTEGER PRIMARY KEY,
    friend_id INTEGER NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
    label TEXT NOT NULL DEFAULT '',
    value TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS facts_friend ON facts (friend_id, position);

  -- Everything that happens with friends. status: idea (no date yet), planned, done, cancelled.
  -- kind: meet, call, trip, party, or note (something from their life, not a meeting).
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'meet',
    status TEXT NOT NULL DEFAULT 'done',
    date TEXT,
    time TEXT,
    end_date TEXT,
    place TEXT,
    notes TEXT,
    source TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS events_date ON events (date);

  CREATE TABLE IF NOT EXISTS event_friends (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    friend_id INTEGER NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, friend_id)
  );
  CREATE INDEX IF NOT EXISTS event_friends_friend ON event_friends (friend_id);

  -- given_on NULL = still an idea
  CREATE TABLE IF NOT EXISTS gifts (
    id INTEGER PRIMARY KEY,
    friend_id INTEGER NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    occasion TEXT,
    given_on TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS gifts_friend ON gifts (friend_id);

  -- Imported WhatsApp chat exports. Only counts are kept, never the messages.
  CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    is_group INTEGER NOT NULL DEFAULT 0,
    messages INTEGER NOT NULL,
    first_at TEXT,
    last_at TEXT,
    imported_at TEXT NOT NULL
  );

  -- Messages per month and friend. In a one-to-one chat both sides count, in a group only theirs.
  CREATE TABLE IF NOT EXISTS chat_months (
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    friend_id INTEGER NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    n INTEGER NOT NULL,
    PRIMARY KEY (chat_id, friend_id, month)
  );
  CREATE INDEX IF NOT EXISTS chat_months_friend ON chat_months (friend_id);

  -- Who is in a chat and when they last wrote (one-to-one: the last message from either side)
  CREATE TABLE IF NOT EXISTS chat_members (
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    friend_id INTEGER NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
    last_at TEXT,
    PRIMARY KEY (chat_id, friend_id)
  );
  CREATE INDEX IF NOT EXISTS chat_members_friend ON chat_members (friend_id);

  -- Names friends have in WhatsApp, learned when you assign a chat sender to a friend
  CREATE TABLE IF NOT EXISTS aliases (
    name TEXT PRIMARY KEY COLLATE NOCASE,
    friend_id INTEGER NOT NULL REFERENCES friends(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- Reminders already sent, so each goes out once
  CREATE TABLE IF NOT EXISTS sent_reminders (
    key TEXT PRIMARY KEY,
    sent_at TEXT NOT NULL
  );
`);

export const KINDS = ['meet', 'call', 'trip', 'party', 'note'];
export const STATUSES = ['idea', 'planned', 'done', 'cancelled'];
// Kinds that count as being in touch, and as having seen each other
const CONTACT_KINDS = "('meet', 'call', 'trip', 'party')";
const SEEN_KINDS = "('meet', 'trip', 'party')";

export const now = () => new Date().toISOString();

// 'YYYY-MM-DD' in the server's time zone (TZ), not UTC
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function getSetting(key, init) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row) return row.value;
  const value = init();
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
  return value;
}

export const setSetting = (key, value) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);

export const sessionSecret = () => getSetting('session_secret', () => randomBytes(32).toString('hex'));
export const newToken = () => randomBytes(24).toString('base64url');
export const icsToken = () => getSetting('ics_token', newToken);
export const jsonSetting = (key, fallback) => JSON.parse(getSetting(key, () => JSON.stringify(fallback)));
export const setJsonSetting = (key, value) => setSetting(key, JSON.stringify(value));

// --- users ---

const USER_COLUMNS = 'id, username, display_name, lang, created_at';

export const countUsers = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
export const getUser = (id) => db.prepare(`SELECT ${USER_COLUMNS}, password_hash, session_version FROM users WHERE id = ?`).get(id);
export const getUserByName = (username) => db.prepare(`SELECT ${USER_COLUMNS}, password_hash, session_version FROM users WHERE username = ?`).get(username);
export const bumpSessionVersion = (id) => db.prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?').run(id);
// The language of the (only) account, for push messages
export const ownerLang = () => db.prepare('SELECT lang FROM users ORDER BY id LIMIT 1').get()?.lang || 'de';

export function createUser({ username, displayName, passwordHash, lang = 'de' }) {
  db.prepare('INSERT INTO users (username, display_name, password_hash, lang, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(username, displayName, passwordHash, lang, now());
}

export function updateUser(id, { displayName, lang, passwordHash }) {
  if (displayName !== undefined) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, id);
  if (lang !== undefined) db.prepare('UPDATE users SET lang = ? WHERE id = ?').run(lang, id);
  if (passwordHash !== undefined) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
}

// --- friends ---

export const FRIEND_FIELDS = ['name', 'nickname', 'birthday', 'met_on', 'met_story', 'city', 'phone', 'email', 'contact_weeks', 'notes', 'archived'];

// One row per friend with what the lists need: circles, last time seen, last contact, next plan.
// Contact includes calls and one-to-one WhatsApp chats; "seen" only meeting in person.
function friendsQuery(where) {
  return `
    SELECT f.*,
      (SELECT group_concat(c.name, '|') FROM friend_circles fc JOIN circles c ON c.id = fc.circle_id WHERE fc.friend_id = f.id) AS circle_names,
      (SELECT MAX(e.date) FROM events e JOIN event_friends ef ON ef.event_id = e.id
        WHERE ef.friend_id = f.id AND e.status = 'done' AND e.kind IN ${SEEN_KINDS} AND e.date <= :today) AS last_seen,
      (SELECT MAX(e.date) FROM events e JOIN event_friends ef ON ef.event_id = e.id
        WHERE ef.friend_id = f.id AND e.status = 'done' AND e.kind IN ${CONTACT_KINDS} AND e.date <= :today) AS last_event_contact,
      (SELECT substr(MAX(cm.last_at), 1, 10) FROM chat_members cm JOIN chats ch ON ch.id = cm.chat_id
        WHERE cm.friend_id = f.id AND ch.is_group = 0) AS last_chat,
      (SELECT MIN(e.date) FROM events e JOIN event_friends ef ON ef.event_id = e.id
        WHERE ef.friend_id = f.id AND e.status = 'planned' AND e.date >= :today) AS next_plan,
      (SELECT COUNT(*) FROM events e JOIN event_friends ef ON ef.event_id = e.id
        WHERE ef.friend_id = f.id AND e.status = 'done' AND e.kind IN ${SEEN_KINDS} AND substr(e.date, 1, 4) = substr(:today, 1, 4)) AS seen_this_year
    FROM friends f
    ${where}
  `;
}

function formatFriend(row) {
  if (!row) return row;
  const { circle_names, last_event_contact, last_chat, ...f } = row;
  f.archived = Boolean(f.archived);
  f.circles = circle_names ? circle_names.split('|').sort((a, b) => a.localeCompare(b)) : [];
  f.last_contact = [last_event_contact, last_chat].filter(Boolean).sort().at(-1) ?? null;
  return f;
}

export const listFriends = (today = localDate()) =>
  db.prepare(friendsQuery('ORDER BY f.name COLLATE NOCASE')).all({ today }).map(formatFriend);

export const getFriend = (id, today = localDate()) =>
  formatFriend(db.prepare(friendsQuery('WHERE f.id = :id')).get({ id, today }));

export const friendExists = (id) => Boolean(db.prepare('SELECT 1 FROM friends WHERE id = ?').get(id));
export const existingFriendIds = (ids) =>
  ids.length ? db.prepare(`SELECT id FROM friends WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map((r) => r.id) : [];

export function createFriend(fields) {
  const t = now();
  const { lastInsertRowid } = db.prepare('INSERT INTO friends (name, created_at, updated_at) VALUES (?, ?, ?)').run(fields.name, t, t);
  updateFriend(Number(lastInsertRowid), fields);
  return Number(lastInsertRowid);
}

export function updateFriend(id, fields) {
  const keys = FRIEND_FIELDS.filter((k) => fields[k] !== undefined);
  if (!keys.length) return;
  db.prepare(`UPDATE friends SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...keys.map((k) => fields[k]), now(), id);
}

export const setFriendPhoto = (id, file) => db.prepare('UPDATE friends SET photo_file = ?, updated_at = ? WHERE id = ?').run(file, now(), id);

export function deleteFriend(id) {
  transaction(() => {
    // Events with only this friend go with them; shared events stay for the others
    db.prepare(`DELETE FROM events WHERE id IN (
      SELECT event_id FROM event_friends WHERE friend_id = ?
      EXCEPT SELECT event_id FROM event_friends WHERE friend_id <> ?)`).run(id, id);
    db.prepare('DELETE FROM friends WHERE id = ?').run(id);
    pruneCircles();
  });
}

// --- circles ---

export const listCircles = () =>
  db.prepare(`SELECT c.id, c.name, COUNT(fc.friend_id) AS friends FROM circles c
    LEFT JOIN friend_circles fc ON fc.circle_id = c.id GROUP BY c.id ORDER BY c.name COLLATE NOCASE`).all();

export const friendIdsInCircle = (circleId) =>
  db.prepare('SELECT friend_id FROM friend_circles WHERE circle_id = ?').all(circleId).map((r) => r.friend_id);

const pruneCircles = () => db.prepare('DELETE FROM circles WHERE id NOT IN (SELECT circle_id FROM friend_circles)').run();

export function setFriendCircles(friendId, names) {
  transaction(() => {
    db.prepare('DELETE FROM friend_circles WHERE friend_id = ?').run(friendId);
    for (const name of names) {
      db.prepare('INSERT INTO circles (name) VALUES (?) ON CONFLICT (name) DO NOTHING').run(name);
      const circle = db.prepare('SELECT id FROM circles WHERE name = ?').get(name);
      db.prepare('INSERT OR IGNORE INTO friend_circles (friend_id, circle_id) VALUES (?, ?)').run(friendId, circle.id);
    }
    pruneCircles();
  });
}

// --- facts ---

export const factsOf = (friendId) => db.prepare('SELECT * FROM facts WHERE friend_id = ? ORDER BY position, id').all(friendId);
export const getFact = (id) => db.prepare('SELECT * FROM facts WHERE id = ?').get(id);

export function addFact(friendId, { label, value }) {
  const position = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM facts WHERE friend_id = ?').get(friendId).p;
  db.prepare('INSERT INTO facts (friend_id, label, value, position) VALUES (?, ?, ?, ?)').run(friendId, label, value, position);
}

export const updateFact = (id, { label, value }) => db.prepare('UPDATE facts SET label = ?, value = ? WHERE id = ?').run(label, value, id);
export const deleteFact = (id) => db.prepare('DELETE FROM facts WHERE id = ?').run(id);
// Labels used before, offered when adding a fact
export const factLabels = () =>
  db.prepare("SELECT label FROM facts WHERE label <> '' GROUP BY label COLLATE NOCASE ORDER BY COUNT(*) DESC LIMIT 50").all().map((r) => r.label);

// --- gifts ---

export const giftsOf = (friendId) =>
  db.prepare('SELECT * FROM gifts WHERE friend_id = ? ORDER BY given_on IS NOT NULL, given_on DESC, id DESC').all(friendId);
export const getGift = (id) => db.prepare('SELECT * FROM gifts WHERE id = ?').get(id);

export const addGift = (friendId, { title, occasion, given_on }) =>
  db.prepare('INSERT INTO gifts (friend_id, title, occasion, given_on, created_at) VALUES (?, ?, ?, ?, ?)').run(friendId, title, occasion, given_on, now());

export const updateGift = (id, { title, occasion, given_on }) =>
  db.prepare('UPDATE gifts SET title = ?, occasion = ?, given_on = ? WHERE id = ?').run(title, occasion, given_on, id);

export const deleteGift = (id) => db.prepare('DELETE FROM gifts WHERE id = ?').run(id);
export const giftIdeaCount = (friendId) => db.prepare('SELECT COUNT(*) AS n FROM gifts WHERE friend_id = ? AND given_on IS NULL').get(friendId).n;

// --- events ---

export const EVENT_FIELDS = ['title', 'kind', 'status', 'date', 'time', 'end_date', 'place', 'notes', 'source'];

// Adds friends: [{ id, name, nickname, photo_file }] to each event
function withFriends(events) {
  if (!events.length) return events;
  const rows = db.prepare(`SELECT ef.event_id, f.id, f.name, f.nickname, f.photo_file FROM event_friends ef
    JOIN friends f ON f.id = ef.friend_id WHERE ef.event_id IN (${events.map(() => '?').join(',')}) ORDER BY f.name COLLATE NOCASE`)
    .all(...events.map((e) => e.id));
  const byEvent = new Map(events.map((e) => [e.id, (e.friends = [])]));
  for (const { event_id, ...friend } of rows) byEvent.get(event_id).push(friend);
  return events;
}

export const getEvent = (id) => withFriends(db.prepare('SELECT * FROM events WHERE id = ?').all(id))[0];

export function createEvent(fields, friendIds) {
  return transaction(() => {
    const t = now();
    const { lastInsertRowid } = db.prepare('INSERT INTO events (title, created_at, updated_at) VALUES (?, ?, ?)').run(fields.title, t, t);
    const id = Number(lastInsertRowid);
    updateEvent(id, fields, friendIds);
    return id;
  });
}

export function updateEvent(id, fields, friendIds) {
  const keys = EVENT_FIELDS.filter((k) => fields[k] !== undefined);
  if (keys.length) {
    db.prepare(`UPDATE events SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...keys.map((k) => fields[k]), now(), id);
  }
  if (friendIds) {
    db.prepare('DELETE FROM event_friends WHERE event_id = ?').run(id);
    for (const friendId of friendIds) db.prepare('INSERT OR IGNORE INTO event_friends (event_id, friend_id) VALUES (?, ?)').run(id, friendId);
  }
}

export const deleteEvent = (id) => db.prepare('DELETE FROM events WHERE id = ?').run(id);

// The timeline: what happened (done, cancelled, and plans whose day has passed), newest first.
// Filters: friend, circle, kind, q (text in title, place or notes).
export function timeline({ friend, circle, kind, q, offset = 0, limit = 100, today = localDate() }) {
  const where = ["(e.status IN ('done', 'cancelled') OR (e.status = 'planned' AND e.date < :today))"];
  const params = { today, limit, offset };
  if (friend) {
    where.push('e.id IN (SELECT event_id FROM event_friends WHERE friend_id = :friend)');
    params.friend = friend;
  }
  if (circle) {
    where.push('e.id IN (SELECT ef.event_id FROM event_friends ef JOIN friend_circles fc ON fc.friend_id = ef.friend_id WHERE fc.circle_id = :circle)');
    params.circle = circle;
  }
  if (kind) {
    where.push('e.kind = :kind');
    params.kind = kind;
  }
  if (q) {
    where.push("(e.title LIKE :q ESCAPE '\\' OR e.place LIKE :q ESCAPE '\\' OR e.notes LIKE :q ESCAPE '\\')");
    params.q = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  }
  return withFriends(db.prepare(`SELECT e.* FROM events e WHERE ${where.join(' AND ')}
    ORDER BY e.date DESC, e.time DESC, e.id DESC LIMIT :limit OFFSET :offset`).all(params));
}

// Plans from today on, soonest first
export const upcoming = (today = localDate(), limit = 50) =>
  withFriends(db.prepare("SELECT * FROM events WHERE status = 'planned' AND date >= ? ORDER BY date, time IS NOT NULL, time, id LIMIT ?").all(today, limit));

// Plans whose day has passed: did they happen?
export const pastPlans = (today = localDate()) =>
  withFriends(db.prepare("SELECT * FROM events WHERE status = 'planned' AND date < ? ORDER BY date DESC LIMIT 20").all(today));

export const ideas = () => withFriends(db.prepare("SELECT * FROM events WHERE status = 'idea' ORDER BY created_at DESC").all());

export const recentEvents = (today = localDate(), limit = 5) =>
  withFriends(db.prepare("SELECT * FROM events WHERE status = 'done' AND date <= ? ORDER BY date DESC, id DESC LIMIT ?").all(today, limit));

// Earlier years on this day
export const onThisDay = (today = localDate()) =>
  withFriends(db.prepare("SELECT * FROM events WHERE status = 'done' AND substr(date, 6, 5) = substr(?, 6, 5) AND date < ? ORDER BY date DESC").all(today, today.slice(0, 4)));

// Everything with one friend: plans, ideas and the past
export const eventsOfFriend = (friendId) =>
  withFriends(db.prepare(`SELECT e.* FROM events e JOIN event_friends ef ON ef.event_id = e.id
    WHERE ef.friend_id = ? ORDER BY e.date IS NULL, e.date DESC, e.time DESC, e.id DESC`).all(friendId));

// Plans on a day, for the reminder the day before
export const plansOn = (date) => withFriends(db.prepare("SELECT * FROM events WHERE status = 'planned' AND date = ? ORDER BY time, id").all(date));

// --- WhatsApp chats ---

export const listChats = () =>
  db.prepare(`SELECT ch.*, (SELECT group_concat(f.name, ', ') FROM chat_members cm JOIN friends f ON f.id = cm.friend_id WHERE cm.chat_id = ch.id) AS friend_names
    FROM chats ch ORDER BY ch.last_at DESC`).all();

export const deleteChat = (id) => db.prepare('DELETE FROM chats WHERE id = ?').run(id);

// Replaces what an earlier import of the same chat stored (an export always holds the whole chat).
// months: Map friendId → Map 'YYYY-MM' → n; members: Map friendId → last_at
export function saveChat({ name, isGroup, messages, firstAt, lastAt, months, members }) {
  transaction(() => {
    db.prepare('DELETE FROM chats WHERE name = ?').run(name);
    const { lastInsertRowid } = db.prepare('INSERT INTO chats (name, is_group, messages, first_at, last_at, imported_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name, isGroup ? 1 : 0, messages, firstAt, lastAt, now());
    const chatId = Number(lastInsertRowid);
    for (const [friendId, byMonth] of months) {
      for (const [month, n] of byMonth) db.prepare('INSERT INTO chat_months (chat_id, friend_id, month, n) VALUES (?, ?, ?, ?)').run(chatId, friendId, month, n);
    }
    for (const [friendId, last] of members) db.prepare('INSERT INTO chat_members (chat_id, friend_id, last_at) VALUES (?, ?, ?)').run(chatId, friendId, last);
  });
}

// Messages per month with one friend, over all chats
export const chatMonthsOf = (friendId) =>
  db.prepare('SELECT month, SUM(n) AS n FROM chat_months WHERE friend_id = ? GROUP BY month ORDER BY month').all(friendId);

export const chatsOf = (friendId) =>
  db.prepare('SELECT ch.id, ch.name, ch.is_group, cm.last_at FROM chat_members cm JOIN chats ch ON ch.id = cm.chat_id WHERE cm.friend_id = ? ORDER BY cm.last_at DESC').all(friendId);

export const listAliases = () => db.prepare('SELECT name, friend_id FROM aliases').all();
export const setAlias = (name, friendId) =>
  db.prepare('INSERT INTO aliases (name, friend_id) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET friend_id = excluded.friend_id').run(name, friendId);
export const deleteAlias = (name) => db.prepare('DELETE FROM aliases WHERE name = ?').run(name);
export const aliasesOf = (friendId) => db.prepare('SELECT name FROM aliases WHERE friend_id = ? ORDER BY name').all(friendId).map((r) => r.name);

// --- push & reminders ---

export const listPushSubscriptions = () => db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all();
export const countPushSubscriptions = () => db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n;

export const savePushSubscription = ({ endpoint, p256dh, auth }) =>
  db.prepare(`INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`).run(endpoint, p256dh, auth, now());

export const deletePushSubscription = (endpoint) => db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);

export const wasSent = (key) => Boolean(db.prepare('SELECT 1 FROM sent_reminders WHERE key = ?').get(key));
export const markSent = (key) => db.prepare('INSERT OR IGNORE INTO sent_reminders (key, sent_at) VALUES (?, ?)').run(key, now());
export const pruneSent = (beforeIso) => db.prepare('DELETE FROM sent_reminders WHERE sent_at < ?').run(beforeIso);

// --- export ---

export function exportAll() {
  const all = (sql) => db.prepare(sql).all();
  return {
    friends: all('SELECT * FROM friends ORDER BY id'),
    circles: all('SELECT * FROM circles ORDER BY id'),
    friend_circles: all('SELECT * FROM friend_circles'),
    facts: all('SELECT * FROM facts ORDER BY id'),
    events: all('SELECT * FROM events ORDER BY id'),
    event_friends: all('SELECT * FROM event_friends'),
    gifts: all('SELECT * FROM gifts ORDER BY id'),
    chats: all('SELECT * FROM chats ORDER BY id'),
    chat_months: all('SELECT * FROM chat_months'),
    chat_members: all('SELECT * FROM chat_members'),
    aliases: all('SELECT * FROM aliases'),
  };
}
