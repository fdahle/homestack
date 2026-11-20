import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { leuteConfig, leuteStatus, startLeuteSync } from '../utils/leute.js'

const router = Router()
router.use(requireAuth)

// { enabled: false } without LEUTE_URL and LEUTE_LINK_TOKEN; the client then shows nothing of it.
router.get('/', (_req, res) => res.json(leuteStatus()))

// Starts a sync (or joins the running one) and answers at once; the client polls GET / until
// `running` is false. Geocoding takes a second per new address.
router.post('/sync', (_req, res) => {
  const config = leuteConfig()
  if (!config.enabled) return res.status(404).json({ error: 'The Leute import is not set up' })
  startLeuteSync({ config }).catch((err) => console.error('Leute sync failed:', err))
  res.status(202).json(leuteStatus(config))
})

export default router
