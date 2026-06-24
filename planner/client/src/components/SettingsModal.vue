<template>
  <div class="settings-backdrop" @click.self="$emit('close')" @keydown.escape.window="$emit('close')">
    <div class="settings-modal" role="dialog" aria-modal="true" aria-label="Settings">

      <div class="settings-header">
        <h2 class="settings-title">Settings</h2>
        <button class="settings-close" title="Close" @click="$emit('close')">
          <AppIcon name="x" :size="16" />
        </button>
      </div>

      <div class="settings-tabs">
        <button
          v-for="tab in visibleTabs"
          :key="tab.id"
          class="settings-tab"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="settings-body">

        <!-- General -->
        <template v-if="activeTab === 'general'">
          <section class="settings-section">
            <h3 class="settings-section-title">Drag &amp; Drop</h3>
            <p class="settings-description">What happens when you drag a note onto a label in the sidebar?</p>
            <label class="settings-radio">
              <input
                type="radio" name="dragLabelBehavior" value="move"
                :checked="notesStore.dragLabelBehavior === 'move'"
                @change="notesStore.setDragLabelBehavior('move')"
              />
              <span class="settings-radio-label">
                <strong>Move to label</strong>
                <span class="settings-radio-description">The note is moved into the target label (removed from its current label).</span>
              </span>
            </label>
            <label class="settings-radio">
              <input
                type="radio" name="dragLabelBehavior" value="add"
                :checked="notesStore.dragLabelBehavior === 'add'"
                @change="notesStore.setDragLabelBehavior('add')"
              />
              <span class="settings-radio-label">
                <strong>Add label</strong>
                <span class="settings-radio-description">The note stays in its current label and also appears in the target label.</span>
              </span>
            </label>
          </section>

          <hr class="settings-divider" />

          <section class="settings-section">
            <h3 class="settings-section-title">Tasks</h3>
            <p class="settings-description">Auto-move completed tasks to trash after how many days?</p>
            <div class="settings-select-row">
              <select
                class="settings-select"
                :value="notesStore.doneAutoDeleteDays"
                @change="notesStore.setDoneAutoDeleteDays($event.target.value)"
              >
                <option value="0">Never</option>
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="30">30 days</option>
                <option value="60">60 days</option>
                <option value="90">90 days</option>
              </select>
              <span class="settings-select-note">after marking done</span>
            </div>
          </section>
        </template>

        <!-- Appearance -->
        <template v-if="activeTab === 'appearance'">
          <section class="settings-section">
            <h3 class="settings-section-title">Theme</h3>
            <p class="settings-description">Choose between light and dark mode.</p>
            <label class="settings-radio">
              <input
                type="radio" name="theme" value="light"
                :checked="theme === 'light'"
                @change="setTheme('light')"
              />
              <span class="settings-radio-label">
                <strong>Light</strong>
                <span class="settings-radio-description">Classic bright interface.</span>
              </span>
            </label>
            <label class="settings-radio">
              <input
                type="radio" name="theme" value="dark"
                :checked="theme === 'dark'"
                @change="setTheme('dark')"
              />
              <span class="settings-radio-label">
                <strong>Dark</strong>
                <span class="settings-radio-description">Easy on the eyes in low-light environments.</span>
              </span>
            </label>
          </section>
        </template>

        <!-- Account -->
        <template v-if="activeTab === 'account'">
          <section class="settings-section">
            <h3 class="settings-section-title">Push Notifications</h3>
            <p class="settings-description">Get notified for reminders even when the app isn't open.</p>
            <div v-if="!pushSupported" class="settings-notice settings-notice--warn">
              Push notifications are not supported in this browser.
            </div>
            <template v-else>
              <div class="settings-toggle-row">
                <span class="settings-toggle-label">Enable push notifications</span>
                <button
                  class="settings-toggle"
                  :class="{ active: pushEnabled }"
                  :disabled="pushLoading"
                  @click="togglePush"
                  :aria-pressed="pushEnabled"
                >
                  <span class="settings-toggle-thumb" />
                </button>
              </div>
              <p v-if="pushError" class="settings-notice settings-notice--error">{{ pushError }}</p>
            </template>
          </section>

          <hr class="settings-divider" />

          <section class="settings-section">
            <h3 class="settings-section-title">Password</h3>
            <p v-if="authStore.encryptionEnabled" class="settings-notice settings-notice--warn">
              Encryption is on — changing your password will re-encrypt all notes with the new password.
            </p>
            <form class="settings-pw-form" @submit.prevent="changePassword">
              <input
                v-model="pwCurrent"
                class="settings-input"
                type="password"
                placeholder="Current password"
                autocomplete="current-password"
              />
              <input
                v-model="pwNew"
                class="settings-input"
                type="password"
                placeholder="New password (min. 12 chars)"
                autocomplete="new-password"
              />
              <input
                v-model="pwConfirm"
                class="settings-input"
                type="password"
                placeholder="Confirm new password"
                autocomplete="new-password"
              />
              <p v-if="pwError" class="settings-notice settings-notice--error">{{ pwError }}</p>
              <p v-if="pwSuccess" class="settings-notice settings-notice--success">{{ pwSuccess }}</p>
              <button type="submit" class="settings-btn" :disabled="pwLoading">
                {{ pwLoading ? 'Changing…' : 'Change password' }}
              </button>
            </form>
          </section>
        </template>

        <!-- Data -->
        <template v-if="activeTab === 'data'">
          <section class="settings-section">
            <h3 class="settings-section-title">Export &amp; Import</h3>
            <ExportImportPanel :inline="true" />
          </section>
        </template>

        <!-- Admin -->
        <template v-if="activeTab === 'admin'">
          <section class="settings-section">
            <div class="settings-admin-header">
              <h3 class="settings-section-title">
                Users
                <span class="settings-badge">{{ adminUsers.length }}</span>
              </h3>
              <button class="settings-admin-refresh" :disabled="adminLoading" title="Refresh" @click="loadAdminUsers">
                <AppIcon name="refresh" :size="13" />
              </button>
            </div>

            <div v-if="adminError" class="settings-notice settings-notice--error">{{ adminError }}</div>

            <div v-if="adminLoading && adminUsers.length === 0" class="settings-empty">Loading…</div>

            <div v-else class="settings-admin-list">
              <div
                v-for="user in adminUsers"
                :key="user.username"
                class="settings-admin-row"
                :class="{ 'settings-admin-row--self': user.username === authStore.username }"
              >
                <div class="settings-admin-info">
                  <span class="settings-admin-username">{{ user.username }}</span>
                  <span v-if="user.username === authStore.username" class="settings-badge">you</span>
                  <span class="settings-role-badge" :class="user.roles.includes('admin') ? 'settings-role-badge--admin' : 'settings-role-badge--user'">
                    {{ user.roles.includes('admin') ? 'Admin' : 'User' }}
                  </span>
                </div>
                <div v-if="adminDeleteConfirm === user.username" class="settings-admin-confirm">
                  <span class="settings-admin-confirm-label">Delete?</span>
                  <button class="settings-admin-action" @click="adminDeleteConfirm = null">Cancel</button>
                  <button class="settings-admin-action settings-admin-action--danger" :disabled="adminActionLoading === user.username" @click="executeAdminDelete(user)">Delete</button>
                </div>
                <div v-else-if="user.username !== authStore.username" class="settings-admin-actions">
                  <button class="settings-admin-action" :disabled="adminActionLoading === user.username" @click="toggleAdminRole(user)">
                    {{ user.roles.includes('admin') ? 'Revoke admin' : 'Make admin' }}
                  </button>
                  <button class="settings-admin-action settings-admin-action--danger" :disabled="adminActionLoading === user.username" @click="adminDeleteConfirm = user.username">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </section>

          <hr class="settings-divider" />

          <section class="settings-section">
            <h3 class="settings-section-title">Server</h3>
            <div class="settings-info-rows">
              <div class="settings-info-row">
                <span class="settings-info-label">Signup</span>
                <span class="settings-role-badge" :class="authStore.allowSignup ? 'settings-role-badge--ok' : 'settings-role-badge--off'">
                  {{ authStore.allowSignup ? 'Open' : 'Disabled' }}
                </span>
              </div>
              <div class="settings-info-row">
                <span class="settings-info-label">Encryption</span>
                <span class="settings-role-badge" :class="authStore.encryptionEnabled ? 'settings-role-badge--admin' : 'settings-role-badge--user'">
                  {{ authStore.encryptionEnabled ? 'Enabled' : 'Disabled' }}
                </span>
              </div>
            </div>
            <p class="settings-info-note">Signup and encryption are configured via environment variables.</p>
          </section>
        </template>

      </div>

      <div class="settings-footer">
        <span class="settings-username">{{ authStore.username }}</span>
        <button class="settings-logout" @click="logout">
          <AppIcon name="sign-out" :size="14" />
          Sign out
        </button>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useNotesStore } from '../stores/notes.js'
import { useAuthStore } from '../stores/auth.js'
import { useTheme } from '../composables/useTheme.js'
import { subscribeToPush, unsubscribeFromPush } from '../composables/usePushNotifications.js'
import ExportImportPanel from './ExportImportPanel.vue'

const emit = defineEmits(['close'])
const router = useRouter()
const notesStore = useNotesStore()
const authStore  = useAuthStore()
const { theme, toggle } = useTheme()

// ── Tabs ──────────────────────────────────────────────────────────────────────
const ALL_TABS = [
  { id: 'general',    label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'account',    label: 'Account' },
  { id: 'data',       label: 'Data' },
  { id: 'admin',      label: 'Admin', adminOnly: true },
]
const visibleTabs = computed(() =>
  ALL_TABS.filter(t => !t.adminOnly || authStore.isAdmin)
)
const activeTab = ref('general')

// ── Theme ─────────────────────────────────────────────────────────────────────
function setTheme(val) {
  if (theme.value !== val) toggle()
}

// ── Push notifications ────────────────────────────────────────────────────────
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window
const pushEnabled   = ref(false)
const pushLoading   = ref(false)
const pushError     = ref('')

async function checkPushState() {
  if (!pushSupported) return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  pushEnabled.value = !!sub
}

async function togglePush() {
  pushLoading.value = true
  pushError.value   = ''
  try {
    if (pushEnabled.value) {
      await unsubscribeFromPush()
      pushEnabled.value = false
    } else {
      await subscribeToPush()
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      pushEnabled.value = !!sub
      if (!pushEnabled.value) {
        pushError.value = 'Permission denied — allow notifications in your browser settings and try again.'
      }
    }
  } catch (err) {
    pushError.value = err.message
  } finally {
    pushLoading.value = false
  }
}

onMounted(checkPushState)

// ── Password change ───────────────────────────────────────────────────────────
const pwCurrent = ref('')
const pwNew     = ref('')
const pwConfirm = ref('')
const pwLoading = ref(false)
const pwError   = ref('')
const pwSuccess = ref('')

async function changePassword() {
  pwError.value   = ''
  pwSuccess.value = ''
  if (!pwCurrent.value || !pwNew.value || !pwConfirm.value) {
    pwError.value = 'All fields are required.'
    return
  }
  if (pwNew.value !== pwConfirm.value) {
    pwError.value = 'New passwords do not match.'
    return
  }
  if (pwNew.value.length < 12) {
    pwError.value = 'New password must be at least 12 characters.'
    return
  }
  pwLoading.value = true
  try {
    const res  = await fetch('/api/auth/change-password', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ currentPassword: pwCurrent.value, newPassword: pwNew.value }),
    })
    const body = await res.json()
    if (!res.ok) {
      pwError.value = body.error || 'Failed to change password.'
      return
    }
    if (authStore.encryptionEnabled) {
      const { deriveKey } = await import('../utils/crypto.js')
      // Same per-user salt, new password → new key; re-encrypt everything below.
      const newKey = await deriveKey(pwNew.value, authStore.encSalt)
      await notesStore.reEncryptAllNotes(newKey)
      authStore.encryptionKey = newKey
    }
    pwCurrent.value = ''
    pwNew.value     = ''
    pwConfirm.value = ''
    pwSuccess.value = 'Password changed successfully.'
  } catch (err) {
    pwError.value = err.message || 'An unexpected error occurred.'
  } finally {
    pwLoading.value = false
  }
}

// ── Admin ─────────────────────────────────────────────────────────────────────
const adminUsers         = ref([])
const adminLoading       = ref(false)
const adminActionLoading = ref(null)
const adminError         = ref('')
const adminDeleteConfirm = ref(null)

watch(activeTab, (val) => {
  if (val === 'admin' && adminUsers.value.length === 0) loadAdminUsers()
})

async function loadAdminUsers() {
  adminLoading.value = true
  adminError.value   = ''
  try {
    const res  = await fetch('/api/admin/users')
    const body = await res.json()
    if (!res.ok) throw new Error(body.error || 'Failed to load users')
    adminUsers.value = body
  } catch (err) {
    adminError.value = err.message
  } finally {
    adminLoading.value = false
  }
}

async function toggleAdminRole(user) {
  adminActionLoading.value = user.username
  adminError.value = ''
  try {
    const res  = await fetch(`/api/admin/users/${encodeURIComponent(user.username)}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ admin: !user.roles.includes('admin') }),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error || 'Failed to update user')
    await loadAdminUsers()
  } catch (err) {
    adminError.value = err.message
  } finally {
    adminActionLoading.value = null
  }
}

async function executeAdminDelete(user) {
  adminActionLoading.value = user.username
  adminError.value = ''
  try {
    const res  = await fetch(`/api/admin/users/${encodeURIComponent(user.username)}`, { method: 'DELETE' })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error || 'Failed to delete user')
    adminDeleteConfirm.value = null
    await loadAdminUsers()
  } catch (err) {
    adminError.value = err.message
    adminDeleteConfirm.value = null
  } finally {
    adminActionLoading.value = null
  }
}

// ── Logout ────────────────────────────────────────────────────────────────────
async function logout() {
  notesStore.reset()
  await authStore.logout()
  router.push('/login')
}
</script>

<style scoped>
.settings-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.settings-modal {
  background: var(--surface);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  width: 460px;
  max-width: calc(100vw - 2rem);
  height: 520px;
  max-height: calc(100vh - 4rem);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── Header ── */
.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem 0.75rem;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.settings-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.settings-close {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.25rem;
  color: var(--text-3);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.settings-close:hover { background: var(--surface-3); }

/* ── Tabs ── */
.settings-tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  padding: 0 0.5rem;
  overflow-x: auto;
  flex-shrink: 0;
  scrollbar-width: none;
}
.settings-tabs::-webkit-scrollbar { display: none; }

.settings-tab {
  padding: 0.6rem 0.875rem;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.875rem;
  color: var(--text-3);
  white-space: nowrap;
  transition: color 0.12s, border-color 0.12s;
}
.settings-tab:hover { color: var(--text-1); }
.settings-tab.active { color: var(--accent); border-bottom-color: var(--accent); }

/* ── Body ── */
.settings-body {
  padding: 1.25rem;
  overflow-y: auto;
  flex: 1;
}

.settings-section { }
.settings-section--muted { opacity: 0.55; }

.settings-divider {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1rem 0;
}

.settings-section-title {
  margin: 0 0 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.settings-description {
  margin: 0 0 0.875rem;
  font-size: 0.875rem;
  color: var(--text-2);
}

/* ── Radio options ── */
.settings-radio {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  padding: 0.625rem 0.75rem;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 0.375rem;
  border: 1px solid transparent;
  transition: background 0.1s, border-color 0.1s;
}
.settings-radio:hover { background: var(--surface-3); }
.settings-radio:has(input:checked) {
  background: var(--accent-bg);
  border-color: var(--accent);
}
.settings-radio input[type="radio"] {
  margin-top: 3px;
  flex-shrink: 0;
  accent-color: var(--accent);
}
.settings-radio-label {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  font-size: 0.875rem;
}
.settings-radio-description {
  color: var(--text-3);
  font-size: 0.8125rem;
  font-weight: 400;
}

/* ── Select row ── */
.settings-select-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.settings-select {
  appearance: none;
  -webkit-appearance: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.35rem 0.75rem;
  font-size: 0.875rem;
  font-family: inherit;
  background: var(--surface-2);
  color: var(--text-1);
  cursor: pointer;
  outline: none;
}
.settings-select:focus { border-color: var(--accent); }
.settings-select-note {
  font-size: 0.8125rem;
  color: var(--text-muted);
}

/* ── Toggle switch ── */
.settings-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.375rem 0;
}
.settings-toggle-label {
  font-size: 0.875rem;
  color: var(--text-1);
}
.settings-toggle {
  position: relative;
  width: 44px;
  height: 24px;
  border-radius: 12px;
  border: none;
  background: var(--border-2);
  cursor: pointer;
  transition: background 0.2s;
  padding: 0;
  flex-shrink: 0;
}
.settings-toggle.active { background: var(--accent); }
.settings-toggle:disabled { opacity: 0.5; cursor: default; }
.settings-toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
  display: block;
  pointer-events: none;
}
.settings-toggle.active .settings-toggle-thumb { transform: translateX(20px); }

/* ── Notice banners ── */
.settings-notice {
  font-size: 0.8rem;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  margin-top: 0.5rem;
}
.settings-notice--warn  { background: var(--warning-bg);  color: var(--warning); }
.settings-notice--error { background: var(--danger-bg);   color: var(--danger); }

/* ── Badge (coming soon, etc.) ── */
.settings-badge {
  font-size: 0.62rem;
  font-weight: 600;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  background: var(--surface-3);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  vertical-align: middle;
}

/* ── Admin panel ── */
.settings-admin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.625rem;
}

.settings-admin-refresh {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-3);
  padding: 0.2rem;
  border-radius: 4px;
  display: flex;
  align-items: center;
}
.settings-admin-refresh:hover { color: var(--text-1); background: var(--surface-3); }
.settings-admin-refresh:disabled { opacity: 0.4; cursor: default; }

.settings-admin-list {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.settings-admin-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.55rem 0.75rem;
  font-size: 0.8125rem;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.settings-admin-row + .settings-admin-row { border-top: 1px solid var(--border); }
.settings-admin-row--self { background: var(--surface-2); }

.settings-admin-info {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}

.settings-admin-username {
  font-weight: 500;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-role-badge {
  display: inline-block;
  font-size: 0.68rem;
  font-weight: 700;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
  flex-shrink: 0;
}
.settings-role-badge--admin { background: var(--accent-bg);  color: var(--accent); }
.settings-role-badge--user  { background: var(--surface-3);  color: var(--text-2); }
.settings-role-badge--ok    { background: var(--success-bg); color: var(--success); }
.settings-role-badge--off   { background: var(--warning-bg); color: var(--warning); }

.settings-admin-actions,
.settings-admin-confirm {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-shrink: 0;
}

.settings-admin-confirm-label {
  font-size: 0.78rem;
  color: var(--text-2);
  margin-right: 0.1rem;
}

.settings-admin-action {
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.2rem 0.55rem;
  font-size: 0.78rem;
  font-family: inherit;
  color: var(--text-2);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.1s, color 0.1s;
}
.settings-admin-action:hover { background: var(--surface-2); color: var(--text-1); }
.settings-admin-action:disabled { opacity: 0.4; cursor: default; }
.settings-admin-action--danger { color: var(--danger); border-color: var(--danger-bdr, var(--border)); }
.settings-admin-action--danger:hover { background: var(--danger-bg); }

.settings-empty {
  padding: 1rem 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.875rem;
}

.settings-info-rows {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 0.5rem;
}

.settings-info-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.875rem;
}

.settings-info-label {
  width: 80px;
  flex-shrink: 0;
  color: var(--text-2);
  font-weight: 500;
}

.settings-info-note {
  margin: 0;
  font-size: 0.78rem;
  color: var(--text-muted);
}

/* ── Footer ── */
.settings-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1.25rem;
  border-top: 1px solid var(--border);
  gap: 0.75rem;
  flex-shrink: 0;
}
.settings-username {
  font-size: 0.8rem;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.settings-logout {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.35rem 0.75rem;
  font-size: 0.8rem;
  font-family: inherit;
  color: var(--text-3);
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: color 0.12s, background 0.12s, border-color 0.12s;
}
.settings-logout:hover { color: var(--danger); background: var(--danger-bg); border-color: var(--danger-bdr); }

/* ── Password form ── */
.settings-pw-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.settings-input {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.45rem 0.75rem;
  font-size: 0.875rem;
  font-family: inherit;
  background: var(--surface-2);
  color: var(--text-1);
  outline: none;
  transition: border-color 0.12s;
}
.settings-input:focus { border-color: var(--accent); }

.settings-btn {
  align-self: flex-start;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 0.45rem 1rem;
  font-size: 0.875rem;
  font-family: inherit;
  font-weight: 500;
  cursor: pointer;
  margin-top: 0.125rem;
  transition: background 0.12s;
}
.settings-btn:hover:not(:disabled) { background: var(--accent-h); }
.settings-btn:disabled { opacity: 0.5; cursor: default; }

.settings-notice--success { background: var(--success-bg); color: var(--success); }

/* ── Mobile ── */
@media (max-width: 640px) {
  .settings-modal {
    width: 100%;
    max-width: 100%;
    max-height: 100dvh;
    border-radius: 0;
    margin: 0;
  }
  .settings-backdrop {
    align-items: flex-end;
  }
}
</style>
