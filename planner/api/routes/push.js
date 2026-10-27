const express = require('express')
const { savePushSubscription, deletePushSubscription, getUserDbId } = require('../lib/couchdb')
const { requireAuth } = require('../lib/session')
const { isValidPushEndpoint } = require('../lib/validate')

const router = express.Router()

// GET /api/push/vapid-key
// Returns the public VAPID key so the client does not need it baked in at
// build time (useful when deploying via Docker without build args).
router.get('/vapid-key', (_req, res) => {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  if (!publicKey) return res.status(503).json({ error: 'Push not configured on this server' })
  res.json({ publicKey })
})

// POST /api/push/subscribe
// Body: a PushSubscription JSON object ({ endpoint, keys: { p256dh, auth } })
router.post('/subscribe', requireAuth, async (req, res) => {
  const { endpoint, expirationTime, keys } = req.body || {}
  if (typeof endpoint !== 'string' || typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string') {
    return res.status(400).json({ error: 'Invalid push subscription object' })
  }
  if (!isValidPushEndpoint(endpoint)) {
    return res.status(400).json({ error: 'Invalid push endpoint' })
  }
  // Store only the fields web-push needs, not whatever else the body carried.
  const subscription = { endpoint, expirationTime: expirationTime ?? null, keys: { p256dh: keys.p256dh, auth: keys.auth } }
  try {
    const dbId = await getUserDbId(req.username)
    await savePushSubscription(req.username, subscription, dbId)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/push/unsubscribe
// Body (optional): { endpoint } — removes just that device; without it, all of
// the user's subscriptions are removed.
router.delete('/unsubscribe', requireAuth, async (req, res) => {
  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : undefined
  try {
    await deletePushSubscription(req.username, endpoint)
    res.json({ ok: true })
  } catch (err) {
    // Treat "not found" as success — subscription was already gone
    if (err.message === 'not_found') return res.json({ ok: true })
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
