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

import db from './db.js'

if (process.env.RESET_PASSWORD) {
  db.prepare('DELETE FROM users').run()
  console.log('RESET_PASSWORD set — all users cleared. Remove the env var and set a new password via the UI.')
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

app.set('trust proxy', 1)

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://nominatim.openstreetmap.org", "https://router.project-osrm.org", "https://api.openrouteservice.org", "https://overpass-api.de", "https://overpass.kumi.systems", "https://en.wikipedia.org", "https://commons.wikimedia.org"],
      fontSrc:    ["'self'", "https:", "data:"],
      objectSrc:  ["'none'"],
      frameAncestors: ["'self'"],
    },
  },
}))
app.use(express.json({ limit: '10mb' }))
app.use(cookieParser())

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 })
app.use('/api/auth', authLimiter)

const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 })
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
app.use(express.static(DIST))
app.get('*', (_req, res) => res.sendFile(join(DIST, 'index.html')))

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (process.env.NODE_ENV === 'production') console.error(err.message)
  else console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason)
})

app.listen(PORT, () => {
  console.log(`Mapper API running on http://localhost:${PORT}`)
})
