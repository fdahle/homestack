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

import authRoutes from './routes/auth.js'
import markerRoutes from './routes/markers.js'
import categoryRoutes from './routes/categories.js'
import collectionRoutes from './routes/collections.js'

const app = express()
const PORT = process.env.PORT || 3000

app.use(helmet())
app.use(express.json())
app.use(cookieParser())

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 })
app.use('/api/auth', authLimiter)

app.use('/api/auth', authRoutes)
app.use('/api/markers', markerRoutes)
app.use('/api/categories', categoryRoutes)
app.use('/api/collections', collectionRoutes)

app.get('/api/health', (_req, res) => res.json({ ok: true }))

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason)
})

app.listen(PORT, () => {
  console.log(`Mapper API running on http://localhost:${PORT}`)
})
