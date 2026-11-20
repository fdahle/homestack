import express from 'express';
import { unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as store from './db.js';
import { createAuth } from './kit/auth.js';
import { BadRequest, createApp, errorHandler, mountAccount, route, serveFrontend, servePrivateFiles, toId as id } from './kit/http.js';
import { overdueFriends, upcomingBirthdays } from './friends.js';
import { buildCalendar } from './ics.js';
import { mountLinkApi } from './link.js';
import {
  dueReminders, isValidPushEndpoint, pushPublicKey, reminderSettings, sendPush, setupPush, startReminders, text as pushText,
} from './reminders.js';
import { draftFromText } from './whatsapp.js';

const PORT = Number(process.env.PORT || 3068);
const distDir = fileURLToPath(new URL('../dist', import.meta.url));

// Fernweh's public address (https://places.example.org): a friend's page links to them on its map
function webAddress(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href.replace(/\/+$/, '');
  } catch {
    // reported below
  }
  console.warn(`FERNWEH_URL "${value}" is not an http(s) address; the map link stays off.`);
  return null;
}
const FERNWEH_URL = webAddress(process.env.FERNWEH_URL);

// Optional text: trimmed, cut to max, '' → null. undefined stays undefined (= not changed).
const text = (v, max = 500) => (v === undefined ? undefined : String(v ?? '').trim().slice(0, max) || null);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

const app = createApp({ jsonLimit: '2mb' });
// The cookie keeps the app's first name (Bande), so nobody is logged out by the rename
const auth = createAuth({ users: store.users, cookie: 'bande_session' });

// --- without the login ---

// The calendar feed is opened by calendar apps, which have no login: the secret URL is the key
app.get('/ics/:file', (req, res) => {
  const token = String(req.params.file).replace(/\.ics$/, '');
  const expected = store.icsToken();
  if (token.length !== expected.length || token !== expected) return res.status(404).end();
  const today = store.localDate();
  const twoYearsAgo = `${Number(today.slice(0, 4)) - 2}${today.slice(4)}`;
  const events = [...store.upcoming(today, 1000), ...store.timeline({ limit: 5000, today }).filter((e) => e.status === 'done' && e.date >= twoYearsAgo)];
  const calendar = buildCalendar({ events, friends: store.listFriends(today), lang: store.ownerLang(), origin: `${req.protocol}://${req.get('host')}` });
  res.type('text/calendar; charset=utf-8').set('Cache-Control', 'private, no-store').send(calendar);
});

// Fernweh asks for your friends' places with its own token (server/link.js)
mountLinkApi(app, { people: store.linkPeople });

// Login, logout, /api/me; everything under /api and /photos after this needs a login
mountAccount(app, { auth, users: store.users, protect: ['/api', '/photos'] });

// --- overview ---

app.get('/api/home', (req, res) => {
  const today = store.localDate();
  const friends = store.listFriends(today);
  res.json({
    today,
    friendCount: friends.filter((f) => !f.archived).length,
    upcoming: store.upcoming(today, 10),
    pastPlans: store.pastPlans(today),
    birthdays: upcomingBirthdays(friends, today, 30),
    overdue: overdueFriends(friends, today).slice(0, 8),
    onThisDay: store.onThisDay(today),
    recent: store.recentEvents(today, 5),
    ideas: store.ideas().slice(0, 5),
  });
});

// --- friends ---

function friendFields(body) {
  const f = {};
  for (const key of ['name', 'nickname', 'city', 'phone', 'email']) f[key] = text(body[key], 200);
  f.address = text(body.address, 500);
  for (const key of ['met_story', 'notes']) f[key] = text(body[key], 10_000);
  if (body.birthday !== undefined) {
    f.birthday = text(body.birthday, 10);
    if (f.birthday && !/^(\d{4}|-)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(f.birthday)) throw new BadRequest('bad_date');
  }
  if (body.met_on !== undefined) {
    f.met_on = text(body.met_on, 10);
    if (f.met_on && !/^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/.test(f.met_on)) throw new BadRequest('bad_date');
  }
  if (body.contact_weeks !== undefined) {
    const weeks = Number(body.contact_weeks);
    f.contact_weeks = body.contact_weeks === null || body.contact_weeks === '' || !weeks ? null : Math.max(1, Math.min(520, Math.round(weeks)));
  }
  if (body.archived !== undefined) f.archived = body.archived ? 1 : 0;
  return f;
}

const circleNames = (v) =>
  Array.isArray(v) ? [...new Map(v.map((n) => String(n).trim().slice(0, 60)).filter(Boolean).map((n) => [n.toLowerCase(), n])).values()].slice(0, 30) : undefined;

const friendOr404 = (req, res) => {
  const friend = store.getFriend(id(req.params.id));
  if (!friend) res.status(404).json({ error: 'not_found' });
  return friend;
};

app.get('/api/friends', (req, res) => res.json(store.listFriends()));

app.post('/api/friends', (req, res) => {
  const fields = friendFields(req.body);
  if (!fields.name) return res.status(400).json({ error: 'name_required' });
  const friendId = store.createFriend(fields);
  const circles = circleNames(req.body.circles);
  if (circles) store.setFriendCircles(friendId, circles);
  res.json(store.getFriend(friendId));
});

app.get('/api/friends/:id', (req, res) => {
  const friend = friendOr404(req, res);
  if (!friend) return;
  res.json({
    friend,
    facts: store.factsOf(friend.id),
    gifts: store.giftsOf(friend.id),
    events: store.eventsOfFriend(friend.id),
    // Where "on the map" links to (Fernweh), null when not set up
    fernwehUrl: FERNWEH_URL,
  });
});

app.patch('/api/friends/:id', (req, res) => {
  const friend = friendOr404(req, res);
  if (!friend) return;
  const fields = friendFields(req.body);
  if (fields.name === null) return res.status(400).json({ error: 'name_required' });
  store.updateFriend(friend.id, fields);
  const circles = circleNames(req.body.circles);
  if (circles) store.setFriendCircles(friend.id, circles);
  res.json(store.getFriend(friend.id));
});

app.delete('/api/friends/:id', route(async (req, res) => {
  const friend = friendOr404(req, res);
  if (!friend) return;
  store.deleteFriend(friend.id);
  await removePhoto(friend.photo_file);
  res.json({ ok: true });
}));

// Photos are made small and square in the browser; here only the type is checked
function imageType(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

const removePhoto = (file) => (file ? unlink(join(store.PHOTO_DIR, basename(file))).catch(() => {}) : null);

app.put('/api/friends/:id/photo', express.raw({ type: 'image/*', limit: '10mb' }), route(async (req, res) => {
  const friend = friendOr404(req, res);
  if (!friend) return;
  const type = Buffer.isBuffer(req.body) ? imageType(req.body) : null;
  if (!type) return res.status(400).json({ error: 'image_required' });
  const file = `${friend.id}-${randomBytes(6).toString('base64url')}.${type}`;
  await writeFile(join(store.PHOTO_DIR, file), req.body);
  store.setFriendPhoto(friend.id, file);
  await removePhoto(friend.photo_file);
  res.json(store.getFriend(friend.id));
}));

app.delete('/api/friends/:id/photo', route(async (req, res) => {
  const friend = friendOr404(req, res);
  if (!friend) return;
  store.setFriendPhoto(friend.id, null);
  await removePhoto(friend.photo_file);
  res.json(store.getFriend(friend.id));
}));

app.get('/api/circles', (req, res) => res.json(store.listCircles()));
app.get('/api/fact-labels', (req, res) => res.json(store.factLabels()));

// --- facts & gifts ---

function factFields(body) {
  const value = text(body.value, 2000);
  if (!value) throw new BadRequest('value_required');
  return { label: text(body.label, 100) || '', value, category: store.FACT_CATEGORIES.includes(body.category) ? body.category : 'other' };
}

app.post('/api/friends/:id/facts', (req, res) => {
  const friend = friendOr404(req, res);
  if (!friend) return;
  store.addFact(friend.id, factFields(req.body));
  res.json(store.factsOf(friend.id));
});

app.patch('/api/facts/:id', (req, res) => {
  const fact = store.getFact(id(req.params.id));
  if (!fact) return res.status(404).json({ error: 'not_found' });
  store.updateFact(fact.id, factFields({ ...fact, ...req.body }));
  res.json(store.factsOf(fact.friend_id));
});

app.delete('/api/facts/:id', (req, res) => {
  const fact = store.getFact(id(req.params.id));
  if (!fact) return res.status(404).json({ error: 'not_found' });
  store.deleteFact(fact.id);
  res.json(store.factsOf(fact.friend_id));
});

function giftFields(body) {
  const title = text(body.title, 300);
  if (!title) throw new BadRequest('title_required');
  const givenOn = text(body.given_on, 10);
  if (givenOn && !isDate(givenOn)) throw new BadRequest('bad_date');
  return { title, occasion: text(body.occasion, 100) ?? null, given_on: givenOn ?? null };
}

app.post('/api/friends/:id/gifts', (req, res) => {
  const friend = friendOr404(req, res);
  if (!friend) return;
  store.addGift(friend.id, giftFields(req.body));
  res.json(store.giftsOf(friend.id));
});

app.patch('/api/gifts/:id', (req, res) => {
  const gift = store.getGift(id(req.params.id));
  if (!gift) return res.status(404).json({ error: 'not_found' });
  store.updateGift(gift.id, giftFields({ ...gift, ...req.body }));
  res.json(store.giftsOf(gift.friend_id));
});

app.delete('/api/gifts/:id', (req, res) => {
  const gift = store.getGift(id(req.params.id));
  if (!gift) return res.status(404).json({ error: 'not_found' });
  store.deleteGift(gift.id);
  res.json(store.giftsOf(gift.friend_id));
});

// --- events ---

// Checks an event against what it replaces (existing) and returns the fields to store.
// Ideas have no date; plans and what happened need one.
function eventFields(body, existing = {}) {
  const f = {};
  if (body.title !== undefined) f.title = text(body.title, 300);
  if (body.kind !== undefined) {
    if (!store.KINDS.includes(body.kind)) throw new BadRequest('bad_request');
    f.kind = body.kind;
  }
  if (body.status !== undefined) {
    if (!store.STATUSES.includes(body.status)) throw new BadRequest('bad_request');
    f.status = body.status;
  }
  for (const key of ['date', 'end_date']) {
    if (body[key] === undefined) continue;
    f[key] = text(body[key], 10);
    if (f[key] && !isDate(f[key])) throw new BadRequest('bad_date');
  }
  if (body.time !== undefined) {
    f.time = text(body.time, 5);
    if (f.time && !isTime(f.time)) throw new BadRequest('bad_time');
  }
  f.place = text(body.place, 300);
  f.notes = text(body.notes, 20_000);
  if (body.source !== undefined) f.source = body.source === 'whatsapp' ? 'whatsapp' : null;

  const merged = { ...existing, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) };
  if (!merged.title) throw new BadRequest('title_required');
  if (merged.status !== 'idea' && !merged.date) throw new BadRequest('date_required');
  if (merged.status === 'idea') Object.assign(f, { date: null, time: null, end_date: null });
  else if (merged.end_date && merged.end_date <= merged.date) f.end_date = null;
  return f;
}

function friendIdsFrom(body) {
  if (body.friendIds === undefined) return undefined;
  const ids = [...new Set((Array.isArray(body.friendIds) ? body.friendIds : []).map(id).filter(Number.isInteger))].slice(0, 500);
  if (store.existingFriendIds(ids).length !== ids.length) throw new BadRequest('not_found');
  return ids;
}

const eventOr404 = (req, res) => {
  const event = store.getEvent(id(req.params.id));
  if (!event) res.status(404).json({ error: 'not_found' });
  return event;
};

app.get('/api/timeline', (req, res) => {
  const today = store.localDate();
  const offset = Math.max(0, id(req.query.offset) || 0);
  const filters = {
    friend: id(req.query.friend) || null,
    circle: id(req.query.circle) || null,
    kind: store.KINDS.includes(req.query.kind) ? req.query.kind : null,
    q: String(req.query.q || '').trim().slice(0, 100) || null,
  };
  const limit = 100;
  const items = store.timeline({ ...filters, offset, limit: limit + 1, today });
  // Plans are shown above the past on the first page, filtered the same way (few enough to filter here)
  const members = filters.circle ? new Set(store.friendIdsInCircle(filters.circle)) : null;
  const matches = (e) =>
    (!filters.friend || e.friends.some((f) => f.id === filters.friend))
    && (!members || e.friends.some((f) => members.has(f.id)))
    && (!filters.kind || e.kind === filters.kind)
    && (!filters.q || [e.title, e.place, e.notes].some((v) => v?.toLowerCase().includes(filters.q.toLowerCase())));
  const upcoming = offset ? [] : store.upcoming(today, 500).filter(matches);
  res.json({ today, upcoming, items: items.slice(0, limit), more: items.length > limit });
});

app.post('/api/events', (req, res) => {
  const fields = eventFields({ status: 'done', kind: 'meet', ...req.body });
  const eventId = store.createEvent(fields, friendIdsFrom(req.body) ?? []);
  res.json(store.getEvent(eventId));
});

app.get('/api/events/:id', (req, res) => {
  const event = eventOr404(req, res);
  if (event) res.json(event);
});

app.patch('/api/events/:id', (req, res) => {
  const event = eventOr404(req, res);
  if (!event) return;
  store.updateEvent(event.id, eventFields(req.body, event), friendIdsFrom(req.body));
  res.json(store.getEvent(event.id));
});

app.delete('/api/events/:id', (req, res) => {
  const event = eventOr404(req, res);
  if (!event) return;
  store.deleteEvent(event.id);
  res.json({ ok: true });
});

// --- WhatsApp ---

const meNames = () => store.jsonSetting('whatsapp_me', []);
// How you appear in copied messages: the names set in the settings and your display name
const ownNames = (user) => [...meNames(), user.display_name];

// Shared or pasted text → a draft event to check and save
app.post('/api/share/parse', (req, res) => {
  const draft = draftFromText({
    text: String(req.body.text || '').slice(0, 100_000),
    title: String(req.body.title || '').slice(0, 300),
    friends: store.listFriends(),
    meNames: ownNames(req.user),
  });
  res.json(draft);
});

// --- settings, reminders, calendar ---

function settingsJson() {
  return {
    reminders: reminderSettings(),
    reminderHour: Number(process.env.REMINDER_HOUR ?? 9),
    pushKey: pushPublicKey(),
    pushDevices: store.countPushSubscriptions(),
    icsPath: `/ics/${store.icsToken()}.ics`,
    whatsappMe: meNames(),
  };
}

app.get('/api/settings', (req, res) => res.json(settingsJson()));

app.patch('/api/settings', (req, res) => {
  if (req.body.reminders && typeof req.body.reminders === 'object') {
    const current = reminderSettings();
    for (const key of Object.keys(current)) if (typeof req.body.reminders[key] === 'boolean') current[key] = req.body.reminders[key];
    store.setJsonSetting('reminders', current);
  }
  if (Array.isArray(req.body.whatsappMe)) {
    store.setJsonSetting('whatsapp_me', req.body.whatsappMe.map((n) => String(n).trim().slice(0, 100)).filter(Boolean).slice(0, 20));
  }
  res.json(settingsJson());
});

// A new secret URL; the old one stops working
app.post('/api/settings/ics-token', (req, res) => {
  store.setSetting('ics_token', store.newToken());
  res.json(settingsJson());
});

app.post('/api/push/subscribe', (req, res) => {
  const { endpoint, keys } = req.body;
  if (typeof endpoint !== 'string' || typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string') return res.status(400).json({ error: 'bad_request' });
  if (!isValidPushEndpoint(endpoint)) return res.status(400).json({ error: 'bad_push_endpoint' });
  store.savePushSubscription({ endpoint, p256dh: keys.p256dh.slice(0, 200), auth: keys.auth.slice(0, 100) });
  res.json(settingsJson());
});

app.post('/api/push/unsubscribe', (req, res) => {
  if (typeof req.body.endpoint === 'string') store.deletePushSubscription(req.body.endpoint);
  res.json(settingsJson());
});

app.post('/api/push/test', route(async (req, res) => {
  const delivered = await sendPush({ title: pushText().test, body: '', url: '/settings' });
  res.json({ delivered });
}));

// What would go out today (for checking the reminders without waiting)
app.get('/api/reminders/due', (req, res) => res.json(dueReminders()));

app.get('/api/export.json', (req, res) => {
  res.attachment(`leute-${new Date().toISOString().slice(0, 10)}.json`)
    .json({ app: 'leute', exportedAt: store.now(), ...store.exportAll() });
});

// --- static files ---

// Photos are behind the login, so shared caches (Cloudflare) must not keep them
servePrivateFiles(app, '/photos', store.PHOTO_DIR);
serveFrontend(app, distDir);
app.use(errorHandler());

await auth.ensureAdmin();
setupPush();
app.listen(PORT, () => {
  console.log(`Leute listening on :${PORT}`);
  startReminders();
});
