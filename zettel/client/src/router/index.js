import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('../views/LoginView.vue') },
    { path: '/',      component: () => import('../views/AppView.vue'),   meta: { requiresAuth: true } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()

  if (to.meta.requiresAuth) {
    const ok = auth.isAuthenticated || await auth.checkSession()
    if (!ok) return '/login'
    // Encryption key is derived from the password and kept only in memory.
    // On page refresh the key is gone — the user must log in again to re-derive it.
    if (auth.encryptionEnabled && !auth.encryptionKey) {
      auth._clearAuth()
      return '/login'
    }
  } else if (to.path === '/login') {
    const ok = auth.isAuthenticated || await auth.checkSession()
    if (ok && (!auth.encryptionEnabled || auth.encryptionKey)) return '/'
  }
})

export default router
