// Runs in each app as server/kit/auth.test.js (npm test), where express is installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createAuth, hashPassword } from './auth.js';
import { createApp, mountAccount } from './http.js';
import { createUserStore } from './users.js';

async function start({ proxySecret = '' } = {}) {
  const users = createUserStore(new DatabaseSync(':memory:'));
  users.createUser({ username: 'felix', displayName: 'Felix', passwordHash: await hashPassword('correct horse') });
  const auth = createAuth({ users, cookie: 'test_session', proxySecret });
  const app = createApp();
  mountAccount(app, { auth, users });
  app.get('/api/thing', (req, res) => res.json({ user: req.user.username }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, { method = 'GET', body, cookie, headers = {} } = {}) => fetch(base + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { users, call, close: () => server.close() };
}

const cookieOf = (res) => res.headers.get('set-cookie')?.split(';')[0];

test('health check answers without a login', async () => {
  const s = await start();
  try {
    const res = await s.call('/healthz');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'ok');
  } finally {
    s.close();
  }
});

test('own accounts: login, session, logout everywhere', async () => {
  const s = await start();
  try {
    assert.equal((await s.call('/api/thing')).status, 401);
    assert.equal((await s.call('/api/login', { method: 'POST', body: { username: 'felix', password: 'wrong' } })).status, 401);
    const ok = await s.call('/api/login', { method: 'POST', body: { username: 'FELIX', password: 'correct horse' } });
    assert.equal(ok.status, 200);
    const cookie = cookieOf(ok);
    assert.deepEqual(await (await s.call('/api/thing', { cookie })).json(), { user: 'felix' });
    const me = await (await s.call('/api/me', { cookie })).json();
    assert.equal(me.password_hash, undefined);
    assert.equal((await s.call('/api/logout', { method: 'POST', cookie })).status, 200);
    assert.equal((await s.call('/api/thing', { cookie })).status, 401);
  } finally {
    s.close();
  }
});

test('changing the password ends other sessions but keeps this one', async () => {
  const s = await start();
  try {
    const login = () => s.call('/api/login', { method: 'POST', body: { username: 'felix', password: 'correct horse' } }).then(cookieOf);
    const phone = await login();
    const laptop = await login();
    const res = await s.call('/api/me', { method: 'PATCH', cookie: laptop, body: { currentPassword: 'correct horse', newPassword: 'battery staple' } });
    assert.equal(res.status, 200);
    assert.equal((await s.call('/api/thing', { cookie: phone })).status, 401);
    assert.equal((await s.call('/api/thing', { cookie: cookieOf(res) })).status, 200);
  } finally {
    s.close();
  }
});

test('behind a proxy: only with the secret, new users get an account', async () => {
  const s = await start({ proxySecret: 's3cret' });
  try {
    assert.equal((await s.call('/api/thing', { headers: { 'remote-user': 'felix' } })).status, 403);
    assert.equal((await s.call('/api/thing', { headers: { 'remote-user': 'felix', 'x-auth-proxy-secret': 'nope' } })).status, 403);
    const res = await s.call('/api/thing', { headers: { 'remote-user': 'oma', 'x-auth-proxy-secret': 's3cret' } });
    assert.deepEqual(await res.json(), { user: 'oma' });
    assert.ok(s.users.getUserByName('oma'));
    const me = await (await s.call('/api/me', { headers: { 'remote-user': 'felix', 'x-auth-proxy-secret': 's3cret' } })).json();
    assert.equal(me.via_proxy, true);
    assert.equal((await s.call('/api/login', { method: 'POST', body: { username: 'felix', password: 'correct horse' } })).status, 400);
  } finally {
    s.close();
  }
});
