import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getMarkers, saveMarker } from '../utils/markers.js'
import { listTrash, trashMarker, restoreMarker, deleteFromTrash, emptyTrash } from '../utils/trash.js'
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
router.get('/trash', (_req, res) => res.json(listTrash()))
router.post('/trash/:id/restore', (req, res) => res.json(restoreMarker(Number(req.params.id))))
router.delete('/trash/:id', (req, res) => { deleteFromTrash(Number(req.params.id)); res.json({ ok: true }) })
router.delete('/trash', (_req, res) => { emptyTrash(); res.json({ ok: true }) })
router.put('/:id', (req, res) => res.json(saveMarker(req.body, Number(req.params.id))))
router.patch('/:id', (req, res) => res.json(saveMarker(req.body, Number(req.params.id))))
router.patch('/:id/country', (req, res) => res.json(saveMarker({ country: req.body.country ?? null }, Number(req.params.id))))
// Deleting moves the marker to the trash (kept for 30 days).
router.delete('/:id', (req, res) => res.json({ ok: true, trashed: trashMarker(Number(req.params.id)) }))
export default router
