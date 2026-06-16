import { defineStore } from 'pinia'
import PouchDB from 'pouchdb-browser'
import { encryptField, decryptField, isEncryptedBlob } from '../utils/crypto.js'
import { useAuthStore } from './auth.js'
import { subscribeToPush, unsubscribeFromPush, syncPushSubscription } from '../composables/usePushNotifications.js'

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

// A note is a "task" if explicitly flagged or if it has a due date.
// This is a pure read-time derivation — never stored.
export function isTaskNote(note) {
  return note.isTask === true || (note.dueDate != null && note.dueDate !== '')
}

function getNextDueDate(currentDue, recurrence) {
  const d = new Date(currentDue + 'T00:00:00')
  if (recurrence === 'daily')        d.setDate(d.getDate() + 1)
  else if (recurrence === 'weekly')  d.setDate(d.getDate() + 7)
  else if (recurrence === 'monthly') d.setMonth(d.getMonth() + 1)
  return d.toISOString().slice(0, 10)
}

// ── Smart-view filter helpers ─────────────────────────────────────────────────

function smartToday(notes) {
  const today = new Date().toISOString().slice(0, 10)
  return notes
    .filter(n => !n.deletedAt && isTaskNote(n) && n.dueDate === today)
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
}

function smartUpcoming(notes) {
  const today = new Date().toISOString().slice(0, 10)
  return notes
    .filter(n => !n.deletedAt && isTaskNote(n) && n.dueDate && n.dueDate > today)
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
}

function smartAllTasks(notes) {
  return notes
    .filter(n => !n.deletedAt && isTaskNote(n))
    .sort((a, b) => {
      // undated tasks last, then by dueDate ascending
      if (!a.dueDate && b.dueDate) return 1
      if (a.dueDate && !b.dueDate) return -1
      return (a.dueDate || '').localeCompare(b.dueDate || '')
    })
}

function smartOverdue(notes) {
  const today = new Date().toISOString().slice(0, 10)
  return notes
    .filter(n => !n.deletedAt && isTaskNote(n) && n.dueDate && n.dueDate < today && !n.done)
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
}

// ─────────────────────────────────────────────────────────────────────────────

export const useNotesStore = defineStore('notes', {
  state: () => ({
    notes: [],
    views: [],
    boardColumns: [],
    currentViewId: 'home', // 'home' | 'trash' | 'smart:today' | 'smart:upcoming' | 'smart:all-tasks' | <view _id>
    syncState: 'local',
    networkDelay: parseInt(localStorage.getItem('networkDelay') ?? '0') || 0,
    error: null,
    sortBy: localStorage.getItem('notesSortBy') || 'default',
    dragLabelBehavior: localStorage.getItem('noteDragLabelBehavior') || 'move',
    doneAutoDeleteDays: parseInt(localStorage.getItem('doneAutoDeleteDays') ?? '') || 30,
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
      } else if (state.currentViewId === 'home') {
        notes = state.notes.filter(n => !n.deletedAt && !n.viewId)
      } else {
        notes = state.notes.filter(n => !n.deletedAt && (
          n.viewId === state.currentViewId ||
          (n.labels || []).includes(state.currentViewId)
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

      this._local  = new PouchDB('notes')
      const remoteDbName = dbId ? `notes_${dbId}` : (username ? `notes_${username}` : null)
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

    _registerSwMessageHandler() {
      if (!('serviceWorker' in navigator) || this._swMessageHandler) return
      this._swMessageHandler = (event) => {
        if (event.data?.type !== 'NOTIFICATION_FIRED' || !event.data.key) return
        try {
          const STORAGE_KEY = 'firedNotifications'
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
      }
    },

    async _decryptNote(doc) {
      const key = this._cryptoCtx()
      if (!key) return doc
      return {
        ...doc,
        title:   isEncryptedBlob(doc.title)   ? await decryptField(key, doc.title)   : (doc.title   || ''),
        content: isEncryptedBlob(doc.content) ? await decryptField(key, doc.content) : (doc.content || ''),
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

    reset() {
      this._destroy()
      unsubscribeFromPush().catch(() => {})
      this.notes        = []
      this.views        = []
      this.boardColumns = []
      this.syncState    = 'local'
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
      const STORAGE_KEY = 'firedNotifications'

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
      }

      check() // run immediately to catch missed reminders on page load
      this._notifInterval = setInterval(check, 60_000)
    },

    setView(viewId) {
      this.currentViewId = viewId
    },

    // ── Notes ────────────────────────────────────────────────────────────────

    async addNote({ title, content, isTask = false, dueDate = null, priority = null, contentType = 'plain', recurrence = null }) {
      this.error = null
      const viewId = (this.currentViewId === 'home' || this.currentViewId === 'trash' || this.currentViewId.startsWith('smart:'))
        ? null
        : this.currentViewId
      const fields = await this._encryptNote({ title: title.trim(), content: content.trim() })
      await this._local.post({
        type:        'note',
        ...fields,
        viewId,
        columnId:    null,
        labels:      [],
        deletedAt:   null,
        isTask:      isTask || false,
        dueDate:     dueDate || null,
        priority:    priority || null,
        contentType: contentType || 'plain',
        recurrence:  recurrence || null,
        createdAt:   new Date().toISOString(),
      })
    },

    async updateNote(note, { title, content, viewId, labels, isTask, dueDate, priority, done, contentType, recurrence }) {
      this.error = null
      const doc    = await this._local.get(note._id)
      const fields = await this._encryptNote({ title: title.trim(), content: content.trim() })
      await this._local.put({
        ...doc,
        ...fields,
        viewId:      viewId       !== undefined ? viewId       : doc.viewId,
        labels:      labels       !== undefined ? labels       : (doc.labels ?? []),
        isTask:      isTask       !== undefined ? isTask       : doc.isTask,
        dueDate:     dueDate      !== undefined ? (dueDate     || null) : doc.dueDate,
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

    // Single get+put for all task-related fields to avoid PouchDB 409 conflicts
    async updateNoteTaskFields(note, { isTask, dueDate, priority, done }) {
      const doc = await this._local.get(note._id)
      await this._local.put({
        ...doc,
        isTask:    isTask    ?? doc.isTask    ?? false,
        dueDate:   dueDate   !== undefined ? (dueDate   || null) : (doc.dueDate   ?? null),
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
      const fields    = await this._encryptNote({ title: rawTitle, content: rawContent })
      await this._local.post({
        type:       'note',
        ...fields,
        color:      note.color      ?? null,
        viewId,
        columnId:   viewId ? (note.columnId ?? null) : null,
        deletedAt:  null,
        isTask:     note.isTask     ?? false,
        dueDate:    note.dueDate    ?? null,
        priority:   note.priority   ?? null,
        recurrence: note.recurrence ?? null,
        createdAt:  new Date().toISOString(),
      })
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
          color:       doc.color       ?? null,
          deletedAt:   null,
          isTask:      doc.isTask      ?? true,
          dueDate:     nextDue,
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
      const doc = await this._local.get(noteId)
      await this._local.put({ ...doc, viewId, columnId: null, updatedAt: new Date().toISOString() })
    },

    async addNoteLabel(noteId, viewId) {
      this.error = null
      const doc = await this._local.get(noteId)
      const labels = Array.isArray(doc.labels) ? doc.labels : []
      if (!labels.includes(viewId)) {
        await this._local.put({ ...doc, labels: [...labels, viewId], updatedAt: new Date().toISOString() })
      }
    },

    async pruneTrash() {
      const cutoff  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const expired = this.notes.filter(n => n.deletedAt && n.deletedAt < cutoff)
      if (!expired.length) return
      const ids    = expired.map(n => n._id)
      const result = await this._local.allDocs({ keys: ids, include_docs: true })
      const deletes = result.rows
        .filter(r => r.doc)
        .map(r => ({ ...r.doc, _deleted: true }))
      await this._local.bulkDocs(deletes)
    },

    async pruneDoneTasks() {
      if (!this.doneAutoDeleteDays) return
      const cutoff  = new Date(Date.now() - this.doneAutoDeleteDays * 24 * 60 * 60 * 1000).toISOString()
      const expired = this.notes.filter(n => n.done && !n.deletedAt && n.doneAt && n.doneAt < cutoff)
      if (!expired.length) return
      const ids    = expired.map(n => n._id)
      const result = await this._local.allDocs({ keys: ids, include_docs: true })
      const updates = result.rows
        .filter(r => r.doc)
        .map(r => ({ ...r.doc, deletedAt: new Date().toISOString() }))
      await this._local.bulkDocs(updates)
    },

    setDoneAutoDeleteDays(days) {
      this.doneAutoDeleteDays = parseInt(days) || 0
      localStorage.setItem('doneAutoDeleteDays', String(this.doneAutoDeleteDays))
    },

    // Reorder notes by assigning sequential `order` values (0, 1, 2 …).
    // Pass `columnId` to also update the notes' column assignment:
    //   undefined  → leave existing columnId unchanged
    async reEncryptAllNotes(newKey) {
      await Promise.all(this.notes.map(async (note) => {
        const encTitle   = await encryptField(newKey, note.title   || '')
        const encContent = await encryptField(newKey, note.content || '')
        await this._local.put({ ...note, title: encTitle, content: encContent })
      }))
    },

    //   null       → assign to Uncategorized (columnId: null)
    //   '<id>'     → assign to that board column
    async bulkDelete(ids) {
      if (!ids.length) return
      const result = await this._local.allDocs({ keys: ids, include_docs: true })
      const updates = result.rows
        .filter(r => r.doc)
        .map(r => ({ ...r.doc, deletedAt: new Date().toISOString() }))
      await this._local.bulkDocs(updates)
    },

    async bulkMove(ids, viewId) {
      if (!ids.length) return
      const result = await this._local.allDocs({ keys: ids, include_docs: true })
      const updates = result.rows
        .filter(r => r.doc)
        .map(r => ({ ...r.doc, viewId: viewId ?? null, columnId: null, updatedAt: new Date().toISOString() }))
      await this._local.bulkDocs(updates)
    },

    async reorderNotes(noteIds, columnId) {
      if (!noteIds.length) return
      const result = await this._local.allDocs({ keys: noteIds, include_docs: true })
      const updates = result.rows
        .filter(r => r.doc)
        .map(r => ({
          ...r.doc,
          order: noteIds.indexOf(r.id),
          ...(columnId !== undefined ? { columnId } : {}),
        }))
      await this._local.bulkDocs(updates)
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
          const fields = await this._encryptNote({ title: doc.title || '', content: doc.content || '' })
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
      if (noteIds.length) {
        const result = await this._local.allDocs({ keys: noteIds, include_docs: true })
        const updates = result.rows
          .filter(r => r.doc)
          .map(r => ({ ...r.doc, columnId: null }))
        await this._local.bulkDocs(updates)
      }
      const doc = await this._local.get(id)
      await this._local.remove(doc)
    },

    // ── Views ─────────────────────────────────────────────────────────────────

    async addView(name, parentId = null) {
      this.error = null
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
      const doc = await this._local.get(viewId)
      await this._local.put({ ...doc, ...changes })
    },

    async moveView(draggedId, targetId, position) {
      this.error = null
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
      const result = await this._local.allDocs({ keys: siblingIds, include_docs: true })
      const updates = result.rows
        .filter(r => r.doc)
        .map(r => ({ ...r.doc, parentId: newParentId, order: siblingIds.indexOf(r.id) }))
      await this._local.bulkDocs(updates)
    },

    async deleteView(view) {
      this.error = null
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
