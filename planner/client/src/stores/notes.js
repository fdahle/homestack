import { defineStore } from 'pinia'
import PouchDB from 'pouchdb-browser'
import { encryptField, decryptField, isEncryptedBlob, encryptBytes, decryptBytes } from '../utils/crypto.js'
import { generateAttachmentId, compressImage } from '../utils/attachments.js'
import { useAuthStore } from './auth.js'
import { subscribeToPush, unsubscribeFromPush, syncPushSubscription } from '../composables/usePushNotifications.js'
import { isTaskNote, localDateStr, getNextDueDate } from '../utils/dates.js'

// Re-exported for components that import it from the store.
export { isTaskNote }

const DB_BASE_URL       = import.meta.env.VITE_DB_BASE_URL || `${window.location.origin}/db`
const RETRY_INTERVAL_MS = 10_000
const DEBUG             = import.meta.env.VITE_DEBUG === 'true'

const HTTP_STATUS = {
  200: 'OK', 201: 'Created', 204: 'No Content',
  304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized',
  403: 'Forbidden', 404: 'Not Found', 409: 'Conflict',
  500: 'Server Error', 503: 'Unavailable',
}

function dbg(...args) {
  if (DEBUG) console.log('[sync]', ...args)
}

// ── Smart-view filter helpers ─────────────────────────────────────────────────

function smartToday(notes) {
  const today = localDateStr()
  return notes
    .filter(n => !n.deletedAt && !n.archivedAt && isTaskNote(n) && n.dueDate === today)
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
}

function smartUpcoming(notes) {
  const today = localDateStr()
  return notes
    .filter(n => !n.deletedAt && !n.archivedAt && isTaskNote(n) && n.dueDate && n.dueDate > today)
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
}

function smartAllTasks(notes) {
  return notes
    .filter(n => !n.deletedAt && !n.archivedAt && isTaskNote(n))
    .sort((a, b) => {
      // undated tasks last, then by dueDate ascending
      if (!a.dueDate && b.dueDate) return 1
      if (a.dueDate && !b.dueDate) return -1
      return (a.dueDate || '').localeCompare(b.dueDate || '')
    })
}

function smartOverdue(notes) {
  const today = localDateStr()
  return notes
    .filter(n => !n.deletedAt && !n.archivedAt && isTaskNote(n) && n.dueDate && n.dueDate < today && !n.done)
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
}

// ─────────────────────────────────────────────────────────────────────────────

export const useNotesStore = defineStore('notes', {
  state: () => ({
    notes: [],
    views: [],
    boardColumns: [],
    attachmentUrls: {}, // "<noteId>:<attId>" → object URL (in-memory, regenerated each session)
    currentViewId: 'home', // 'home' | 'trash' | 'smart:today' | 'smart:upcoming' | 'smart:all-tasks' | <view _id>
    syncState: 'local',
    networkDelay: parseInt(localStorage.getItem('networkDelay') ?? '0') || 0,
    error: null,
    sortBy: localStorage.getItem('notesSortBy') || 'default',
    dragLabelBehavior: localStorage.getItem('noteDragLabelBehavior') || 'move',
    doneAutoDeleteDays: parseInt(localStorage.getItem('doneAutoDeleteDays') ?? '') || 30,
    trashRetentionDays: parseInt(localStorage.getItem('trashRetentionDays') ?? '') || 7, // 0 = keep forever
    dailyDigestEnabled: localStorage.getItem('dailyDigestEnabled') === 'true',
    dailyDigestHour: parseInt(localStorage.getItem('dailyDigestHour') ?? '') || 8,
    notificationPermission: null, // 'granted' | 'denied' | 'default' | null (unsupported)
  }),

  getters: {
    filteredNotes(state) {
      // Smart views
      if (state.currentViewId === 'smart:today')     return smartToday(state.notes)
      if (state.currentViewId === 'smart:upcoming')  return smartUpcoming(state.notes)
      if (state.currentViewId === 'smart:all-tasks') return smartAllTasks(state.notes)
      if (state.currentViewId === 'smart:overdue')   return smartOverdue(state.notes)

      let notes
      if (state.currentViewId === 'trash') {
        notes = state.notes.filter(n => !!n.deletedAt)
      } else if (state.currentViewId === 'archive') {
        notes = state.notes.filter(n => !n.deletedAt && !!n.archivedAt)
      } else if (state.currentViewId === 'home') {
        notes = state.notes.filter(n => !n.deletedAt && !n.archivedAt && !n.viewId)
      } else {
        const ids = this.includedViewIds(state.currentViewId)
        notes = state.notes.filter(n => !n.deletedAt && !n.archivedAt && (
          ids.has(n.viewId) ||
          (n.labels || []).some(l => ids.has(l))
        ))
      }
      return notes.slice().sort((a, b) => {
        // Tier 1: pinned notes always first
        const ap = a.pinned ? 0 : 1
        const bp = b.pinned ? 0 : 1
        if (ap !== bp) return ap - bp
        // Tier 2: apply sortBy
        if (state.sortBy === 'title') {
          const cmp = (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase())
          if (cmp !== 0) return cmp
        } else if (state.sortBy === 'createdAt') {
          return b.createdAt.localeCompare(a.createdAt)
        } else if (state.sortBy === 'updatedAt') {
          return (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt)
        } else {
          // 'default': drag-drop order then newest-first
          const ao = a.order ?? -Infinity
          const bo = b.order ?? -Infinity
          if (ao !== bo) return ao - bo
        }
        return b.createdAt.localeCompare(a.createdAt)
      })
    },

    flatViewTree(state) {
      const map = {}
      state.views.forEach(v => { map[v._id] = { ...v, children: [] } })
      const roots = []
      state.views.forEach(v => {
        if (v.parentId && map[v.parentId]) {
          map[v.parentId].children.push(map[v._id])
        } else {
          roots.push(map[v._id])
        }
      })
      const flat = []
      const walk = (nodes, depth) => {
        nodes.sort((a, b) => {
          const ao = a.order ?? 0, bo = b.order ?? 0
          return ao !== bo ? ao - bo : a.name.localeCompare(b.name)
        })
        nodes.forEach(n => {
          const { children, ...viewFields } = n
          flat.push({ ...viewFields, depth, hasChildren: children.length > 0 })
          walk(n.children, depth + 1)
        })
      }
      walk(roots, 0)
      return flat
    },

    // Returns the set of view ids whose notes should appear under `rootId`:
    // rootId itself, plus any descendant chained through children with rollUp=true.
    // A child's notes roll up into its parent only when child.rollUp === true; the
    // chain is followed level by level so a grandchild surfaces only if every link
    // up to rootId has rollUp enabled.
    includedViewIds: (state) => (rootId) => {
      const ids = new Set([rootId])
      let added = true
      while (added) {
        added = false
        for (const v of state.views) {
          if (!ids.has(v._id) && v.rollUp === true && ids.has(v.parentId)) {
            ids.add(v._id)
            added = true
          }
        }
      }
      return ids
    },

    // Count of overdue (past-due, not done) tasks — used for the app icon badge.
    overdueCount(state) {
      return smartOverdue(state.notes).length
    },

    // The viewId a new note should land in given the current view: a real view's
    // id, or null for pseudo/smart views (home, trash, archive, smart:*).
    defaultNoteViewId(state) {
      const pseudoViews = ['home', 'trash', 'archive']
      return (pseudoViews.includes(state.currentViewId) || state.currentViewId.startsWith('smart:'))
        ? null
        : state.currentViewId
    },

    // Returns sorted board columns for a given viewId ('home' or a view _id)
    boardColumnsForView: (state) => (viewId) => {
      return state.boardColumns
        .filter(c => c.viewId === viewId)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    },
  },

  actions: {
    async init(username, dbId) {
      // Cancel any previous timers/handlers if init() is called again (e.g. hot reload)
      this._destroy()

      // Namespace the local store per user. Using a shared local DB name would
      // leak one user's notes into the next session on the same browser (the
      // local IndexedDB outlives logout), and bidirectional sync would then push
      // those notes up into the new user's remote DB. Per-user names make that
      // impossible even if a logout-time wipe is ever missed.
      const remoteDbName = dbId ? `notes_${dbId}` : (username ? `notes_${username}` : null)
      const localDbName  = remoteDbName || 'notes'
      this._local  = new PouchDB(localDbName)
      const remoteUrl = remoteDbName
        ? `${DB_BASE_URL}/${remoteDbName}`
        : import.meta.env.VITE_COUCHDB_URL || 'http://localhost:5984/notes'

      dbg('init — username:', username, '| dbId:', dbId, '| remoteUrl:', remoteUrl)

      this._remote = new PouchDB(remoteUrl, {
        fetch: async (url, opts) => {
          const short = String(url)
            .replace(remoteUrl, '<db>')
            .replace(/since=[^&]+/, 'since=<seq>')
          const method = opts?.method || 'GET'
          if (this.networkDelay > 0) await new Promise(r => setTimeout(r, this.networkDelay))
          const res = await fetch(url, { ...opts, credentials: 'include' })
          const statusText = HTTP_STATUS[res.status] ?? (res.ok ? 'OK' : 'Error')
          if (!(res.status === 404 && short.includes('/_local/')))
            dbg(`${method} ${short} → ${res.status} ${statusText}`)
          return res
        },
      })

      const localInfo = await this._local.info().catch(e => ({ error: e.message }))
      dbg('local db:', localInfo.error
        ? `error — ${localInfo.error}`
        : `${localInfo.doc_count} docs (adapter: ${localInfo.adapter})`)

      const remoteInfo = await this._remote.info().catch(e => ({ error: e.message, status: e.status }))
      dbg('remote db:', remoteInfo.error
        ? `error — ${remoteInfo.error}`
        : `${remoteInfo.doc_count} docs (adapter: ${remoteInfo.adapter})`)

      await this._loadAll()
      await this.pruneTrash()
      await this.pruneDoneTasks()

      // Debounce so that a bulkDocs write (which fires N change events)
      // only triggers one reload instead of N.
      this._changesHandler = this._local
        .changes({ since: 'now', live: true, include_docs: true })
        .on('change', (info) => {
          dbg(`local change: ${info.id} (seq: ${info.seq})`)
          clearTimeout(this._loadTimer)
          this._loadTimer = setTimeout(() => this._loadAll(), 50)
        })

      this._connectSync()
      await this._requestNotificationPermission()
      if (this.notificationPermission === 'granted') {
        subscribeToPush().catch(() => {})
        syncPushSubscription().catch(() => {})
      }
      this._startNotificationPoller()
      this._registerSwMessageHandler()
    },

    _destroy() {
      clearTimeout(this._loadTimer)
      clearTimeout(this._retryTimer)
      clearInterval(this._notifInterval)
      this._syncGen = (this._syncGen || 0) + 1 // invalidate any in-flight handlers
      this._syncHandler?.cancel()
      this._changesHandler?.cancel()
    },

    // Scope a localStorage key to the current user so per-device notification
    // dedup state (firedNotifications, lastDigestDate) doesn't bleed between
    // accounts sharing a browser. Keyed on the stable dbId, falling back to
    // username, then 'anon' for local dev with no auth.
    _nsKey(base) {
      const auth = useAuthStore()
      return `${base}:${auth.dbId || auth.username || 'anon'}`
    },

    _registerSwMessageHandler() {
      if (!('serviceWorker' in navigator) || this._swMessageHandler) return
      this._swMessageHandler = (event) => {
        if (event.data?.type !== 'NOTIFICATION_FIRED' || !event.data.key) return
        try {
          const STORAGE_KEY = this._nsKey('firedNotifications')
          const fired = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'))
          fired.add(event.data.key)
          localStorage.setItem(STORAGE_KEY, JSON.stringify([...fired].slice(-500)))
        } catch {}
      }
      navigator.serviceWorker.addEventListener('message', this._swMessageHandler)
    },

    // ── Encryption helpers ────────────────────────────────────────────────────

    _cryptoCtx() {
      const auth = useAuthStore()
      return auth.encryptionEnabled && auth.encryptionKey ? auth.encryptionKey : null
    },

    async _encryptNote(fields) {
      const key = this._cryptoCtx()
      if (!key) return fields
      return {
        ...fields,
        title:   await encryptField(key, fields.title   || ''),
        content: await encryptField(key, fields.content || ''),
        ...(fields.scratch !== undefined ? { scratch: await encryptField(key, fields.scratch || '') } : {}),
      }
    },

    async _decryptNote(doc) {
      const key = this._cryptoCtx()
      if (!key) return doc
      // Best-effort: a field that fails to decrypt (corruption, or a transient
      // mixed-key state mid key-rotation) falls back to its raw value rather than
      // throwing and aborting the entire load.
      const safeDecrypt = async (val, fallback) => {
        if (!isEncryptedBlob(val)) return val || fallback
        try { return await decryptField(key, val) }
        catch (err) { dbg('decrypt field failed', err?.message); return fallback }
      }
      const attachments = Array.isArray(doc.attachments)
        ? await Promise.all(doc.attachments.map(async (a) =>
            a?.enc && isEncryptedBlob(a.name)
              ? { ...a, name: await safeDecrypt(a.name, a.name) }
              : a))
        : doc.attachments
      return {
        ...doc,
        title:   await safeDecrypt(doc.title,   ''),
        content: await safeDecrypt(doc.content, ''),
        scratch: await safeDecrypt(doc.scratch, ''),
        attachments,
      }
    },

    async _loadAll() {
      const result = await this._local.allDocs({ include_docs: true })
      const deletedCount = result.rows.filter(r => r.doc?._deleted).length
      dbg(`loaded: ${result.rows.length - deletedCount} live, ${deletedCount} deleted (${result.rows.length} total)`)
      const docs = result.rows.map(r => r.doc).filter(d => !d._deleted)

      // Docs without a type are legacy notes — treat them as notes
      const rawNotes = docs.filter(d => d.type === 'note' || !d.type)
      this.notes = await Promise.all(rawNotes.map(n => this._decryptNote(n)))

      this.views = docs
        .filter(d => d.type === 'view')
        .sort((a, b) => a.name.localeCompare(b.name))

      this.boardColumns = docs.filter(d => d.type === 'board_column')

    },

    async _isReachable() {
      try {
        const res = await fetch(this._remote.name, { method: 'HEAD', credentials: 'include', signal: AbortSignal.timeout(2000) })
        const statusText = HTTP_STATUS[res.status] ?? (res.ok ? 'OK' : 'Error')
        dbg(`reachability: HEAD <db> → ${res.status} ${statusText}`)
        if (res.status === 401) {
          this._handleUnauthorized()
          return false
        }
        return res.ok || res.status === 404 // 404 = DB not created yet but server is up
      } catch (err) {
        dbg('reachability failed:', err.message)
        return false
      }
    },

    _handleUnauthorized() {
      this.syncState = 'error'
      // Session is gone server-side — treat as a logout: wipe local note data so
      // it isn't left at rest for whoever logs in next on this browser.
      this.reset().catch(() => {})
      useAuthStore().logout()
      import('../router/index.js').then(({ default: router }) => router.push('/login'))
    },

    async _connectSync() {
      if (!(await this._isReachable())) {
        dbg(`not reachable — retrying in ${RETRY_INTERVAL_MS / 1000}s`)
        this.syncState = 'local'
        this._retryTimer = setTimeout(() => this._connectSync(), RETRY_INTERVAL_MS)
        return
      }

      dbg('starting sync with <db>')
      this._syncGen = (this._syncGen || 0) + 1
      const gen = this._syncGen
      this._syncHandler?.cancel()
      this.syncState = 'active'

      this._syncHandler = this._local
        .sync(this._remote, { live: true, retry: false, checkpoint: false })
        .on('active',   () => { dbg('sync active'); this.syncState = 'active' })
        .on('paused',   (err) => {
          if (err) {
            dbg('sync paused with error —', err?.status, err?.message, err)
          } else {
            dbg('sync up to date')
            this.syncState = 'synced'
          }
        })
        .on('denied',   (err) => { dbg('sync denied —', err?.status, err?.message, JSON.stringify(err)) })
        .on('change',   (info) => {
          const d = info.change || info
          const parts = [`wrote: ${d.docs_written}`, `read: ${d.docs_read}`]
          if (d.pending != null) parts.push(`pending: ${d.pending}`)
          dbg(`sync change [${info.direction}] — ${parts.join(', ')}`)
          this.syncState = 'synced'
        })
        .on('error',    (err) => {
          if (gen !== this._syncGen) return
          const detail = [err?.status, err?.message].filter(Boolean).join(' ') || String(err)
          dbg('sync error —', detail)
          if (err?.status === 401) { this._handleUnauthorized(); return }
          this.syncState = 'local'
          this._retryTimer = setTimeout(() => this._connectSync(), RETRY_INTERVAL_MS)
        })
        .on('complete', (info) => {
          if (gen !== this._syncGen) return
          dbg('sync complete —', info)
          this.syncState = 'local'
          this._retryTimer = setTimeout(() => this._connectSync(), RETRY_INTERVAL_MS)
        })
    },

    // Called on logout. Cancels sync and DESTROYS the local IndexedDB store so no
    // note data is left at rest for the next user on this browser. Must be awaited
    // before navigating away so the wipe completes.
    async reset() {
      this._destroy()
      unsubscribeFromPush().catch(() => {})
      for (const url of Object.values(this.attachmentUrls)) URL.revokeObjectURL(url)
      this.attachmentUrls = {}
      this.notes          = []
      this.views          = []
      this.boardColumns   = []
      this.syncState      = 'local'
      if (this._local) {
        try { await this._local.destroy() }
        catch (err) { dbg('local destroy failed', err?.message) }
        this._local = null
        this._remote = null
      }
    },

    // ── Notifications ─────────────────────────────────────────────────────────

    async _requestNotificationPermission() {
      if (!('Notification' in window)) {
        this.notificationPermission = null
        return
      }
      try {
        if (Notification.permission === 'default') {
          const result = await Notification.requestPermission()
          this.notificationPermission = result
        } else {
          this.notificationPermission = Notification.permission
        }
      } catch {
        this.notificationPermission = Notification.permission || 'default'
      }
    },

    _startNotificationPoller() {
      const STORAGE_KEY = this._nsKey('firedNotifications')

      const getFired = () => {
        try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')) }
        catch { return new Set() }
      }

      const markFired = (key) => {
        const fired = getFired()
        fired.add(key)
        // Cap at 500 entries to prevent unbounded growth
        const arr = [...fired].slice(-500)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(arr))
      }

      const check = () => {
        if (this.notificationPermission !== 'granted') return
        const now = new Date()
        const fired = getFired()
        for (const note of this.notes) {
          if (!note.notificationAt || note.deletedAt) continue
          const fireAt = new Date(note.notificationAt)
          if (fireAt > now) continue
          const key = `${note._id}::${note.notificationAt}`
          if (fired.has(key)) continue
          markFired(key)
          const n = new Notification(note.title || 'Reminder', {
            body: (note.content || '').replace(/[#*`_~[\]]/g, '').slice(0, 120),
            tag: note._id, // deduplicates across multiple open tabs
          })
          n.onclick = () => { window.focus() }
        }
        this._checkDailyDigest(now)
      }

      check() // run immediately to catch missed reminders on page load
      this._notifInterval = setInterval(check, 60_000)
    },

    // Once-per-day summary of tasks due today + overdue. Fires at most once per
    // local calendar day, on the first poll at/after the configured hour.
    _checkDailyDigest(now = new Date()) {
      if (!this.dailyDigestEnabled || this.notificationPermission !== 'granted') return
      if (now.getHours() < this.dailyDigestHour) return
      const today = localDateStr(now)
      const STORAGE = this._nsKey('lastDigestDate')
      if (localStorage.getItem(STORAGE) === today) return
      localStorage.setItem(STORAGE, today) // mark first so we never double-fire

      const dueToday = this.notes.filter(n =>
        !n.deletedAt && !n.archivedAt && isTaskNote(n) && n.dueDate === today && !n.done).length
      const overdue = smartOverdue(this.notes).length
      if (dueToday === 0 && overdue === 0) return

      const parts = []
      if (dueToday) parts.push(`${dueToday} due today`)
      if (overdue)  parts.push(`${overdue} overdue`)
      const n = new Notification('Your tasks today', { body: parts.join(' · '), tag: 'daily-digest' })
      n.onclick = () => window.focus()
    },

    setView(viewId) {
      this.currentViewId = viewId
    },

    // ── Notes ────────────────────────────────────────────────────────────────

    async addNote({ title, content, isTask = false, dueDate = null, dueTime = null, priority = null, contentType = 'plain', recurrence = null, color = null, notificationAt = null, scratch = '', viewId, labels = [] }) {
      this.error = null
      if (!this._local) return
      // viewId defaults to the current view; an explicit value (incl. null) overrides.
      const resolvedViewId = viewId === undefined ? this.defaultNoteViewId : viewId
      const fields = await this._encryptNote({ title: title.trim(), content: content.trim() })
      const res = await this._local.post({
        type:        'note',
        ...fields,
        viewId:      resolvedViewId,
        columnId:    null,
        labels:      Array.isArray(labels) ? labels : [],
        scratch:     scratch || '',
        attachments: [],
        deletedAt:   null,
        isTask:      isTask || false,
        dueDate:     dueDate || null,
        dueTime:     dueTime || null,
        priority:    priority || null,
        color:       color || null,
        notificationAt: notificationAt || null,
        contentType: contentType || 'plain',
        recurrence:  recurrence || null,
        createdAt:   new Date().toISOString(),
      })
      return { _id: res.id }
    },

    async updateNote(note, { title, content, scratch, viewId, labels, isTask, dueDate, dueTime, priority, done, contentType, recurrence }) {
      this.error = null
      const doc    = await this._local.get(note._id)
      const fields = await this._encryptNote({
        title:   title.trim(),
        content: content.trim(),
        ...(scratch !== undefined ? { scratch } : {}),
      })
      await this._local.put({
        ...doc,
        ...fields,
        viewId:      viewId       !== undefined ? viewId       : doc.viewId,
        labels:      labels       !== undefined ? labels       : (doc.labels ?? []),
        isTask:      isTask       !== undefined ? isTask       : doc.isTask,
        dueDate:     dueDate      !== undefined ? (dueDate     || null) : doc.dueDate,
        dueTime:     dueTime      !== undefined ? (dueTime     || null) : (doc.dueTime ?? null),
        priority:    priority     !== undefined ? (priority    || null) : doc.priority,
        done:        done         !== undefined ? done                  : doc.done,
        contentType: contentType  !== undefined ? contentType           : (doc.contentType ?? 'plain'),
        recurrence:  recurrence   !== undefined ? (recurrence  || null) : (doc.recurrence  ?? null),
        updatedAt:   new Date().toISOString(),
      })
    },

    async updateNoteColor(note, color) {
      const doc = await this._local.get(note._id)
      await this._local.put({ ...doc, color: color || null })
    },

    async updateNoteNotification(note, notificationAt) {
      const doc = await this._local.get(note._id)
      await this._local.put({ ...doc, notificationAt: notificationAt || null })
    },

    // ── Attachments ───────────────────────────────────────────────────────────
    // Binary data is stored as CouchDB-native _attachments; the note doc keeps a
    // lightweight `attachments` metadata array. Added/removed immediately (like
    // color/notification) to avoid rev races with the text save on modal close.
    //
    // NOTE: native _attachments bypass the field-encryption applied to
    // title/content. With ENCRYPTION_ENABLED they would sync unencrypted.

    async addAttachment(note, file) {
      this.error = null
      const auth   = useAuthStore()
      const maxMb  = auth.maxAttachmentMb || 10
      const blob   = await compressImage(file)
      if (blob.size > maxMb * 1024 * 1024) {
        const err = new Error(`File is too large (max ${maxMb} MB).`)
        err.code = 'TOO_LARGE'
        throw err
      }
      const id   = generateAttachmentId()
      const type = blob.type || file.type || 'application/octet-stream'
      const name = file.name || 'attachment'

      // When encryption is enabled, encrypt the blob bytes and the filename
      // before they touch CouchDB. The stored blob is opaque octet-stream; the
      // real MIME type stays in plaintext meta.type so the client can render it.
      const key       = this._cryptoCtx()
      const storeBlob = key ? new Blob([await encryptBytes(key, await blob.arrayBuffer())]) : blob
      const storeType = key ? 'application/octet-stream' : type
      const meta = {
        id,
        name: key ? await encryptField(key, name) : name,
        type,
        size: blob.size,
        enc:  !!key,
      }

      const doc = await this._local.get(note._id)
      // putAttachment bumps the rev; re-fetch before writing the metadata field.
      const res = await this._local.putAttachment(note._id, id, doc._rev, storeBlob, storeType)
      const fresh = await this._local.get(note._id)
      fresh.attachments = [...(fresh.attachments || []), meta]
      fresh.updatedAt = new Date().toISOString()
      await this._local.put(fresh)
      void res
      return meta
    },

    async removeAttachment(note, attId) {
      this.error = null
      const doc = await this._local.get(note._id)
      try {
        await this._local.removeAttachment(note._id, attId, doc._rev)
      } catch (err) {
        // 404 = blob already gone; still strip the metadata below.
        if (err.status !== 404) throw err
      }
      const fresh = await this._local.get(note._id)
      fresh.attachments = (fresh.attachments || []).filter(a => a.id !== attId)
      fresh.updatedAt = new Date().toISOString()
      await this._local.put(fresh)

      const key = `${note._id}:${attId}`
      if (this.attachmentUrls[key]) {
        URL.revokeObjectURL(this.attachmentUrls[key])
        delete this.attachmentUrls[key]
      }
    },

    getAttachmentUrl(noteId, attId) {
      const key = `${noteId}:${attId}`
      if (this.attachmentUrls[key]) return this.attachmentUrls[key]
      this.loadAttachmentUrl(noteId, attId)
      return null
    },

    async loadAttachmentUrl(noteId, attId) {
      const key = `${noteId}:${attId}`
      if (this.attachmentUrls[key]) return this.attachmentUrls[key]
      this._loadingUrls = this._loadingUrls || new Set()
      if (this._loadingUrls.has(key)) return null
      this._loadingUrls.add(key)
      try {
        let blob = await this._local.getAttachment(noteId, attId)
        // Decrypt if this attachment was stored encrypted; restore real MIME type.
        const meta      = this.notes.find(n => n._id === noteId)?.attachments?.find(a => a.id === attId)
        const cryptoKey = this._cryptoCtx()
        if (meta?.enc && cryptoKey) {
          const dec = await decryptBytes(cryptoKey, await blob.arrayBuffer())
          blob = new Blob([dec], { type: meta.type || 'application/octet-stream' })
        }
        const url = URL.createObjectURL(blob)
        this.attachmentUrls[key] = url
        return url
      } catch (err) {
        dbg('failed to load attachment', key, err?.message)
        return null
      } finally {
        this._loadingUrls.delete(key)
      }
    },

    // Single get+put for all task-related fields to avoid PouchDB 409 conflicts
    async updateNoteTaskFields(note, { isTask, dueDate, dueTime, priority, done }) {
      const doc = await this._local.get(note._id)
      await this._local.put({
        ...doc,
        isTask:    isTask    ?? doc.isTask    ?? false,
        dueDate:   dueDate   !== undefined ? (dueDate   || null) : (doc.dueDate   ?? null),
        dueTime:   dueTime   !== undefined ? (dueTime   || null) : (doc.dueTime   ?? null),
        priority:  priority  !== undefined ? (priority  || null) : (doc.priority  ?? null),
        done:      done      !== undefined ? done                : (doc.done      ?? false),
        updatedAt: new Date().toISOString(),
      })
    },

    async deleteNote(note) {
      // Soft delete — moves to trash
      this.error = null
      const doc = await this._local.get(note._id)
      await this._local.put({ ...doc, deletedAt: new Date().toISOString() })
    },

    async restoreNote(note) {
      this.error = null
      const doc = await this._local.get(note._id)
      await this._local.put({ ...doc, deletedAt: null, viewId: null })
    },

    // Archive: hide from all active/smart views but keep forever (distinct from
    // Trash, which auto-prunes). archivedAt doubles as the flag + timestamp.
    async archiveNote(note) {
      this.error = null
      const doc = await this._local.get(note._id)
      await this._local.put({ ...doc, archivedAt: new Date().toISOString() })
    },

    async unarchiveNotes(ids) {
      await this._bulkUpdate(ids, (doc) => ({ ...doc, archivedAt: null }))
    },

    async permanentlyDelete(note) {
      this.error = null
      const doc = await this._local.get(note._id)
      await this._local.remove(doc)
    },

    async duplicateNote(note) {
      this.error = null
      const viewId    = note.deletedAt ? null : (note.viewId ?? null)
      const rawTitle  = (note.title || '').trim() ? note.title.trim() + ' (copy)' : ''
      const rawContent = note.content ?? ''
      const fields    = await this._encryptNote({ title: rawTitle, content: rawContent, scratch: note.scratch ?? '' })
      const meta      = note.attachments || []
      const key       = this._cryptoCtx()

      // In-memory meta carries the decrypted filename; re-encrypt it for the copy
      // so the duplicate's stored metadata stays encrypted too.
      const copiedMeta = await Promise.all(meta.map(async (a) => ({
        ...a,
        name: (a.enc && key && !isEncryptedBlob(a.name)) ? await encryptField(key, a.name) : a.name,
      })))

      const res = await this._local.post({
        type:       'note',
        ...fields,
        color:      note.color      ?? null,
        viewId,
        columnId:   viewId ? (note.columnId ?? null) : null,
        deletedAt:  null,
        isTask:     note.isTask     ?? false,
        dueDate:    note.dueDate    ?? null,
        dueTime:    note.dueTime    ?? null,
        priority:   note.priority   ?? null,
        recurrence: note.recurrence ?? null,
        attachments: copiedMeta,
        createdAt:  new Date().toISOString(),
      })

      // Copy attachment blobs so the duplicate is independent of the original.
      // Stored bytes are already encrypted for enc attachments; copy verbatim.
      let rev = res.rev
      for (const a of meta) {
        try {
          const blob   = await this._local.getAttachment(note._id, a.id)
          const result = await this._local.putAttachment(res.id, a.id, rev, blob, a.enc ? 'application/octet-stream' : a.type)
          rev = result.rev
        } catch { /* skip missing blob */ }
      }
    },

    async pinNote(note) {
      this.error = null
      const doc = await this._local.get(note._id)
      await this._local.put({ ...doc, pinned: !doc.pinned })
    },

    async toggleDone(note) {
      this.error = null
      const doc  = await this._local.get(note._id)
      const done = !doc.done

      if (done && doc.recurrence) {
        const nextDue = doc.dueDate ? getNextDueDate(doc.dueDate, doc.recurrence) : null
        await this._local.post({
          type:        'note',
          title:       doc.title       ?? '',
          content:     doc.content     ?? '',
          viewId:      doc.viewId      ?? null,
          columnId:    doc.columnId    ?? null,
          labels:      doc.labels      ?? [],
          scratch:     doc.scratch     ?? '',
          color:       doc.color       ?? null,
          deletedAt:   null,
          isTask:      doc.isTask      ?? true,
          dueDate:     nextDue,
          dueTime:     doc.dueTime     ?? null,
          priority:    doc.priority    ?? null,
          contentType: doc.contentType ?? 'plain',
          recurrence:  doc.recurrence,
          createdAt:   new Date().toISOString(),
        })
      }

      await this._local.put({
        ...doc,
        done,
        doneAt: done ? new Date().toISOString() : null,
      })
    },

    setSortBy(value) {
      this.sortBy = value
      localStorage.setItem('notesSortBy', value)
    },

    setNetworkDelay(ms) {
      this.networkDelay = ms
      localStorage.setItem('networkDelay', String(ms))
    },

    forceSync() {
      clearTimeout(this._retryTimer)
      this.syncState = 'active'
      this._connectSync()
    },

    setDragLabelBehavior(value) {
      this.dragLabelBehavior = value
      localStorage.setItem('noteDragLabelBehavior', value)
    },

    async moveNoteToView(noteId, viewId) {
      this.error = null
      if (!this._local) return
      const doc = await this._local.get(noteId)
      await this._local.put({ ...doc, viewId, columnId: null, updatedAt: new Date().toISOString() })
    },

    async addNoteLabel(noteId, viewId) {
      this.error = null
      if (!this._local) return
      const doc = await this._local.get(noteId)
      const labels = Array.isArray(doc.labels) ? doc.labels : []
      if (!labels.includes(viewId)) {
        await this._local.put({ ...doc, labels: [...labels, viewId], updatedAt: new Date().toISOString() })
      }
    },

    // Fetch the latest docs for `ids` and write back transform(doc, id) for each.
    // Centralizes the allDocs → map → bulkDocs pattern used across the store.
    async _bulkUpdate(ids, transform) {
      if (!ids.length) return
      const result  = await this._local.allDocs({ keys: ids, include_docs: true })
      const updates = result.rows.filter(r => r.doc).map(r => transform(r.doc, r.id))
      await this._local.bulkDocs(updates)
    },

    async pruneTrash() {
      if (!this.trashRetentionDays) return // 0 = keep trashed notes until manually deleted
      const cutoff  = new Date(Date.now() - this.trashRetentionDays * 24 * 60 * 60 * 1000).toISOString()
      const ids     = this.notes.filter(n => n.deletedAt && n.deletedAt < cutoff).map(n => n._id)
      await this._bulkUpdate(ids, (doc) => ({ ...doc, _deleted: true }))
    },

    setTrashRetentionDays(days) {
      this.trashRetentionDays = parseInt(days) || 0
      localStorage.setItem('trashRetentionDays', String(this.trashRetentionDays))
    },

    async pruneDoneTasks() {
      if (!this.doneAutoDeleteDays) return
      const cutoff = new Date(Date.now() - this.doneAutoDeleteDays * 24 * 60 * 60 * 1000).toISOString()
      const now    = new Date().toISOString()
      const ids    = this.notes.filter(n => n.done && !n.deletedAt && n.doneAt && n.doneAt < cutoff).map(n => n._id)
      await this._bulkUpdate(ids, (doc) => ({ ...doc, deletedAt: now }))
    },

    setDoneAutoDeleteDays(days) {
      this.doneAutoDeleteDays = parseInt(days) || 0
      localStorage.setItem('doneAutoDeleteDays', String(this.doneAutoDeleteDays))
    },

    setDailyDigestEnabled(enabled) {
      this.dailyDigestEnabled = !!enabled
      localStorage.setItem('dailyDigestEnabled', String(this.dailyDigestEnabled))
      // Allow the digest to fire again today if just re-enabled.
      if (this.dailyDigestEnabled) localStorage.removeItem(this._nsKey('lastDigestDate'))
    },

    setDailyDigestHour(hour) {
      const h = Math.min(23, Math.max(0, parseInt(hour) || 0))
      this.dailyDigestHour = h
      localStorage.setItem('dailyDigestHour', String(h))
    },

    async bulkDelete(ids) {
      const now = new Date().toISOString()
      await this._bulkUpdate(ids, (doc) => ({ ...doc, deletedAt: now }))
    },

    // Immediate undo of a (soft) delete — clears deletedAt while preserving the
    // note's view/column placement (unlike restoreNote, which sends it to Home).
    async undeleteNotes(ids) {
      await this._bulkUpdate(ids, (doc) => ({ ...doc, deletedAt: null }))
    },

    async bulkMove(ids, viewId) {
      const now = new Date().toISOString()
      await this._bulkUpdate(ids, (doc) => ({ ...doc, viewId: viewId ?? null, columnId: null, updatedAt: now }))
    },

    // Reorder notes by assigning sequential `order` values (0, 1, 2 …).
    // Pass `columnId` to also update the notes' column assignment:
    //   undefined  → leave existing columnId unchanged
    //   null       → assign to Uncategorized (columnId: null)
    //   '<id>'     → assign to that board column
    async reorderNotes(noteIds, columnId) {
      await this._bulkUpdate(noteIds, (doc, id) => ({
        ...doc,
        order: noteIds.indexOf(id),
        ...(columnId !== undefined ? { columnId } : {}),
      }))
    },

    // ── Export / Import ───────────────────────────────────────────────────────

    exportData() {
      // this.notes already holds decrypted values (decrypted in _loadAll) so export is plaintext.
      const docs = [
        ...this.notes,
        ...this.views,
        ...this.boardColumns,
      // Strip _rev — it's PouchDB sync metadata, not portable across instances
      ].map(({ _rev, ...rest }) => rest)
      return {
        exportedAt: new Date().toISOString(),
        version: 1,
        docs,
      }
    },

    async importData(payload, { overwrite = false } = {}) {
      if (!payload?.docs || !Array.isArray(payload.docs)) {
        throw new Error('Invalid import file: missing docs array')
      }
      const existingResult = await this._local.allDocs({ include_docs: false })
      const existingIds    = new Set(existingResult.rows.map(r => r.id))

      const toImport = []
      for (let doc of payload.docs) {
        if (!doc._id) continue

        // Encrypt notes on import if encryption is active
        if (doc.type === 'note' || !doc.type) {
          const fields = await this._encryptNote({ title: doc.title || '', content: doc.content || '', scratch: doc.scratch || '' })
          doc = { ...doc, ...fields }
        }

        if (existingIds.has(doc._id)) {
          if (!overwrite) continue
          try {
            const current = await this._local.get(doc._id)
            toImport.push({ ...doc, _rev: current._rev })
          } catch {
            toImport.push(doc)
          }
        } else {
          toImport.push(doc)
        }
      }

      await this._local.bulkDocs(toImport)
      return toImport.length
    },

    // ── Board columns ─────────────────────────────────────────────────────────

    async addBoardColumn(viewId, name) {
      const existing = this.boardColumns.filter(c => c.viewId === viewId)
      const maxOrder = existing.length ? Math.max(...existing.map(c => c.order ?? 0)) : -1
      await this._local.post({
        type:      'board_column',
        viewId,
        name:      name.trim(),
        order:     maxOrder + 1,
        createdAt: new Date().toISOString(),
      })
    },

    async renameBoardColumn(id, name) {
      const doc = await this._local.get(id)
      await this._local.put({ ...doc, name: name.trim() })
    },

    async deleteBoardColumn(id) {
      // Move all notes in this column back to Uncategorized
      const noteIds = this.notes.filter(n => n.columnId === id).map(n => n._id)
      await this._bulkUpdate(noteIds, (doc) => ({ ...doc, columnId: null }))
      const doc = await this._local.get(id)
      await this._local.remove(doc)
    },

    // ── Views ─────────────────────────────────────────────────────────────────

    async addView(name, parentId = null) {
      this.error = null
      if (!this._local) return // DB torn down (e.g. session expired) — redirect is in flight
      const siblings = this.views.filter(v => (v.parentId ?? null) === (parentId || null))
      const maxOrder = siblings.length ? Math.max(...siblings.map(v => v.order ?? 0)) : -1
      await this._local.post({
        type:      'view',
        name:      name.trim(),
        parentId:  parentId || null,
        order:     maxOrder + 1,
        createdAt: new Date().toISOString(),
      })
    },

    async updateView(viewId, changes) {
      this.error = null
      if (!this._local) return
      const doc = await this._local.get(viewId)
      await this._local.put({ ...doc, ...changes })
    },

    async moveView(draggedId, targetId, position) {
      this.error = null
      if (!this._local) return
      const target = this.views.find(v => v._id === targetId)
      if (!target) return
      const newParentId = position === 'inside' ? targetId : (target.parentId ?? null)
      // Build new sibling order: existing siblings (minus dragged), then insert dragged
      const siblings = this.views
        .filter(v => (v.parentId ?? null) === newParentId && v._id !== draggedId)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
      if (position === 'inside') {
        siblings.push({ _id: draggedId })
      } else {
        const idx = siblings.findIndex(v => v._id === targetId)
        siblings.splice(position === 'before' ? idx : idx + 1, 0, { _id: draggedId })
      }
      const siblingIds = siblings.map(s => s._id)
      await this._bulkUpdate(siblingIds, (doc, id) => ({ ...doc, parentId: newParentId, order: siblingIds.indexOf(id) }))
    },

    async deleteView(view) {
      this.error = null
      if (!this._local) return
      // Collect this view and all descendants
      const toDelete = []
      const collect = (id) => {
        toDelete.push(id)
        this.views.filter(v => v.parentId === id).forEach(v => collect(v._id))
      }
      collect(view._id)
      // Move notes from deleted views back to Home; also strip stale labels
      const affectedNotes = this.notes.filter(n =>
        toDelete.includes(n.viewId) ||
        (Array.isArray(n.labels) && n.labels.some(l => toDelete.includes(l)))
      )
      for (const note of affectedNotes) {
        const doc = await this._local.get(note._id)
        await this._local.put({
          ...doc,
          viewId: toDelete.includes(doc.viewId) ? null : doc.viewId,
          labels: (doc.labels || []).filter(l => !toDelete.includes(l)),
        })
      }
      // Delete all views in the subtree
      for (const id of toDelete) {
        const doc = await this._local.get(id)
        await this._local.remove(doc)
      }
      // Delete board columns that belonged to these views
      for (const col of this.boardColumns.filter(c => toDelete.includes(c.viewId))) {
        const doc = await this._local.get(col._id)
        await this._local.remove(doc)
      }
      if (toDelete.includes(this.currentViewId)) this.currentViewId = 'home'
    },
  },
})
