import { createRouter, createWebHistory } from 'vue-router';
import { loadSession, session } from './api.js';

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: (to, from, saved) => saved || { top: 0 },
  routes: [
    { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    { path: '/', name: 'home', component: () => import('./views/HomeView.vue') },
    { path: '/collection', name: 'collection', component: () => import('./views/CollectionView.vue') },
    { path: '/series/:id', name: 'series', component: () => import('./views/SeriesView.vue'), props: true },
    { path: '/issue/:id', name: 'issue', component: () => import('./views/IssueView.vue'), props: true },
    { path: '/add', name: 'add', component: () => import('./views/AddView.vue') },
    { path: '/scan', name: 'scan', component: () => import('./views/ScanView.vue') },
    { path: '/wishlist', name: 'wishlist', component: () => import('./views/WishlistView.vue') },
    { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach(async (to) => {
  if (!session.checked) await loadSession();
  if (!to.meta.public && !session.user) return { name: 'login', query: { next: to.fullPath } };
  if (to.name === 'login' && session.user) return { name: 'home' };
});
