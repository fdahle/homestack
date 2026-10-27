const { randomUUID, randomBytes } = require('crypto')
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args))
const { validDbId } = require('./validate')

const BASE    = process.env.COUCHDB_URL      || 'http://localhost:5984'
const DB_USER = process.env.COUCHDB_USER     || 'admin'
const DB_PASS = process.env.COUCHDB_PASSWORD || 'password'

// Identifying info is only logged outside production.
function debug(...args) { if (process.env.NODE_ENV !== 'production') console.log(...args) }

// CouchDB stores users as docs keyed `org.couchdb.user:<name>`. These bound an
// _all_docs range query over just the user docs (%EF%BF%BD = U+FFFD, sorts last).
const USER_DOC_PREFIX  = 'org.couchdb.user:'
const USER_RANGE_QUERY = 'startkey=%22org.couchdb.user%3A%22&endkey=%22org.couchdb.user%3A%EF%BF%BD%22'

function userDocPath(username) {
  return `/_users/${USER_DOC_PREFIX}${encodeURIComponent(username)}`
}

// Path of a user's notes DB. Users can edit their own `_users` doc (where the
// dbId lives) through CouchDB, so refuse anything but a well-formed id — a value
// like `x/../_users` would otherwise steer an admin request at another database.
function notesDbPath(dbId) {
  if (!validDbId(dbId)) throw new Error('Invalid notes database id')
  return `/${encodeURIComponent(`notes_${dbId}`)}`
}

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
  const res = await couch('HEAD', userDocPath(username))
  return res.status === 200
}

async function hasAnyUsers() {
  const res  = await couch('GET', `/_users/_all_docs?${USER_RANGE_QUERY}&limit=1`)
  const body = await res.json()
  return Array.isArray(body.rows) && body.rows.length > 0
}

// GET → mutate(doc) → PUT a single user doc. Shared by the password/roles updates.
async function updateUserDoc(username, mutate) {
  const res = await couch('GET', userDocPath(username))
  if (!res.ok) throw new Error('User not found')
  const doc = mutate(await res.json())
  const putRes = await couch('PUT', userDocPath(username), doc)
  if (!putRes.ok) {
    const body = await putRes.json().catch(() => ({}))
    const err  = new Error(body.reason || `CouchDB error ${putRes.status}`)
    err.status = putRes.status
    throw err
  }
}

async function createUser(username, password, roles = [], dbId) {
  const res = await couch('PUT', userDocPath(username), {
    name:     username,
    password,
    roles,
    type:     'user',
    dbId:     dbId || randomUUID(),
    // Random per-user salt for client-side key derivation. Not secret; the
    // client fetches it at login and the server never sees the derived key.
    encSalt:  randomBytes(16).toString('base64'),
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
  const res = await couch('PUT', notesDbPath(dbId))
  if (!res.ok && res.status !== 412) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.reason || `CouchDB error ${res.status}`)
  }
}

async function setSecurityDoc(username, dbId) {
  const res = await couch('PUT', `${notesDbPath(dbId)}/_security`, {
    admins:  { names: [], roles: [] },
    members: { names: [username], roles: [] },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.reason || `CouchDB error ${res.status}`)
  }
}

// User doc + notes DB + security doc. Shared by registration and the startup
// admin bootstrap.
async function provisionUser(username, password, roles = []) {
  const dbId = randomUUID()
  await createUser(username, password, roles, dbId)
  await createUserDb(dbId)
  await setSecurityDoc(username, dbId)
  return dbId
}

async function getUserDbId(username) {
  const res = await couch('GET', userDocPath(username))
  if (!res.ok) {
    debug(`[getUserDbId] user doc not found for "${username}" — status ${res.status}`)
    return null
  }
  const doc = await res.json()
  const dbId = validDbId(doc.dbId) ? doc.dbId : null
  debug(`[getUserDbId] username="${username}" dbId=${dbId}`)
  return dbId
}

// Returns the bits the client needs after authenticating: the notes DB id and
// the encryption salt. The salt is non-secret (see createUser). Throws (with
// `status`) when the lookup fails — callers must not carry on with null values,
// or an encrypted client would mint a fresh key and orphan its notes.
async function getUserMeta(username) {
  const res = await couch('GET', userDocPath(username))
  if (!res.ok) {
    debug(`[getUserMeta] user doc lookup failed for "${username}" — status ${res.status}`)
    const err  = new Error(res.status === 404 ? 'User not found' : `CouchDB error ${res.status}`)
    err.status = res.status
    throw err
  }
  const doc = await res.json()
  return {
    dbId:       validDbId(doc.dbId) ? doc.dbId : null,
    encSalt:    doc.encSalt || null,
    // Wrapped Data Encryption Key (envelope encryption). Opaque to the server —
    // it can only be unwrapped client-side with the password-derived KEK.
    wrappedDek: doc.encWrappedDek || null,
  }
}

// ── Admin helpers ─────────────────────────────────────────────────────────────

async function listUsers() {
  const res = await couch('GET', `/_users/_all_docs?include_docs=true&${USER_RANGE_QUERY}`)
  if (!res.ok) return []
  const body = await res.json()
  return (body.rows || []).map(r => r.doc).filter(Boolean)
}

// Changes the password and, when provided, the wrapped DEK in the SAME user-doc
// write so the two can never diverge (a password whose KEK no longer unwraps the
// stored DEK would lock the user out of their notes).
async function changeUserPassword(username, newPassword, wrappedDek) {
  await updateUserDoc(username, (doc) => ({
    ...doc,
    password: newPassword,
    ...(wrappedDek !== undefined ? { encWrappedDek: wrappedDek } : {}),
  }))
}

// Only ever sets the FIRST wrapped DEK. Overwriting an existing one would orphan
// every note encrypted under it, so that throws with status 409 (a concurrent
// first write loses CouchDB's rev check and also surfaces as 409).
async function setUserWrappedDek(username, wrappedDek) {
  await updateUserDoc(username, (doc) => {
    if (doc.encWrappedDek) {
      const err  = new Error('Encryption key already set')
      err.status = 409
      throw err
    }
    return { ...doc, encWrappedDek: wrappedDek }
  })
}

async function updateUserRoles(username, roles) {
  await updateUserDoc(username, (doc) => ({ ...doc, roles }))
}

async function deleteUser(username) {
  const res = await couch('GET', userDocPath(username))
  if (!res.ok) throw new Error('User not found')
  const doc = await res.json()
  if (doc.dbId && !validDbId(doc.dbId)) {
    // Tampered user doc — never DELETE a path built from it.
    console.warn('[deleteUser] user doc has an invalid dbId; no notes database deleted')
  } else if (doc.dbId) {
    const delDb = await couch('DELETE', notesDbPath(doc.dbId))
    if (!delDb.ok && delDb.status !== 404) {
      const body = await delDb.json().catch(() => ({}))
      throw new Error(body.reason || `Could not delete notes database: ${delDb.status}`)
    }
  }
  const delRes = await couch('DELETE', `${userDocPath(username)}?rev=${encodeURIComponent(doc._rev)}`)
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

// One doc per user holding one subscription per device (keyed by endpoint).
// Older docs stored a single `subscription` field — read those as a 1-item list.
const MAX_PUSH_DEVICES = 10

function pushSubscriptionsOf(doc) {
  if (Array.isArray(doc?.subscriptions)) return doc.subscriptions
  return doc?.subscription ? [doc.subscription] : []
}

async function savePushSubscription(username, subscription, dbId) {
  // Fetch existing doc to preserve _rev, sentKeys, dbId and other devices
  const existing = await couch('GET', `/${PUSH_DB}/${encodeURIComponent(username)}`)
  let rev, sentKeys = [], existingDbId = null, subscriptions = []

  if (existing.ok) {
    const existingDoc = await existing.json()
    rev           = existingDoc._rev
    sentKeys      = existingDoc.sentKeys || []
    existingDbId  = validDbId(existingDoc.dbId) ? existingDoc.dbId : null
    subscriptions = pushSubscriptionsOf(existingDoc).filter(s => s?.endpoint !== subscription.endpoint)
  } else if (existing.status !== 404) {
    const body = await existing.json().catch(() => ({}))
    throw new Error(body.reason || `CouchDB error ${existing.status}`)
  }

  const doc = {
    _id: username,
    subscriptions: [...subscriptions, subscription].slice(-MAX_PUSH_DEVICES),
    sentKeys,
    // The user's notes DB is named notes_<dbId>; store it so the push
    // scheduler can find the right database (it can't derive it from username).
    dbId: (validDbId(dbId) ? dbId : null) || existingDbId,
    updatedAt: new Date().toISOString(),
  }
  if (rev) doc._rev = rev

  const res = await couch('PUT', `/${PUSH_DB}/${encodeURIComponent(username)}`, doc)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.reason || `CouchDB error ${res.status}`)
  }
}

// Removes one device's subscription (by endpoint), or all of the user's when no
// endpoint is given. The doc is deleted once no subscriptions remain.
async function deletePushSubscription(username, endpoint) {
  const existing = await couch('GET', `/${PUSH_DB}/${encodeURIComponent(username)}`)
  if (existing.status === 404) throw new Error('not_found')
  if (!existing.ok) {
    const body = await existing.json().catch(() => ({}))
    throw new Error(body.reason || `CouchDB error ${existing.status}`)
  }
  const doc       = await existing.json()
  const remaining = endpoint ? pushSubscriptionsOf(doc).filter(s => s?.endpoint !== endpoint) : []
  const docPath   = `/${PUSH_DB}/${encodeURIComponent(username)}`
  const res = remaining.length
    ? await couch('PUT', docPath, { ...doc, subscription: undefined, subscriptions: remaining })
    : await couch('DELETE', `${docPath}?rev=${encodeURIComponent(doc._rev)}`)
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
  couch, notesDbPath,
  hasAnyUsers, userExists, createUser, createUserDb, setSecurityDoc, provisionUser, getUserDbId, getUserMeta,
  changeUserPassword, setUserWrappedDek,
  listUsers, updateUserRoles, deleteUser,
  ensurePushDb, savePushSubscription, deletePushSubscription, pushSubscriptionsOf,
  getAllPushSubscriptions, updateSentKeys,
}
