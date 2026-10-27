<template>
  <div class="login-page">
    <div class="login-card">
      <h1 class="login-title">Zettel</h1>

      <div v-if="authStore.notice" class="setup-notice">{{ authStore.notice }}</div>

      <div v-if="authStore.setupRequired" class="setup-notice">
        <strong>Welcome!</strong> No accounts exist yet. Set <code>ADMIN_USERNAME</code> and
        <code>ADMIN_PASSWORD</code> on the server and restart it to create the admin account.
      </div>

      <div v-if="authStore.allowSignup" class="login-tabs">
        <button class="tab" :class="{ active: tab === 'login' }" @click="tab = 'login'">Sign In</button>
        <button class="tab" :class="{ active: tab === 'register' }" @click="tab = 'register'">Create Account</button>
      </div>

      <form @submit.prevent="submit">
        <div v-if="tab === 'register' && authStore.encryptionEnabled" class="encryption-warning">
          <AppIcon name="info" :size="14" />
          If you forget your password, your notes cannot be recovered.
        </div>

        <label class="field-label">Username</label>
        <input v-model="username" class="field-input" type="text" autocomplete="username" required />

        <label class="field-label">Password</label>
        <input
          v-model="password"
          class="field-input"
          type="password"
          :autocomplete="tab === 'login' ? 'current-password' : 'new-password'"
          required
        />

        <label v-if="tab === 'login'" class="keep-signed-in">
          <input v-model="rememberMe" type="checkbox" />
          Keep me signed in
        </label>

        <p v-if="error" class="login-error">{{ error }}</p>

        <button class="btn-submit" type="submit" :disabled="loading">
          {{ loading ? 'Please wait…' : (tab === 'login' ? 'Sign In' : 'Create Account') }}
        </button>
      </form>
    </div>
  </div>
</template>

<script>
import { useAuthStore } from '../stores/auth.js'
import { useNotesStore } from '../stores/notes.js'

export default {
  name: 'LoginView',

  setup() {
    const authStore  = useAuthStore()
    const notesStore = useNotesStore()
    return { authStore, notesStore }
  },

  data() {
    return {
      tab:        'login',
      username:   '',
      password:   '',
      rememberMe: false,
      error:      null,
      loading:    false,
    }
  },

  async created() {
    await this.authStore.fetchConfig()
  },

  methods: {
    async submit() {
      this.error   = null
      this.loading = true
      try {
        if (this.tab === 'login') {
          await this.authStore.login(this.username, this.password, this.rememberMe)
        } else {
          await this.authStore.register(this.username, this.password)
        }
        this.authStore.notice = null
        this.$router.push('/')
      } catch (err) {
        this.error = err.message
      } finally {
        this.loading = false
      }
    },
  },
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
}

.login-card {
  background: var(--surface);
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0,0,0,.12);
  padding: 2rem;
  width: 100%;
  max-width: 380px;
}

.login-title {
  margin: 0 0 1.5rem;
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-1);
  text-align: center;
}

.login-tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  margin-bottom: 1.25rem;
}

.setup-notice {
  background: var(--accent-bg);
  color: var(--accent-text);
  font-size: 0.85rem;
  padding: 0.6rem 0.75rem;
  border-radius: 6px;
  margin-bottom: 1.25rem;
}

.tab {
  flex: 1;
  background: none;
  border: none;
  padding: 0.5rem;
  font-size: 0.875rem;
  cursor: pointer;
  color: var(--text-3);
  border-bottom: 2px solid transparent;
  transition: color 0.12s, border-color 0.12s;
}
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }

.encryption-warning {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  background: var(--warning-bg);
  color: var(--warning);
  font-size: 0.8rem;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  margin-bottom: 1rem;
}

.field-label {
  display: block;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-3);
  margin-bottom: 0.25rem;
}

.field-input {
  display: block;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  font-size: 0.95rem;
  outline: none;
  margin-bottom: 1rem;
  background: var(--surface);
  color: var(--text-1);
}
.field-input:focus { border-color: var(--accent); }

.keep-signed-in {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: var(--text-3);
  margin-bottom: 1rem;
  cursor: pointer;
  user-select: none;
}

.login-error {
  color: var(--danger);
  font-size: 0.8rem;
  margin: 0 0 0.75rem;
}

.btn-submit {
  width: 100%;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 0.625rem;
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s;
}
.btn-submit:hover:not(:disabled) { background: var(--accent-h); }
.btn-submit:disabled { opacity: 0.6; cursor: default; }
</style>
