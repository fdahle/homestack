import jwt from 'jsonwebtoken'
import db from '../db.js'

export function requireAuth(req, res, next) {
  try {
    req.user = jwt.verify(req.cookies?.mapper_token, process.env.SESSION_SECRET)
    const user = db.prepare('SELECT id, session_version FROM users ORDER BY id LIMIT 1').get()
    if (!user || req.user.sub !== user.id || req.user.version !== user.session_version) throw new Error('Expired session')
  } catch { return res.status(401).json({ error: 'Session expired. Please sign in again.' }) }
  next()
}
