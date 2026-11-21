import { createRouter, createWebHistory } from 'vue-router';
import { installAuthGuard } from './kit/api.js';
import { scrollBehavior } from './kit/util.js';

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior,
  routes: [
    { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    { path: '/', name: 'home', component: () => import('./views/HomeView.vue') },
    { path: '/blog/:id', name: 'blog', component: () => import('./views/BlogView.vue'), props: true },
    { path: '/blog/:id/settings', name: 'blog-settings', component: () => import('./views/BlogSettingsView.vue'), props: true },
    { path: '/add', name: 'add', component: () => import('./views/AddView.vue') },
    { path: '/discover', name: 'discover', component: () => import('./views/DiscoverView.vue') },
    { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
    // The bookmarklet (/mark?url=…) and the share target on Android (/share?url=…&text=…)
    { path: '/mark', name: 'mark', component: () => import('./views/MarkView.vue') },
    { path: '/share', name: 'share', component: () => import('./views/MarkView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

installAuthGuard(router);
