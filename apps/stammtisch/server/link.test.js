import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A database of its own in a temporary folder (db.js opens DATA_DIR when it's imported)
const dataDir = mkdtempSync(join(tmpdir(), 'stammtisch-link-'));
process.env.DATA_DIR = dataDir;
const store = await import('./db.js');
const { mountLinkApi } = await import('./link.js');
const { createAuth } = await import('./kit/auth.js');
const { createApp, mountAccount } = await import('./kit/http.js');

after(() => {
  store.db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const TOKEN = 'a'.repeat(64);

const anna = store.createFriend({
  name: 'Anna Schmidt', nickname: 'Anni', city: 'Hamburg', address: 'Musterstraße 1\n20095 Hamburg',
  phone: '+49 170 1234567', email: 'anna@example.org', birthday: '1990-11-20', notes: 'secret notes', met_story: 'Uni',
});
const ben = store.createFriend({ name: 'Ben', archived: 1 });

// The app as server.js puts it together: the link API first, then the login for the rest
async function start({ token = TOKEN, proxySecret = '' } = {}) {
  const app = createApp();
  mountLinkApi(app, { token, people: store.linkPeople });
  mountAccount(app, { auth: createAuth({ users: store.users, cookie: 'stammtisch_session', proxySecret }), users: store.users });
  app.get('/api/friends', (req, res) => res.json(store.listFriends()));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, headers = {}) => fetch(base + path, { headers });
  return { call, close: () => server.close() };
}

async function withApp(options, fn) {
  const s = await start(options);
  try {
    await fn(s.call);
  } finally {
    s.close();
  }
}

test('without LINK_TOKEN the endpoint is not there', () =>
  withApp({ token: '' }, async (call) => {
    assert.equal((await call('/api/link/people')).status, 404);
    assert.equal((await call('/api/link/people', { authorization: 'Bearer ' })).status, 404);
    assert.equal((await call('/api/link/people', { authorization: `Bearer ${TOKEN}` })).status, 404);
  }));

test('a missing or wrong token gets a 401', () =>
  withApp({}, async (call) => {
    for (const authorization of [undefined, '', 'Bearer', 'Bearer ', `Basic ${TOKEN}`, `Bearer ${TOKEN.slice(1)}`, `Bearer ${TOKEN}x`, `Bearer ${'b'.repeat(64)}`, TOKEN]) {
      const res = await call('/api/link/people', authorization === undefined ? {} : { authorization });
      assert.equal(res.status, 401, `authorization: ${authorization}`);
      assert.deepEqual(await res.json(), { error: 'wrong_token' });
      assert.equal(res.headers.get('www-authenticate'), 'Bearer');
    }
  }));

test('the right token gets all friends, with only the fields Fernweh needs', () =>
  withApp({}, async (call) => {
    const res = await call('/api/link/people', { authorization: `Bearer ${TOKEN}` });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const { people, ...rest } = await res.json();
    assert.deepEqual(rest, {});
    assert.equal(people.length, 2);
    for (const p of people) assert.deepEqual(Object.keys(p).sort(), ['address', 'archived', 'city', 'id', 'name', 'nickname', 'updated_at']);
    const a = people.find((p) => p.id === anna);
    assert.deepEqual({ ...a, updated_at: undefined }, {
      id: anna, name: 'Anna Schmidt', nickname: 'Anni', city: 'Hamburg', address: 'Musterstraße 1\n20095 Hamburg', archived: false, updated_at: undefined,
    });
    assert.match(a.updated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const b = people.find((p) => p.id === ben);
    assert.deepEqual({ name: b.name, nickname: b.nickname, city: b.city, address: b.address, archived: b.archived }, {
      name: 'Ben', nickname: null, city: null, address: null, archived: true,
    });
    // Nothing else of theirs is in the answer
    const body = JSON.stringify(people);
    for (const secret of ['1234567', 'anna@example.org', '1990-11-20', 'secret notes']) assert.ok(!body.includes(secret), secret);
  }));

test('the "Bearer" is case-insensitive', () =>
  withApp({}, async (call) => {
    assert.equal((await call('/api/link/people', { authorization: `bearer ${TOKEN}` })).status, 200);
  }));

test('the link API sits before the login, and the token opens nothing else', () =>
  withApp({}, async (call) => {
    assert.equal((await call('/api/friends', { authorization: `Bearer ${TOKEN}` })).status, 401);
    assert.equal((await call('/api/me', { authorization: `Bearer ${TOKEN}` })).status, 401);
  }));

test('behind Authelia it still answers Fernweh, which has no proxy secret', () =>
  withApp({ proxySecret: 'proxy-secret' }, async (call) => {
    assert.equal((await call('/api/link/people', { authorization: `Bearer ${TOKEN}` })).status, 200);
    assert.equal((await call('/api/link/people')).status, 401);
    assert.equal((await call('/api/friends', { authorization: `Bearer ${TOKEN}` })).status, 403);
  }));
