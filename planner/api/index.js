require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') })

const express      = require('express')
const helmet       = require('helmet')
const rateLimit    = require('express-rate-limit')
const cron         = require('node-cron')
const webpush      = require('web-push')
const authRoutes   = require('./routes/auth')
const pushRoutes   = require('./routes/push')
const adminRoutes  = require('./routes/admin')
const {
  couch, notesDbPath, ensurePushDb, getAllPushSubscriptions, updateSentKeys, deletePushSubscription,
  pushSubscriptionsOf, getUserDbId, userExists, provisionUser,
} = require('./lib/couchdb')
const { validDbId, validUsername, validPassword, isValidPushEndpoint } = require('./lib/validate')

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
// One hop: the bundled nginx. It resolves the real client address from the
// host proxy's X-Forwarded-For (real_ip in docker/nginx.conf) and appends it as
// the last XFF entry, so req.ip — and the rate limiters below — see the client.
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

// A non-empty title that isn't an encrypted field blob (client utils/crypto.js
// stores those as a JSON string: {"v":1,"iv":…,"ct":…}).
function isPlainTitle(title) {
  if (typeof title !== 'string' || !title.trim()) return false
  try {
    const obj = JSON.parse(title)
    return !(obj?.v === 1 && typeof obj.ct === 'string')
  } catch {
    return true
  }
}

async function runPushScheduler() {
  const subscriptions = await getAllPushSubscriptions()
  if (subscriptions.length === 0) return

  const now      = new Date()
  const windowMs = 60_000
  const start    = new Date(now.getTime() - windowMs).toISOString()
  const end      = now.toISOString()

  for (const doc of subscriptions) {
    const { _id: username, sentKeys = [] } = doc
    // Re-check endpoints: docs saved before the push-host allowlist may hold others.
    const devices = pushSubscriptionsOf(doc).filter(s => isValidPushEndpoint(s?.endpoint))
    if (devices.length === 0) continue

    // The notes DB is named notes_<dbId>, not notes_<username>. Older
    // subscription docs predate the stored dbId — look it up as a fallback.
    // Validated either way: a crafted dbId must never reach an admin request.
    const dbId = validDbId(doc.dbId) ? doc.dbId : await getUserDbId(username)
    if (!dbId) continue

    try {
      // Query this user's notes db for notes with notificationAt in the current window
      const findRes = await couch('POST', `${notesDbPath(dbId)}/_find`, {
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
      const dead        = new Set()

      for (const note of notes) {
        const key = `${note._id}:${note.notificationAt}`
        if (newSentKeys.includes(key)) continue

        // Encrypted titles are JSON blob strings — never show the ciphertext.
        const payload = JSON.stringify({
          noteId:         note._id,
          notificationAt: note.notificationAt,
          title:          isPlainTitle(note.title) ? note.title : 'Task reminder',
          body:           'You have a task due.',
        })

        // Deliver to every device; the reminder counts as sent once any got it.
        let delivered = false
        for (const device of devices) {
          if (dead.has(device.endpoint)) continue
          try {
            await webpush.sendNotification(device, payload)
            delivered = true
          } catch (pushErr) {
            if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
              // Subscription expired — remove it so we don't keep trying
              dead.add(device.endpoint)
              await deletePushSubscription(username, device.endpoint).catch(() => {})
              continue
            }
            console.warn(`[push] Failed to send to ${username}:`, pushErr.message)
          }
        }
        if (delivered) newSentKeys.push(key)
      }

      if (newSentKeys.length !== sentKeys.length) {
        await updateSentKeys(username, newSentKeys).catch(() => {})
      }
    } catch (err) {
      console.warn(`[push] Scheduler error for ${username}:`, err.message)
    }
  }
}

// ── Admin bootstrap ───────────────────────────────────────────────────────────
// Registration never grants admin. The admin account comes from the server's
// env instead: when ADMIN_USERNAME / ADMIN_PASSWORD are set and that user does
// not exist yet, create it with the admin role. Existing users are left alone
// (no password reset), so the vars can be removed after the first start.

async function ensureAdminUser() {
  const { ADMIN_USERNAME: username, ADMIN_PASSWORD: password } = process.env
  if (!username && !password) return
  if (!validUsername(username) || !validPassword(password)) {
    console.error('❌ ADMIN_USERNAME must be 3–32 lowercase a-z/0-9/_/- characters and ADMIN_PASSWORD at least 12 characters — admin not created')
    return
  }
  if (await userExists(username)) return
  await provisionUser(username, password, ['admin'])
  console.log(`✅ Created admin user "${username}" from ADMIN_USERNAME / ADMIN_PASSWORD`)
}

checkCouchDb().then(async () => {
  await ensurePushDb()
  await ensureAdminUser().catch((e) => console.error('❌ Could not create admin user:', e.message))
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
