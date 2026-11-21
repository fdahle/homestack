// Push notifications: birthdays (on the day and a week before, with gift ideas), plans the day
// before, and friends you haven't been in touch with for longer than you wanted.
// They go out once a day from REMINDER_HOUR on; each one only once.

import webpush from 'web-push';
import * as store from './db.js';
import { addDays, nextBirthday, overdueFriends } from './friends.js';

const REMINDER_HOUR = Number(process.env.REMINDER_HOUR ?? 9);
const CHECK_EVERY_MS = 10 * 60_000;

export const DEFAULT_REMINDERS = { birthdays: true, plans: true, contact: true };
export const reminderSettings = () => ({ ...DEFAULT_REMINDERS, ...store.jsonSetting('reminders', DEFAULT_REMINDERS) });

// VAPID keys are made on the first start and kept in the database, so there is nothing to configure
let publicKey = null;

export function setupPush() {
  let keys = store.jsonSetting('vapid', null);
  if (!keys) {
    keys = webpush.generateVAPIDKeys();
    store.setJsonSetting('vapid', keys);
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:leute@localhost', keys.publicKey, keys.privateKey);
  publicKey = keys.publicKey;
}

export const pushPublicKey = () => publicKey;

// A push endpoint is a URL the server will later POST to, so only accept the
// real browser push services (SSRF protection). Exact hosts or `.suffix` matches.
const PUSH_HOSTS = [
  'fcm.googleapis.com', // Chrome, Edge (Chromium), Opera, Samsung
  'android.googleapis.com', // legacy GCM endpoints
  '.push.services.mozilla.com', // Firefox
  '.notify.windows.com', // legacy Edge / Windows (WNS)
  'web.push.apple.com', // Safari
  '.push.apple.com',
];

export function isValidPushEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.some((h) => (h.startsWith('.') ? host.endsWith(h) : host === h));
}

// Sends to every subscribed device; true when at least one got it. Expired subscriptions are removed.
export async function sendPush(message) {
  let delivered = false;
  for (const sub of store.listPushSubscriptions()) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(message), { TTL: 24 * 3600 });
      delivered = true;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) store.deletePushSubscription(sub.endpoint);
      else console.warn(`Push failed: ${err.message}`);
    }
  }
  return delivered;
}

const TEXT = {
  de: {
    birthdayToday: (f, age) => (age ? `🎂 ${f} wird heute ${age}` : `🎂 ${f} hat heute Geburtstag`),
    birthdaySoon: (f, age) => (age ? `${f} wird in einer Woche ${age}` : `${f} hat in einer Woche Geburtstag`),
    giftIdeas: (n) => (n === 1 ? '1 Geschenkidee notiert' : n ? `${n} Geschenkideen notiert` : 'Noch keine Geschenkidee'),
    congratulate: 'Gratulieren nicht vergessen',
    tomorrow: (title) => `Morgen: ${title}`,
    at: (time) => `um ${time}`,
    with: (names) => `mit ${names}`,
    contactTitle: (names) => `Lange nichts gehört von ${names}`,
    contactBody: 'Vielleicht mal wieder melden?',
    test: 'Benachrichtigungen funktionieren 👋',
  },
  en: {
    birthdayToday: (f, age) => (age ? `🎂 ${f} turns ${age} today` : `🎂 It's ${f}'s birthday today`),
    birthdaySoon: (f, age) => (age ? `${f} turns ${age} in a week` : `${f}'s birthday is in a week`),
    giftIdeas: (n) => (n === 1 ? '1 gift idea noted' : n ? `${n} gift ideas noted` : 'No gift idea yet'),
    congratulate: "Don't forget to say happy birthday",
    tomorrow: (title) => `Tomorrow: ${title}`,
    at: (time) => `at ${time}`,
    with: (names) => `with ${names}`,
    contactTitle: (names) => `Haven't heard from ${names} in a while`,
    contactBody: 'Maybe get in touch?',
    test: 'Notifications work 👋',
  },
};
export const text = () => TEXT[store.ownerLang()] || TEXT.de;

const firstName = (f) => f.nickname || f.name.split(' ')[0];

// Everything due today that hasn't gone out yet: [{ key, message }]
export function dueReminders(today = store.localDate()) {
  const settings = reminderSettings();
  const T = text();
  const due = [];
  const friends = store.listFriends(today);

  if (settings.birthdays) {
    for (const f of friends) {
      if (f.archived) continue;
      const b = nextBirthday(f.birthday, today);
      if (!b) continue;
      if (b.days === 0) {
        due.push({ key: `birthday:${f.id}:${b.date}`, message: { title: T.birthdayToday(f.name, b.age), body: T.congratulate, url: `/friend/${f.id}` } });
      } else if (b.days === 7) {
        due.push({ key: `birthday-soon:${f.id}:${b.date}`, message: { title: T.birthdaySoon(f.name, b.age), body: T.giftIdeas(store.giftIdeaCount(f.id)), url: `/friend/${f.id}` } });
      }
    }
  }

  if (settings.plans) {
    const tomorrow = addDays(today, 1);
    for (const e of store.plansOn(tomorrow)) {
      const body = [e.time && T.at(e.time), e.friends.length && T.with(e.friends.map(firstName).join(', ')), e.place].filter(Boolean).join(' · ');
      due.push({ key: `plan:${e.id}:${tomorrow}`, message: { title: T.tomorrow(e.title), body, url: `/event/${e.id}` } });
    }
  }

  if (settings.contact) {
    // Once when someone becomes overdue, then again every 30 days, all in one message
    const fresh = overdueFriends(friends, today)
      .map((o) => ({ ...o, key: `contact:${o.friend.id}:${o.friend.last_contact ?? 'never'}:${Math.floor(o.overdue / 30)}` }))
      .filter((o) => !store.wasSent(o.key));
    if (fresh.length) {
      const names = fresh.slice(0, 3).map((o) => firstName(o.friend)).join(', ') + (fresh.length > 3 ? ` +${fresh.length - 3}` : '');
      due.push({ keys: fresh.map((o) => o.key), message: { title: T.contactTitle(names), body: T.contactBody, url: fresh.length === 1 ? `/friend/${fresh[0].friend.id}` : '/' } });
    }
  }

  return due.filter((d) => d.keys || !store.wasSent(d.key));
}

async function check() {
  if (new Date().getHours() < REMINDER_HOUR || !store.countPushSubscriptions()) return;
  for (const { key, keys, message } of dueReminders()) {
    if (await sendPush(message)) for (const k of keys || [key]) store.markSent(k);
  }
  store.pruneSent(new Date(Date.now() - 400 * 86_400_000).toISOString());
}

export function startReminders() {
  const run = () => check().catch((err) => console.error('Reminders:', err));
  setTimeout(run, 30_000);
  setInterval(run, CHECK_EVERY_MS);
}
