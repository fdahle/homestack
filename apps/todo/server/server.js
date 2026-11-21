import { fileURLToPath } from 'node:url';
import { DATA_DIR, openDatabase } from './db.js';
import { buildCalendar } from './ics.js';
import { createReminders, isValidPushEndpoint } from './reminders.js';
import { createAuth } from './kit/auth.js';
import { BadRequest, createApp, errorHandler, mountAccount, route, serveFrontend } from './kit/http.js';

const PORT = Number(process.env.PORT || 3073);
const TRASH_DAYS = Number(process.env.TRASH_DAYS || 7);
const distDir = fileURLToPath(new URL('../dist', import.meta.url));

const store = openDatabase();
const reminders = createReminders(store);
// A sync after a long time offline may carry many changes
const app = createApp({ jsonLimit: '5mb' });
const auth = createAuth({ users: store.users, cookie: 'todo_session' });

// The calendar feed is opened by calendar apps, which have no login: the secret address is the key
app.get('/ics/:file', (req, res) => {
  const userId = store.userByIcsToken(String(req.params.file).replace(/\.ics$/, ''));
  if (!userId) return res.status(404).type('text').send('Not found');
  const origin = `${req.protocol}://${req.get('host')}`;
  res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, no-cache' });
  res.send(buildCalendar({ tasks: store.tasks.openTasks(userId), lists: store.tasks.listNames(userId), origin }));
});

// Login, logout, /api/me; everything under /api after this needs a login
mountAccount(app, { auth, users: store.users, protect: ['/api'] });

// --- keeping devices in step (see tasks.js) ---

app.post('/api/sync', (req, res) => res.json(store.tasks.sync(req.user.id, req.body)));

// --- settings: reminders and the calendar feed ---

function settings(userId) {
  return {
    trashDays: TRASH_DAYS,
    pushKey: reminders.publicKey(),
    pushDevices: store.push.count(userId),
    digestHour: reminders.digestHour(userId),
    icsPath: `/ics/${store.icsToken(userId)}.ics`,
  };
}

app.get('/api/settings', (req, res) => res.json(settings(req.user.id)));

app.patch('/api/settings', (req, res) => {
  const { digestHour } = req.body;
  if (digestHour !== undefined) {
    if (digestHour !== null && (!Number.isInteger(digestHour) || digestHour < 0 || digestHour > 23)) throw new BadRequest('bad_hour');
    store.setUserSetting('digest', req.user.id, digestHour === null ? 'off' : digestHour);
  }
  res.json(settings(req.user.id));
});

// A new secret address: the old one stops working
app.post('/api/settings/ics-token', (req, res) => {
  store.resetIcsToken(req.user.id);
  res.json(settings(req.user.id));
});

app.post('/api/push/subscribe', (req, res) => {
  const { endpoint, keys } = req.body;
  if (typeof endpoint !== 'string' || typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string') throw new BadRequest('bad_push');
  if (!isValidPushEndpoint(endpoint)) throw new BadRequest('bad_push_endpoint');
  store.push.save(req.user.id, { endpoint, p256dh: keys.p256dh.slice(0, 200), auth: keys.auth.slice(0, 100) });
  res.json(settings(req.user.id));
});

app.post('/api/push/unsubscribe', (req, res) => {
  if (typeof req.body.endpoint === 'string') store.push.remove(req.body.endpoint, req.user.id);
  res.json(settings(req.user.id));
});

app.post('/api/push/test', route(async (req, res) => {
  const delivered = await reminders.send(req.user.id, { title: reminders.testText(req.user.id), body: '', url: '/settings', tag: 'test' });
  res.json({ delivered });
}));

serveFrontend(app, distDir);
app.use(errorHandler());

await auth.ensureAdmin();
reminders.setup();
app.listen(PORT, () => console.log(`To-do listening on :${PORT} (data in ${DATA_DIR})`));
reminders.start();

const emptyTrash = () => {
  try {
    store.tasks.emptyOldTrash(TRASH_DAYS);
  } catch (err) {
    console.error('Emptying the trash:', err);
  }
};
emptyTrash();
setInterval(emptyTrash, 3600_000).unref();
