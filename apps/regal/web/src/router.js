import { createRouter, createWebHistory } from 'vue-router';
import { installAuthGuard } from './kit/api.js';
import { scrollBehavior } from './kit/util.js';

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior,
  routes: [
    { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    // A book opens beside the list on a computer, in its place on the phone
    {
      path: '/',
      name: 'library',
      component: () => import('./views/LibraryView.vue'),
      children: [{ path: 'book/:id', name: 'book', component: () => import('./views/BookView.vue'), props: true }],
    },
    { path: '/add', name: 'add', component: () => import('./views/AddView.vue') },
    { path: '/stats', name: 'stats', component: () => import('./views/StatsView.vue') },
    { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

installAuthGuard(router);
