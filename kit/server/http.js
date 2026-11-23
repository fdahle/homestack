// The parts every homestack server has: health check, login and account routes,
// the built frontend, and turning errors into JSON answers.

import express from 'express';
import { existsSync } from 'node:fs';
import { hashPassword, LoginLimitError } from './auth.js';
import { BadRequest } from './errors.js';

export { BadRequest };

// Async route errors go to the error handler (errorHandler below)
export const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);


export const toId = (v) => (Number.isInteger(Number(v)) ? Number(v) : NaN);

// Changes (all under /api) only from the app's own pages. SameSite cookies don't keep the other subdomains of
// the same domain out, and a plain form POST from one of them reaches routes that need no body.
// Browsers say where a request comes from (Sec-Fetch-Site, or at least Origin); requests that
// say nothing (curl, another server, tests) aren't from a browser page and pass.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export function sameOriginWrites(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const site = req.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'none' ? next() : res.status(403).json({ error: 'cross_site' });
  const origin = req.get('origin');
  if (!origin) return next();
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    host = null;
  }
  return host && host === req.get('host') ? next() : res.status(403).json({ error: 'cross_site' });
}

// An Express app with the usual settings: one proxy (nginx) in front, JSON bodies,
// and GET /healthz (no login, says nothing) for Docker's health check.
// bigBodies: paths whose JSON may be larger (a sync after long offline, a backup). They're
// skipped here and read by the route itself with bigJson(limit), placed after the login
// check, so nobody can send megabytes without being logged in. A path ending in / covers
// everything below it (Notizbuch: '/api/files/', uploads its route reads raw).
export function createApp({ jsonLimit = '1mb', bigBodies = [] } = {}) {
  const skipJson = (path) => bigBodies.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p));
  const app = express();
  // req.ip is the address nginx saw, not a client-supplied X-Forwarded-For
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.get('/healthz', (req, res) => res.type('text').send('ok'));
  app.use('/api', sameOriginWrites);
  const json = express.json({ limit: jsonLimit });
  app.use((req, res, next) => (skipJson(req.path) ? next() : json(req, res, next)));
  app.use((req, res, next) => {
    req.body ??= {}; // Express 5 leaves it undefined for body-less requests
    next();
  });
  return app;
}

// For a route in createApp's bigBodies: reads its JSON body, up to `limit`
export const bigJson = (limit) => express.json({ limit });

const LANGS = ['de', 'en'];
const publicUser = ({ password_hash, session_version, ...u }) => u;

// POST /api/login, POST /api/logout, then the login check for everything under `protect`,
// then GET/PATCH /api/me. Routes added after this call are behind the login.
// me(user): extra fields for /api/me (Stapel: is_admin).
export function mountAccount(app, { auth, users, protect = ['/api'], me = () => ({}) }) {
  app.post('/api/login', route(async (req, res) => {
    if (auth.viaProxy) return res.status(400).json({ error: 'login_via_proxy' });
    let user;
    try {
      user = await auth.login(req.body.username, req.body.password, req.ip);
    } catch (err) {
      if (err instanceof LoginLimitError) return res.status(429).json({ error: 'too_many_attempts', retryAt: err.retryAt });
      throw err;
    }
    if (!user) return res.status(401).json({ error: 'wrong_login' });
    auth.setSessionCookie(req, res, user);
    res.json({ ok: true });
  }));

  app.post('/api/logout', (req, res) => {
    auth.logout(req, res);
    res.json({ ok: true });
  });

  app.use(protect, auth.requireLogin);

  app.get('/api/me', (req, res) => res.json({ ...publicUser(req.user), ...me(req.user) }));

  app.patch('/api/me', route(async (req, res) => {
    const { lang, displayName, currentPassword, newPassword } = req.body;
    if (lang !== undefined && !LANGS.includes(lang)) return res.status(400).json({ error: 'bad_lang' });
    if (newPassword !== undefined) {
      if (req.user.via_proxy) return res.status(400).json({ error: 'login_via_proxy' });
      if (!(await auth.checkPassword(req.user, currentPassword))) return res.status(400).json({ error: 'wrong_password' });
      if (String(newPassword).length < 8) return res.status(400).json({ error: 'password_too_short' });
    }
    users.updateUser(req.user.id, {
      lang,
      displayName: displayName !== undefined ? String(displayName).trim().slice(0, 80) || req.user.username : undefined,
      passwordHash: newPassword !== undefined ? await hashPassword(String(newPassword)) : undefined,
    });
    const user = { ...users.getUser(req.user.id), via_proxy: req.user.via_proxy };
    if (newPassword !== undefined) auth.setSessionCookie(req, res, user); // keep this device logged in
    res.json({ ...publicUser(user), ...me(user) });
  }));
}

// Pictures behind the login: shared caches (Cloudflare) must not keep them.
// A changed picture gets a new file name, so the browser may keep them for good.
export function servePrivateFiles(app, path, dir) {
  app.use(path, express.static(dir, {
    cacheControl: false,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      // Served as the type its name says, never guessed from the content
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  }));
}

// Unknown /api paths answer 404 as JSON; the built single-page app (if dist/ exists)
// answers everything else.
export function serveFrontend(app, distDir) {
  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));
  if (!existsSync(distDir)) return;
  app.use(express.static(distDir, { index: false, maxAge: '1h', setHeaders: (res, path) => {
    if (/[\\/]assets[\\/]/.test(path)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    if (/sw\.js$/.test(path)) res.setHeader('Cache-Control', 'no-cache');
  } }));
  app.get('/{*path}', (req, res) => res.sendFile('index.html', { root: distDir, headers: { 'Cache-Control': 'no-cache' } }));
}

// The last handler. mapError(err, req, res) may answer app-specific errors and return true.
export function errorHandler(mapError = () => false) {
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof BadRequest) return res.status(400).json({ error: err.code });
    if (mapError(err, req, res)) return;
    // Body parser errors (bad JSON, too large) carry their own 4xx status
    const status = err.status ?? err.statusCode;
    if (status >= 400 && status < 500) return res.status(status).json({ error: err.type === 'entity.too.large' ? 'too_large' : 'bad_request' });
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  };
}
