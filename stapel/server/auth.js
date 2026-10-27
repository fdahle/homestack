// Username/password login with a long-lived signed cookie.
// The first account comes from ADMIN_USER/ADMIN_PASSWORD; it can add more in the settings.

import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import * as store from './db.js';

const COOKIE = 'stapel_session';
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
  return timingSafeEqual(await scryptAsync(String(password), salt, 32), expected);
}

// The token includes the session version (bumped on logout) and the password hash,
// so logging out or changing the password ends that user's sessions on all devices.
const sign = (user) =>
  createHmac('sha256', store.sessionSecret()).update(`session:${user.id}:${user.session_version}:${user.password_hash}`).digest('base64url');

const sameString = (a, b) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

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

export async function ensureAdmin() {
  if (store.countUsers()) return;
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.warn('No users yet. Set ADMIN_PASSWORD (and optionally ADMIN_USER) to create the first account.');
    return;
  }
  const username = process.env.ADMIN_USER || 'admin';
  store.createUser({ username, displayName: username, passwordHash: await hashPassword(password), isAdmin: true });
  console.log(`Created the first account "${username}".`);
}

// --- guessing protection ---

// Login attempts per client IP, per username and in total within a 15-minute window.
// An attempt counts while it runs, so parallel requests can't slip past the limit;
// a successful login takes its attempt back.
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = { ip: 20, user: 10, all: 200 };
const attempts = new Map(); // key → { n, until }

export class LoginLimitError extends Error {
  constructor(until) {
    super('Too many login attempts');
    this.retryAt = new Date(until).toISOString();
  }
}

function attemptKeys(username, ip) {
  return [['ip', `ip:${ip}`], ['user', `user:${username.toLowerCase().slice(0, 100)}`], ['all', 'all']];
}

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

export async function login(username, password, ip) {
  const name = String(username || '').trim();
  const keys = attemptKeys(name, ip);
  checkAttempts(keys);
  const user = store.getUserByName(name);
  if (user && (await verifyPassword(password, user.password_hash))) {
    forgiveAttempt(keys);
    return user;
  }
  await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
  return null;
}

export const checkPassword = (user, password) => verifyPassword(password, user.password_hash);

export function setSessionCookie(req, res, user) {
  res.cookie(COOKIE, `${user.id}.${sign(user)}`, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: MAX_AGE_MS });
}

// Ends the session on every device of the user, not just this one
export function logout(req, res) {
  const user = sessionUser(req);
  if (user) store.bumpSessionVersion(user.id);
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: req.secure });
}

function sessionUser(req) {
  const [id, token] = (readCookie(req, COOKIE) || '').split('.');
  const user = id && token ? store.getUser(Number(id)) : null;
  return user && sameString(token, sign(user)) ? user : null;
}

export function requireLogin(req, res, next) {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ error: 'not_logged_in' });
  req.user = user;
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'forbidden' });
  next();
}
