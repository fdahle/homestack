import { Router } from 'express'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { getMarkers, saveMarker } from '../utils/markers.js'
import { invalid } from '../utils/validation.js'

const router = Router()
router.use(requireAuth)
router.get('/', (_req, res) => res.json(getMarkers()))
router.post('/', (req, res) => res.status(201).json(saveMarker(req.body)))
router.post('/import', (req, res) => {
  if (!Array.isArray(req.body.markers) || req.body.markers.length < 1 || req.body.markers.length > 100) throw invalid('Import requires 1–100 markers per batch')
  const results = req.body.markers.map((marker, index) => {
    try { return { index, marker: saveMarker(marker) } }
    catch (err) {
      if (!err.status || err.status >= 500) console.error('Import row failed:', err.message)
      return { index, error: err.status && err.status < 500 ? err.message : 'Could not save this marker' }
    }
  })
  res.json({ results })
})
router.put('/:id', (req, res) => res.json(saveMarker(req.body, Number(req.params.id))))
router.patch('/:id', (req, res) => res.json(saveMarker(req.body, Number(req.params.id))))
router.patch('/:id/country', (req, res) => res.json(saveMarker({ country: req.body.country ?? null }, Number(req.params.id))))
router.delete('/:id', (req, res) => {
  if (!db.prepare('DELETE FROM markers WHERE id=?').run(req.params.id).changes) return res.status(404).json({ error: 'Not found' })
  res.json({ ok: true })
})
export default router
