import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('../views/LoginView.vue') },
    { path: '/', component: () => import('../views/MapView.vue'), meta: { requiresAuth: true } },
    { path: '/share/:token', component: () => import('../views/ShareView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth) return true
  const auth = useAuthStore()
  const ok = await auth.checkSession()
  // Keeps e.g. a place shared to the app (/?share_url=…) for after signing in.
  if (!ok) return to.fullPath === '/' ? '/login' : { path: '/login', query: { redirect: to.fullPath } }
})

export default router
