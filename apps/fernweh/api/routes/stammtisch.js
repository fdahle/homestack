import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { stammtischConfig, stammtischStatus, startStammtischSync } from '../utils/stammtisch.js'

const router = Router()
router.use(requireAuth)

// { enabled: false } without STAMMTISCH_URL and STAMMTISCH_LINK_TOKEN; the client then shows nothing of it.
router.get('/', (_req, res) => res.json(stammtischStatus()))

// Starts a sync (or joins the running one) and answers at once; the client polls GET / until
// `running` is false. Geocoding takes a second per new address.
router.post('/sync', (_req, res) => {
  const config = stammtischConfig()
  if (!config.enabled) return res.status(404).json({ error: 'The Stammtisch import is not set up' })
  startStammtischSync({ config }).catch((err) => console.error('Stammtisch sync failed:', err))
  res.status(202).json(stammtischStatus(config))
})

export default router
