import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { bandeConfig, bandeStatus, startBandeSync } from '../utils/bande.js'

const router = Router()
router.use(requireAuth)

// { enabled: false } without BANDE_URL and BANDE_LINK_TOKEN; the client then shows nothing of it.
router.get('/', (_req, res) => res.json(bandeStatus()))

// Starts a sync (or joins the running one) and answers at once; the client polls GET / until
// `running` is false. Geocoding takes a second per new address.
router.post('/sync', (_req, res) => {
  const config = bandeConfig()
  if (!config.enabled) return res.status(404).json({ error: 'The Bande import is not set up' })
  startBandeSync({ config }).catch((err) => console.error('Bande sync failed:', err))
  res.status(202).json(bandeStatus(config))
})

export default router
