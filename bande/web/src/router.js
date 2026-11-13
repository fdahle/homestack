import { createRouter, createWebHistory } from 'vue-router';
import { loadSession, session } from './api.js';

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: (to, from, saved) => saved || { top: 0 },
  routes: [
    { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    { path: '/', name: 'home', component: () => import('./views/HomeView.vue') },
    { path: '/friends', name: 'friends', component: () => import('./views/FriendsView.vue') },
    { path: '/friend/new', name: 'friend-new', component: () => import('./views/FriendEditView.vue') },
    { path: '/friend/:id', name: 'friend', component: () => import('./views/FriendView.vue'), props: true },
    { path: '/friend/:id/edit', name: 'friend-edit', component: () => import('./views/FriendEditView.vue'), props: true },
    { path: '/event/new', name: 'event-new', component: () => import('./views/EventView.vue') },
    { path: '/event/:id', name: 'event', component: () => import('./views/EventView.vue'), props: true },
    { path: '/timeline', name: 'timeline', component: () => import('./views/TimelineView.vue') },
    { path: '/share', name: 'share', component: () => import('./views/ShareView.vue') },
    { path: '/import', name: 'import', component: () => import('./views/ImportView.vue') },
    { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach(async (to) => {
  if (!session.checked) await loadSession();
  if (!to.meta.public && !session.user) return { name: 'login', query: { next: to.fullPath } };
  if (to.name === 'login' && session.user) return { name: 'home' };
});
