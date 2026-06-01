<template>
  <div class="login-page">
    <div class="login-card">
      <h1>🗺 Mapper</h1>

      <form @submit.prevent="submit">
        <div class="field">
          <label>{{ authStore.setupRequired ? 'Create Password' : 'Password' }}</label>
          <div class="input-row">
            <input
              :type="showPassword ? 'text' : 'password'"
              v-model="password"
              placeholder="Enter password"
              :autocomplete="authStore.setupRequired ? 'new-password' : 'current-password'"
              required
            />
            <button type="button" class="toggle-pw" @click="showPassword = !showPassword">
              {{ showPassword ? '🙈' : '👁' }}
            </button>
          </div>
        </div>

        <p v-if="error" class="error">{{ error }}</p>

        <button type="submit" class="btn-primary" :disabled="loading">
          {{ loading ? '...' : authStore.setupRequired ? 'Create Account' : 'Sign In' }}
        </button>
      </form>

      <p v-if="authStore.setupRequired" class="hint">
        First time setup — set a password to protect your map.
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'

const authStore = useAuthStore()
const router = useRouter()

const password = ref('')
const showPassword = ref(false)
const error = ref(null)
const loading = ref(true)

onMounted(async () => {
  await authStore.fetchConfig()
  loading.value = false
})

async function submit() {
  error.value = null
  loading.value = true
  try {
    if (authStore.setupRequired) {
      await authStore.setup(password.value)
    } else {
      await authStore.login(password.value)
    }
    router.push('/')
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
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
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 40px;
  width: 340px;
  box-shadow: var(--shadow-lg);
}

h1 {
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 28px;
  text-align: center;
}

.field {
  margin-bottom: 16px;
}

.input-row {
  display: flex;
  gap: 6px;
}

.input-row input {
  flex: 1;
}

.toggle-pw {
  background: var(--surface-2);
  border: 1px solid var(--border);
  padding: 8px 10px;
  border-radius: var(--radius);
  font-size: 16px;
  line-height: 1;
  width: auto;
}

.toggle-pw:hover { background: var(--border); }

.error {
  color: var(--danger);
  font-size: 13px;
  margin-bottom: 12px;
}

.btn-primary {
  width: 100%;
  background: var(--accent);
  color: #fff;
  font-weight: 600;
  padding: 10px;
}

.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }

.hint {
  margin-top: 16px;
  font-size: 12px;
  color: var(--text-2);
  text-align: center;
}
</style>
