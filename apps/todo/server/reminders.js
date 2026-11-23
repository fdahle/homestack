// Push reminders: a task with a time and its reminder on (the default) pings when it's due,
// and every morning at the hour you chose a summary of what's due today and overdue.
// Each reminder goes out once; nothing goes to an account without a device signed up.

import webpush from 'web-push';
import { localDate, localTime } from './db.js';

const CHECK_EVERY_MS = 60_000;
// After a restart, reminders this late still go out; older ones are skipped
const CATCH_UP_MS = 6 * 3600_000;
export const DEFAULT_DIGEST_HOUR = 8;
// How long one push service may take to answer
const SEND_TIMEOUT_MS = 15_000;

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

const TEXT = {
  de: {
    due: (time) => `Fällig um ${time}`,
    today: (n) => (n === 1 ? 'Heute: 1 Aufgabe' : `Heute: ${n} Aufgaben`),
    overdue: (n) => `${n} überfällig`,
    test: 'Erinnerungen funktionieren 👋',
  },
  en: {
    due: (time) => `Due at ${time}`,
    today: (n) => (n === 1 ? 'Today: 1 task' : `Today: ${n} tasks`),
    overdue: (n) => `${n} overdue`,
    test: 'Reminders work 👋',
  },
};

// sendPush: for the tests, instead of the real push services
export function createReminders(store, { sendPush = (...args) => webpush.sendNotification(...args) } = {}) {
  let publicKey = null;
  const text = (userId) => TEXT[store.users.getUser(userId)?.lang] || TEXT.de;

  // VAPID keys are made on the first start and kept in the database: nothing to configure
  function setup() {
    let keys = null;
    try {
      keys = JSON.parse(store.users.getSetting('vapid'));
    } catch {
      // none yet
    }
    if (!keys) {
      keys = webpush.generateVAPIDKeys();
      store.users.setSetting('vapid', JSON.stringify(keys));
    }
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:todo@localhost', keys.publicKey, keys.privateKey);
    publicKey = keys.publicKey;
  }

  // To every device of the account at once; true when at least one got it. Expired
  // subscriptions go. A push service that doesn't answer is given up on after a while,
  // so it can't hold up the others or the next round.
  async function send(userId, message) {
    const results = await Promise.allSettled(store.push.list(userId).map(async (sub) => {
      try {
        await sendPush({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(message), { TTL: 6 * 3600, timeout: SEND_TIMEOUT_MS });
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) store.push.remove(sub.endpoint);
        else console.warn(`Push failed: ${err.message}`);
        throw err;
      }
    }));
    return results.some((r) => r.status === 'fulfilled');
  }

  const digestHour = (userId) => {
    const value = store.userSetting('digest', userId);
    if (value === 'off') return null;
    return value === null ? DEFAULT_DIGEST_HOUR : Number(value);
  };

  // What's due now: [{ userId, key, message }]
  function due(now = new Date()) {
    const out = [];
    const users = new Set(store.push.usersWithDevices());
    const from = new Date(now.getTime() - CATCH_UP_MS);
    for (const task of store.tasks.remindersBetween(`${localDate(from)}T${localTime(from)}`, `${localDate(now)}T${localTime(now)}`)) {
      if (!users.has(task.user_id)) continue;
      const list = task.list_id ? store.tasks.listNames(task.user_id).get(task.list_id) : '';
      const body = [text(task.user_id).due(task.due_time), list].filter(Boolean).join(' · ');
      out.push({ userId: task.user_id, key: `task:${task.id}:${task.due_date}T${task.due_time}`, message: { title: task.title || '…', body, url: `/task/${task.id}`, tag: task.id } });
    }

    const today = localDate(now);
    for (const userId of users) {
      const hour = digestHour(userId);
      // From the hour on, for a few hours (not a 'today' summary in the evening)
      if (hour === null || now.getHours() < hour || now.getHours() >= hour + 3) continue;
      const open = store.tasks.openTasks(userId).filter((t) => t.due_date <= today);
      if (!open.length) continue;
      const overdue = open.filter((t) => t.due_date < today).length;
      const T = text(userId);
      const titles = open.sort((a, b) => b.priority - a.priority).slice(0, 4).map((t) => t.title).join(', ');
      out.push({
        userId,
        key: `digest:${userId}:${today}`,
        message: { title: overdue ? `${T.today(open.length)} · ${T.overdue(overdue)}` : T.today(open.length), body: titles + (open.length > 4 ? ' …' : ''), url: '/', tag: 'digest' },
      });
    }
    return out.filter((r) => !store.push.wasSent(r.key));
  }

  async function check() {
    const reminders = due();
    // Marked first: a slow push service must not get the same reminder twice from the next round
    for (const { key } of reminders) store.push.markSent(key);
    await Promise.allSettled(reminders.map(({ userId, message }) => send(userId, message)));
    store.push.pruneSent(new Date(Date.now() - 400 * 86_400_000).toISOString());
  }

  function start() {
    const run = () => check().catch((err) => console.error('Reminders:', err));
    setTimeout(run, 10_000);
    setInterval(run, CHECK_EVERY_MS).unref();
  }

  return { setup, start, send, due, digestHour, publicKey: () => publicKey, testText: (userId) => text(userId).test };
}
