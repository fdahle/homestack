require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') })

const express      = require('express')
const helmet       = require('helmet')
const rateLimit    = require('express-rate-limit')
const cron         = require('node-cron')
const webpush      = require('web-push')
const authRoutes   = require('./routes/auth')
const pushRoutes   = require('./routes/push')
const adminRoutes  = require('./routes/admin')
const { couch, ensurePushDb, getAllPushSubscriptions, updateSentKeys, deletePushSubscription, getUserDbId } = require('./lib/couchdb')

const PORT = process.env.PORT || 3070

// Last-resort safety net: a stray rejection (e.g. a transient CouchDB DNS blip
// on an unguarded code path) must not take the whole process down. Log it and
// keep serving — individual requests still fail, but the server stays up.
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] Unhandled promise rejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[fatal] Uncaught exception:', err)
})

const app = express()

app.use(helmet())
app.use(express.json({ limit: '10kb' }))
app.set('trust proxy', 1)

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  // Only rate-limit the sensitive write endpoints (login, register,
  // change-password, logout). GET /me and /config are polled automatically by
  // the client on every app load / route change and must not consume the budget.
  skip: (req) => req.method === 'GET',
})

const pushLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
})

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
})

app.use('/api/auth',  authLimiter, authRoutes)
app.use('/api/push',  pushLimiter, pushRoutes)
app.use('/api/admin', adminLimiter, adminRoutes)

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

async function checkCouchDb() {
  const base = process.env.COUCHDB_URL || 'http://localhost:5984'
  const user = process.env.COUCHDB_USER || 'admin'
  const pass = process.env.COUCHDB_PASSWORD || 'password'

  const maxAttempts = 10
  const retryDelay  = 2000

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res  = await couch('POST', '/_session', { name: user, password: pass })
      const body = await res.json()
      if (!res.ok || !body.ok) {
        console.error(`\n❌ CouchDB authentication failed for user "${user}". Check COUCHDB_USER and COUCHDB_PASSWORD in .env match the running CouchDB instance.\n`)
        process.exit(1)
      }
      console.log(`✅ CouchDB connection OK (${base})`)

      // Ensure system databases exist (required on a fresh CouchDB instance)
      for (const db of ['_users', '_replicator', '_global_changes']) {
        const r = await couch('PUT', `/${db}`)
        if (r.ok) console.log(`  ✅ Created system database: ${db}`)
        else if (r.status === 412) { /* already exists, fine */ }
        else console.warn(`  ⚠️  Could not create ${db}: ${r.status}`)
      }
      return
    } catch (err) {
      if (attempt < maxAttempts) {
        console.log(`⏳ Waiting for CouchDB... (attempt ${attempt}/${maxAttempts})`)
        await new Promise(resolve => setTimeout(resolve, retryDelay))
      } else {
        console.error(`\n❌ Cannot reach CouchDB at ${base}: ${err.message}\n   Is the couchdb container running? Try: docker compose up couchdb -d\n`)
        process.exit(1)
      }
    }
  }
}

// ── Web Push setup ────────────────────────────────────────────────────────────

function initWebPush() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn('⚠️  VAPID keys not set — web push notifications are disabled. Generate keys with: npx web-push generate-vapid-keys')
    return false
  }
  webpush.setVapidDetails(
    VAPID_SUBJECT || 'mailto:admin@example.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  )
  console.log('✅ Web push (VAPID) configured')
  return true
}

async function runPushScheduler() {
  const subscriptions = await getAllPushSubscriptions()
  if (subscriptions.length === 0) return

  const now      = new Date()
  const windowMs = 60_000
  const start    = new Date(now.getTime() - windowMs).toISOString()
  const end      = now.toISOString()

  for (const doc of subscriptions) {
    const { _id: username, subscription, sentKeys = [] } = doc
    if (!subscription?.endpoint) continue

    // The notes DB is named notes_<dbId>, not notes_<username>. Older
    // subscription docs predate the stored dbId — look it up as a fallback.
    const dbId = doc.dbId || await getUserDbId(username)
    if (!dbId) continue
    const notesDb = `notes_${dbId}`

    try {
      // Query this user's notes db for notes with notificationAt in the current window
      const findRes = await couch('POST', `/${notesDb}/_find`, {
        selector: {
          notificationAt: { $gte: start, $lte: end },
          deletedAt:      null,
        },
        fields: ['_id', 'notificationAt', 'title'],
        limit:  50,
      })

      if (!findRes.ok) continue
      const { docs: notes } = await findRes.json()
      if (!notes || notes.length === 0) continue

      const newSentKeys = [...sentKeys]

      for (const note of notes) {
        const key = `${note._id}:${note.notificationAt}`
        if (newSentKeys.includes(key)) continue

        // If title is a string it is plaintext; if an object it is encrypted —
        // in that case we must not leak the ciphertext to the push service.
        const titleIsPlaintext = typeof note.title === 'string'
        const payload = JSON.stringify({
          noteId:         note._id,
          notificationAt: note.notificationAt,
          title:          titleIsPlaintext ? note.title || 'Task reminder' : 'Task reminder',
          body:           'You have a task due.',
        })

        try {
          await webpush.sendNotification(subscription, payload)
          newSentKeys.push(key)
        } catch (pushErr) {
          if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
            // Subscription expired — remove it so we don't keep trying
            await deletePushSubscription(username).catch(() => {})
            break
          }
          console.warn(`[push] Failed to send to ${username}:`, pushErr.message)
        }
      }

      if (newSentKeys.length !== sentKeys.length) {
        await updateSentKeys(username, newSentKeys).catch(() => {})
      }
    } catch (err) {
      console.warn(`[push] Scheduler error for ${username}:`, err.message)
    }
  }
}

checkCouchDb().then(async () => {
  await ensurePushDb()
  const pushEnabled = initWebPush()
  if (pushEnabled) {
    // Run once immediately on startup, then every minute
    runPushScheduler().catch((e) => console.warn('[push] Initial run failed:', e.message))
    cron.schedule('* * * * *', () => {
      runPushScheduler().catch((e) => console.warn('[push] Scheduler error:', e.message))
    })
    console.log('⏰ Push notification scheduler started')
  }
  app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`))
})
