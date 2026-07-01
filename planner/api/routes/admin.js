const express = require('express')
const { listUsers, updateUserRoles, deleteUser, getUserMeta, changeUserPassword } = require('../lib/couchdb')
const { requireAdmin } = require('../lib/session')
const { validPassword } = require('../lib/validate')

const router = express.Router()

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

// POST /api/admin/users/:username/password — reset a user's password.
// Refused for encrypted accounts: their notes key is wrapped by the user's own
// password, which the admin doesn't know, so a reset would make data unrecoverable.
router.post('/users/:username/password', requireAdmin, async (req, res) => {
  const { username } = req.params
  const { newPassword } = req.body || {}
  if (!validPassword(newPassword)) {
    return res.status(400).json({ error: 'Password must be at least 12 characters' })
  }
  try {
    const { dbId, wrappedDek } = await getUserMeta(username)
    if (!dbId) return res.status(404).json({ error: 'User not found' })
    if (wrappedDek) {
      return res.status(400).json({ error: 'Cannot reset password for an encrypted account — its notes would become unrecoverable' })
    }
    await changeUserPassword(username, newPassword)
    return res.json({ ok: true })
  } catch (err) {
    console.error('[admin] reset password failed:', err.message)
    return res.status(500).json({ error: 'Could not reset password' })
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
