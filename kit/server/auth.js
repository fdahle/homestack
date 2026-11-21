// Login for a homestack app, in one of two ways:
//
// - Its own accounts (the default): username and password, a long-lived signed cookie.
//   The first account comes from ADMIN_USER/ADMIN_PASSWORD on the first start.
// - Behind a login proxy such as Authelia (AUTH_PROXY_SECRET set): nginx asks the proxy,
//   then passes the user in Remote-User and the shared secret in X-Auth-Proxy-Secret.
//   Requests without the right secret get nothing, so whatever else reaches the port
//   can't claim to be someone. A user seen for the first time gets a local account.

import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const MAX_AGE_MS = 400 * 24 * 3600_000; // the longest browsers allow
const scryptAsync = promisify(scrypt);

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  return `scrypt$${salt}$${(await scryptAsync(String(password), salt, 32)).toString('base64url')}`;
}

async function verifyPassword(password, stored) {
  const [, salt, hash] = String(stored).split('$');
  const expected = Buffer.from(hash || '', 'base64url');
  if (!salt || expected.length !== 32) return false;
  return timingSafeEqual(await scryptAsync(String(password ?? ''), salt, 32), expected);
}

const sameString = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k !== name) continue;
    try {
      return decodeURIComponent(v.join('='));
    } catch {
      return null;
    }
  }
  return null;
}

export class LoginLimitError extends Error {
  constructor(until) {
    super('Too many login attempts');
    this.retryAt = new Date(until).toISOString();
  }
}

// users: from createUserStore(). cookie: the session cookie's name, e.g. 'checkpoint_session'.
export function createAuth({ users, cookie, proxySecret = process.env.AUTH_PROXY_SECRET || '' }) {
  // The token includes the session version (bumped on logout) and the password hash,
  // so logging out or changing the password ends that user's sessions on all devices.
  const sign = (user) =>
    createHmac('sha256', users.sessionSecret()).update(`session:${user.id}:${user.session_version}:${user.password_hash}`).digest('base64url');

  async function ensureAdmin() {
    if (users.countUsers()) return;
    if (proxySecret) return; // accounts appear with the first login through the proxy
    const password = process.env.ADMIN_PASSWORD;
    if (!password) {
      console.warn('No users yet. Set ADMIN_PASSWORD (and optionally ADMIN_USER) to create your account.');
      return;
    }
    const username = process.env.ADMIN_USER || 'admin';
    users.createUser({ username, displayName: username, passwordHash: await hashPassword(password) });
    console.log(`Created the account "${username}".`);
  }

  // --- guessing protection ---

  // Login attempts per client IP, per username and in total within a 15-minute window.
  // An attempt counts while it runs, so parallel requests can't slip past the limit;
  // a successful login takes its attempt back.
  const WINDOW_MS = 15 * 60_000;
  const MAX_ATTEMPTS = { ip: 20, user: 10, all: 200 };
  const attempts = new Map(); // key → { n, until }

  const attemptKeys = (username, ip) => [['ip', `ip:${ip}`], ['user', `user:${username.toLowerCase().slice(0, 100)}`], ['all', 'all']];

  function checkAttempts(keys) {
    const t = Date.now();
    if (attempts.size > 10_000) for (const [k, a] of attempts) if (a.until <= t) attempts.delete(k);
    for (const [kind, key] of keys) {
      const a = attempts.get(key);
      if (a && a.until > t && a.n >= MAX_ATTEMPTS[kind]) throw new LoginLimitError(a.until);
    }
    for (const [, key] of keys) {
      let a = attempts.get(key);
      if (!a || a.until <= t) attempts.set(key, (a = { n: 0, until: t + WINDOW_MS }));
      a.n++;
    }
  }

  function forgiveAttempt(keys) {
    for (const [, key] of keys) {
      const a = attempts.get(key);
      if (a && a.n > 0) a.n--;
    }
  }

  async function login(username, password, ip) {
    const name = String(username || '').trim();
    const keys = attemptKeys(name, ip);
    checkAttempts(keys);
    const user = users.getUserByName(name);
    if (user && (await verifyPassword(password, user.password_hash))) {
      forgiveAttempt(keys);
      return user;
    }
    await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
    return null;
  }

  const checkPassword = (user, password) => verifyPassword(password, user.password_hash);

  function setSessionCookie(req, res, user) {
    res.cookie(cookie, `${user.id}.${sign(user)}`, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: MAX_AGE_MS });
  }

  function cookieUser(req) {
    const [id, token] = (readCookie(req, cookie) || '').split('.');
    const user = id && token ? users.getUser(Number(id)) : null;
    return user && sameString(token, sign(user)) ? user : null;
  }

  async function proxyUser(req) {
    const secret = req.get('x-auth-proxy-secret');
    const name = String(req.get('remote-user') || '').trim().slice(0, 100);
    if (!secret || !sameString(secret, proxySecret) || !name) return null;
    let user = users.getUserByName(name);
    if (!user) {
      const displayName = String(req.get('remote-name') || '').trim().slice(0, 80) || name;
      users.createUser({ username: name, displayName, passwordHash: await hashPassword(randomBytes(32).toString('hex')) });
      user = users.getUserByName(name);
      console.log(`Created the account "${name}" for a login through the proxy.`);
    }
    return { ...user, via_proxy: true };
  }

  // Ends the session on every device of the user, not just this one
  function logout(req, res) {
    const user = cookieUser(req);
    if (user) users.bumpSessionVersion(user.id);
    res.clearCookie(cookie, { httpOnly: true, sameSite: 'lax', secure: req.secure });
  }

  async function requireLogin(req, res, next) {
    try {
      const user = proxySecret ? await proxyUser(req) : cookieUser(req);
      if (!user) return res.status(proxySecret ? 403 : 401).json({ error: 'not_logged_in' });
      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  }

  return { viaProxy: !!proxySecret, ensureAdmin, login, checkPassword, setSessionCookie, logout, requireLogin };
}
