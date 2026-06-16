const { randomUUID } = require('crypto')
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args))

const BASE    = process.env.COUCHDB_URL      || 'http://localhost:5984'
const DB_USER = process.env.COUCHDB_USER     || 'admin'
const DB_PASS = process.env.COUCHDB_PASSWORD || 'password'

function adminAuth() {
  return 'Basic ' + Buffer.from(`${DB_USER}:${DB_PASS}`).toString('base64')
}

async function couch(method, path, body) {
  const opts = {
    method,
    headers: { Authorization: adminAuth(), 'Content-Type': 'application/json' },
  }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, opts)
  return res
}

async function userExists(username) {
  const res = await couch('HEAD', `/_users/org.couchdb.user:${encodeURIComponent(username)}`)
  return res.status === 200
}

async function hasAnyUsers() {
  const res  = await couch('GET', '/_users/_all_docs?startkey=%22org.couchdb.user%3A%22&endkey=%22org.couchdb.user%3A%EF%BF%BD%22&limit=1')
  const body = await res.json()
  return Array.isArray(body.rows) && body.rows.length > 0
}

async function createUser(username, password, roles = [], dbId) {
  const res = await couch('PUT', `/_users/org.couchdb.user:${encodeURIComponent(username)}`, {
    name:     username,
    password,
    roles,
    type:     'user',
    dbId:     dbId || randomUUID(),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const reason = body.reason || `CouchDB error ${res.status}`
    throw new Error(
      reason === 'The string did not match the expected pattern.'
        ? 'Username contains invalid characters'
        : reason
    )
  }
}

async function createUserDb(dbId) {
  const db  = `notes_${dbId}`
  const res = await couch('PUT', `/${db}`)
  if (!res.ok && res.status !== 412) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.reason || `CouchDB error ${res.status}`)
  }
}

async function setSecurityDoc(username, dbId) {
  const db = `notes_${dbId}`
  await couch('PUT', `/${db}/_security`, {
    admins:  { names: [], roles: [] },
    members: { names: [username], roles: [] },
  })
}

async function getUserDbId(username) {
  const res = await couch('GET', `/_users/org.couchdb.user:${encodeURIComponent(username)}`)
  if (!res.ok) {
    console.log(`[getUserDbId] user doc not found for "${username}" — status ${res.status}`)
    return null
  }
  const doc = await res.json()
  const dbId = doc.dbId || null
  console.log(`[getUserDbId] username="${username}" dbId=${dbId}`)
  return dbId
}

// ── Admin helpers ─────────────────────────────────────────────────────────────

async function listUsers() {
  const res = await couch('GET', '/_users/_all_docs?include_docs=true&startkey=%22org.couchdb.user%3A%22&endkey=%22org.couchdb.user%3A%EF%BF%BD%22')
  if (!res.ok) return []
  const body = await res.json()
  return (body.rows || []).map(r => r.doc).filter(Boolean)
}

async function changeUserPassword(username, newPassword) {
  const res = await couch('GET', `/_users/org.couchdb.user:${encodeURIComponent(username)}`)
  if (!res.ok) throw new Error('User not found')
  const doc = await res.json()
  doc.password = newPassword
  const putRes = await couch('PUT', `/_users/org.couchdb.user:${encodeURIComponent(username)}`, doc)
  if (!putRes.ok) {
    const body = await putRes.json().catch(() => ({}))
    throw new Error(body.reason || `CouchDB error ${putRes.status}`)
  }
}

async function updateUserRoles(username, roles) {
  const res = await couch('GET', `/_users/org.couchdb.user:${encodeURIComponent(username)}`)
  if (!res.ok) throw new Error('User not found')
  const doc = await res.json()
  doc.roles = roles
  const putRes = await couch('PUT', `/_users/org.couchdb.user:${encodeURIComponent(username)}`, doc)
  if (!putRes.ok) {
    const body = await putRes.json().catch(() => ({}))
    throw new Error(body.reason || `CouchDB error ${putRes.status}`)
  }
}

async function deleteUser(username) {
  const res = await couch('GET', `/_users/org.couchdb.user:${encodeURIComponent(username)}`)
  if (!res.ok) throw new Error('User not found')
  const doc = await res.json()
  if (doc.dbId) {
    const delDb = await couch('DELETE', `/notes_${doc.dbId}`)
    if (!delDb.ok && delDb.status !== 404) {
      const body = await delDb.json().catch(() => ({}))
      throw new Error(body.reason || `Could not delete notes database: ${delDb.status}`)
    }
  }
  const delRes = await couch('DELETE', `/_users/org.couchdb.user:${encodeURIComponent(username)}?rev=${encodeURIComponent(doc._rev)}`)
  if (!delRes.ok) {
    const body = await delRes.json().catch(() => ({}))
    throw new Error(body.reason || `CouchDB error ${delRes.status}`)
  }
}

// ── Push subscription helpers ─────────────────────────────────────────────────

const PUSH_DB = 'planner_push_subscriptions'

async function ensurePushDb() {
  const res = await couch('PUT', `/${PUSH_DB}`)
  if (res.ok) {
    console.log(`  ✅ Created push subscriptions database: ${PUSH_DB}`)
  } else if (res.status !== 412) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.reason || `CouchDB error ${res.status}`)
  }
}

async function savePushSubscription(username, subscription) {
  // Fetch existing doc to preserve _rev and sentKeys
  const existing = await couch('GET', `/${PUSH_DB}/${encodeURIComponent(username)}`)
  let rev, sentKeys = []

  if (existing.ok) {
    const existingDoc = await existing.json()
    rev      = existingDoc._rev
    sentKeys = existingDoc.sentKeys || []
  } else if (existing.status !== 404) {
    const body = await existing.json().catch(() => ({}))
    throw new Error(body.reason || `CouchDB error ${existing.status}`)
  }

  const doc = {
    _id: username,
    subscription,
    sentKeys,
    updatedAt: new Date().toISOString(),
  }
  if (rev) doc._rev = rev

  const res = await couch('PUT', `/${PUSH_DB}/${encodeURIComponent(username)}`, doc)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.reason || `CouchDB error ${res.status}`)
  }
}

async function deletePushSubscription(username) {
  const existing = await couch('GET', `/${PUSH_DB}/${encodeURIComponent(username)}`)
  if (existing.status === 404) throw new Error('not_found')
  if (!existing.ok) {
    const body = await existing.json().catch(() => ({}))
    throw new Error(body.reason || `CouchDB error ${existing.status}`)
  }
  const doc = await existing.json()
  const res = await couch('DELETE', `/${PUSH_DB}/${encodeURIComponent(username)}?rev=${encodeURIComponent(doc._rev)}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.reason || `CouchDB error ${res.status}`)
  }
}

async function getAllPushSubscriptions() {
  const res  = await couch('GET', `/${PUSH_DB}/_all_docs?include_docs=true`)
  if (!res.ok) return []
  const body = await res.json()
  return (body.rows || []).map(r => r.doc).filter(Boolean)
}

async function updateSentKeys(username, sentKeys) {
  // Cap at 200 entries to prevent unbounded growth
  const capped = sentKeys.slice(-200)
  const res    = await couch('GET', `/${PUSH_DB}/${encodeURIComponent(username)}`)
  if (!res.ok) return
  const doc    = await res.json()
  doc.sentKeys = capped
  await couch('PUT', `/${PUSH_DB}/${encodeURIComponent(username)}`, doc)
}

module.exports = {
  couch,
  hasAnyUsers, userExists, createUser, createUserDb, setSecurityDoc, getUserDbId,
  changeUserPassword,
  listUsers, updateUserRoles, deleteUser,
  ensurePushDb, savePushSubscription, deletePushSubscription,
  getAllPushSubscriptions, updateSentKeys,
}
