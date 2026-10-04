import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') })

const SESSION_SECRET = process.env.SESSION_SECRET
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be set and at least 32 characters long')
}

import express from 'express'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'

import './db.js' // opens the database and runs migrations before any route loads

if (process.env.RESET_PASSWORD) {
  console.warn('RESET_PASSWORD is no longer supported. Run "node api/reset-password.js" once instead (see README).')
}

import authRoutes from './routes/auth.js'
import markerRoutes from './routes/markers.js'
import categoryRoutes from './routes/categories.js'
import collectionRoutes from './routes/collections.js'
import personRoutes from './routes/persons.js'
import shareLinksRoutes from './routes/shareLinks.js'
import publicShareRoutes from './routes/publicShare.js'
import backupRoutes from './routes/backup.js'

const app = express()
const PORT = process.env.PORT || 3000

// Number of reverse proxies in front of the app (default 1, e.g. nginx). Only correct when the
// app port is not reachable directly — docker-compose binds it to 127.0.0.1 for that reason.
const trustProxy = process.env.TRUST_PROXY ?? '1'
app.set('trust proxy', /^d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === 'true' ? true : trustProxy === 'false' ? false : trustProxy)

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://nominatim.openstreetmap.org", "https://router.project-osrm.org", "https://api.openrouteservice.org", "https://overpass-api.de", "https://overpass.private.coffee", "https://*.wikipedia.org", "https://commons.wikimedia.org"],
      fontSrc:    ["'self'", "https:", "data:"],
      objectSrc:  ["'none'"],
      frameAncestors: ["'self'"],
    },
  },
  // OSM tile and Nominatim usage policies require a referrer; helmet's default sends none.
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}))
// Backups can be large; everything else, including unauthenticated routes, gets a small limit.
const largeJson = express.json({ limit: '100mb' })
const smallJson = express.json({ limit: '2mb' })
app.use((req, res, next) => (req.path === '/api/backup/restore' ? largeJson : smallJson)(req, res, next))
app.use(cookieParser())

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, handler: (_req, res) => res.status(429).json({ error: 'Too many sign-in attempts. Please wait 15 minutes.' }) })
app.use('/api/auth', (req, res, next) => req.method === 'POST' && req.path !== '/logout' ? authLimiter(req, res, next) : next())

const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, handler: (_req, res) => res.status(429).json({ error: 'Write limit reached. Please wait before retrying.' }) })
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const applyWriteLimiter = (req, res, next) =>
  WRITE_METHODS.has(req.method) ? writeLimiter(req, res, next) : next()

app.use('/api/auth', authRoutes)
app.use('/api/markers', applyWriteLimiter, markerRoutes)
app.use('/api/categories', applyWriteLimiter, categoryRoutes)
app.use('/api/collections', applyWriteLimiter, collectionRoutes)
app.use('/api/persons', applyWriteLimiter, personRoutes)
app.use('/api/share-links', applyWriteLimiter, shareLinksRoutes)
app.use('/api/public/share', publicShareRoutes)
app.use('/api/backup', applyWriteLimiter, backupRoutes)

app.get('/api/health', (_req, res) => res.json({ ok: true }))

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'dist')
app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }))
// Hashed build assets never change; a missing one (old tab after a redeploy) must 404, not get index.html.
app.use('/assets', express.static(join(DIST, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }))
app.use(express.static(DIST, { index: false }))
app.get('*', (_req, res) => res.set('Cache-Control', 'no-cache').sendFile(join(DIST, 'index.html')))

app.use((err, _req, res, _next) => {
  if (process.env.NODE_ENV === 'production') console.error(err.message)
  else console.error(err)
  const status = err.status >= 400 && err.status < 500 ? err.status : 500
  res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message })
})

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason)
})

export const server = app.listen(PORT, () => {
  console.log(`Mapper API running on http://localhost:${server.address().port}`)
})
