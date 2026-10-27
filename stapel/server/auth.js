// Username/password login with a long-lived signed cookie.
// The first account comes from ADMIN_USER/ADMIN_PASSWORD; it can add more in the settings.

import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import * as store from './db.js';

const COOKIE = 'stapel_session';
const MAX_AGE_MS = 400 * 24 * 3600_000; // the longest browsers allow

export function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  return `scrypt$${salt}$${scryptSync(password, salt, 32).toString('base64url')}`;
}

function verifyPassword(password, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  return timingSafeEqual(scryptSync(String(password), salt, 32), Buffer.from(hash, 'base64url'));
}

// The token includes the password hash, so changing a password logs out that user's devices.
const sign = (user) => createHmac('sha256', store.sessionSecret()).update(`session:${user.id}:${user.password_hash}`).digest('base64url');

const sameString = (a, b) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function ensureAdmin() {
  if (store.countUsers()) return;
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.warn('No users yet. Set ADMIN_PASSWORD (and optionally ADMIN_USER) to create the first account.');
    return;
  }
  const username = process.env.ADMIN_USER || 'admin';
  store.createUser({ username, displayName: username, passwordHash: hashPassword(password), isAdmin: true });
  console.log(`Created the first account "${username}".`);
}

export async function login(username, password) {
  const user = store.getUserByName(String(username || '').trim());
  if (user && verifyPassword(password, user.password_hash)) return user;
  await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
  return null;
}

export const checkPassword = (user, password) => verifyPassword(password, user.password_hash);

export function setSessionCookie(req, res, user) {
  res.cookie(COOKIE, `${user.id}.${sign(user)}`, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: MAX_AGE_MS });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE);
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
