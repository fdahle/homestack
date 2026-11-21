// One account (username and password from the environment) with a long-lived signed cookie,
// like the other homestack apps: ADMIN_USER / ADMIN_PASSWORD. APP_PASSWORD, the old name, still
// works. Without a password the app is open (e.g. when nginx does basic auth instead).

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { sessionSecret } from './db.js';

const USERNAME = (process.env.ADMIN_USER || 'admin').trim();
const PASSWORD = process.env.ADMIN_PASSWORD || process.env.APP_PASSWORD || '';
const COOKIE = 'backlog_session';
const MAX_AGE_MS = 400 * 24 * 3600_000; // the longest browsers allow

// Token depends on the username and password, so changing either logs out every device.
const sessionToken = () => createHmac('sha256', sessionSecret()).update(`session:${USERNAME.toLowerCase()}:${PASSWORD}`).digest('base64url');

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

// Failed logins are counted per client and in total, in fixed 15-minute windows (in memory,
// so a restart resets them). The total cap holds even against an attacker with many IPs;
// it can lock out new logins for a while, but devices that are logged in stay logged in.
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS_PER_IP = 10;
const MAX_FAILS_TOTAL = 50;
let windowStart = Date.now();
let failsTotal = 0;
const failsByIp = new Map();

function failureWindow() {
  if (Date.now() - windowStart > WINDOW_MS) {
    windowStart = Date.now();
    failsTotal = 0;
    failsByIp.clear();
  }
}

// 'ok', 'wrong' or 'blocked'. Counting happens before the first await, so parallel
// requests can't all slip past the limit together.
export async function checkLogin(username, password, ip) {
  failureWindow();
  if (failsTotal >= MAX_FAILS_TOTAL || (failsByIp.get(ip) || 0) >= MAX_FAILS_PER_IP) return 'blocked';
  // Both compared in full, so a wrong name takes as long as a wrong password (names ignore case)
  const nameOk = sameString(String(username || '').trim().toLowerCase(), USERNAME.toLowerCase());
  const passwordOk = sameString(String(password || ''), PASSWORD);
  if (nameOk && passwordOk) {
    failsByIp.delete(ip);
    return 'ok';
  }
  failsTotal++;
  failsByIp.set(ip, (failsByIp.get(ip) || 0) + 1);
  await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
  return 'wrong';
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
