// Single-password login with a long-lived signed cookie.
// If APP_PASSWORD is unset, the app is open (e.g. when nginx does basic auth instead).

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { sessionSecret } from './db.js';

const PASSWORD = process.env.APP_PASSWORD || '';
const COOKIE = 'backlog_session';
const MAX_AGE_MS = 400 * 24 * 3600_000; // the longest browsers allow

// Token depends on the password, so changing APP_PASSWORD logs out every device.
const sessionToken = () => createHmac('sha256', sessionSecret()).update(`session:${PASSWORD}`).digest('base64url');

const sameString = (a, b) => {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
};

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export const authEnabled = Boolean(PASSWORD);

export function isLoggedIn(req) {
  if (!authEnabled) return true;
  const token = readCookie(req, COOKIE);
  return Boolean(token) && sameString(token, sessionToken());
}

export async function checkPassword(password) {
  if (sameString(String(password || ''), PASSWORD)) return true;
  await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
  return false;
}

export function setSessionCookie(req, res) {
  res.cookie(COOKIE, sessionToken(), { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: MAX_AGE_MS });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE);
}

const PUBLIC_PATHS = ['/login', '/manifest.webmanifest', '/sw.js', '/static/'];

export function requireLogin(req, res, next) {
  if (isLoggedIn(req) || PUBLIC_PATHS.some((p) => req.path.startsWith(p))) return next();
  if (req.path.startsWith('/api/') || req.method !== 'GET') return res.status(401).json({ error: 'Not logged in' });
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}
