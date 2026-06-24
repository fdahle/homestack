const express = require('express')
const fetch   = (...args) => import('node-fetch').then(({ default: f }) => f(...args))
const { listUsers, updateUserRoles, deleteUser } = require('../lib/couchdb')

const router  = express.Router()
const DB_BASE = process.env.COUCHDB_URL || 'http://localhost:5984'

async function requireAdmin(req, res, next) {
  const cookie = req.headers.cookie || ''
  try {
    const couchRes = await fetch(`${DB_BASE}/_session`, { headers: { Cookie: cookie } })
    const body     = await couchRes.json()
    if (!body?.userCtx?.name || !(body.userCtx.roles || []).includes('admin')) {
      return res.status(403).json({ error: 'Admin access required' })
    }
    req.adminUsername = body.userCtx.name
    next()
  } catch {
    return res.status(502).json({ error: 'Auth backend unavailable' })
  }
}

// GET /api/admin/users
router.get('/users', requireAdmin, async (_req, res) => {
  try {
    const users = await listUsers()
    return res.json(users.map(u => ({
      username: u.name,
      roles:    u.roles || [],
      dbId:     u.dbId  || null,
    })))
  } catch (err) {
    console.error('[admin] list users failed:', err.message)
    return res.status(500).json({ error: 'Could not list users' })
  }
})

// PATCH /api/admin/users/:username — set admin: true|false
router.patch('/users/:username', requireAdmin, async (req, res) => {
  const { username } = req.params
  const { admin }    = req.body || {}
  if (username === req.adminUsername) {
    return res.status(400).json({ error: 'Cannot modify your own roles' })
  }
  try {
    const users = await listUsers()
    const user  = users.find(u => u.name === username)
    if (!user) return res.status(404).json({ error: 'User not found' })
    let roles = user.roles || []
    if (admin && !roles.includes('admin')) {
      roles = [...roles, 'admin']
    } else if (!admin) {
      roles = roles.filter(r => r !== 'admin')
    }
    await updateUserRoles(username, roles)
    return res.json({ ok: true })
  } catch (err) {
    console.error('[admin] update roles failed:', err.message)
    return res.status(500).json({ error: 'Could not update user roles' })
  }
})

// DELETE /api/admin/users/:username — delete user + their notes DB
router.delete('/users/:username', requireAdmin, async (req, res) => {
  const { username } = req.params
  if (username === req.adminUsername) {
    return res.status(400).json({ error: 'Cannot delete your own account' })
  }
  try {
    await deleteUser(username)
    return res.json({ ok: true })
  } catch (err) {
    console.error('[admin] delete user failed:', err.message)
    return res.status(500).json({ error: 'Could not delete user' })
  }
})

module.exports = router
