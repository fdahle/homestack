import { createRouter, createWebHistory } from 'vue-router';
import { installAuthGuard } from './kit/api.js';
import { scrollBehavior } from './kit/util.js';

const event = () => import('./views/EventView.vue');
const friendEdit = () => import('./views/FriendEditView.vue');

// Lists with their entries as children: on a computer the entry opens beside the list,
// on the phone in its place. The entries keep their old addresses (/friend/12, /event/34),
// which reminders and calendar entries link to.
export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior,
  routes: [
    { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    {
      path: '/',
      name: 'home',
      component: () => import('./views/HomeView.vue'),
      children: [{ path: 'event/:id(\\d+)', name: 'event', component: event, props: true }],
    },
    {
      path: '/friends',
      name: 'friends',
      component: () => import('./views/FriendsView.vue'),
      children: [
        { path: '/friend/new', name: 'friend-new', component: friendEdit },
        { path: '/friend/:id(\\d+)', name: 'friend', component: () => import('./views/FriendView.vue'), props: true },
        { path: '/friend/:id(\\d+)/edit', name: 'friend-edit', component: friendEdit, props: true },
        // An event opened on a friend's page, beside the friends
        { path: 'event/:id(\\d+)', name: 'friend-event', component: event, props: true },
      ],
    },
    {
      path: '/timeline',
      name: 'timeline',
      component: () => import('./views/TimelineView.vue'),
      children: [{ path: 'event/:id(\\d+)', name: 'timeline-event', component: event, props: true }],
    },
    { path: '/event/new', name: 'event-new', component: event },
    { path: '/share', name: 'share', component: () => import('./views/ShareView.vue') },
    { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

installAuthGuard(router);
