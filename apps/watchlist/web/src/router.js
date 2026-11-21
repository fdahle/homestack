import { createRouter, createWebHistory } from 'vue-router';
import { installAuthGuard } from './kit/api.js';
import { scrollBehavior } from './kit/util.js';
import { lastMode, PATHS, rememberMode } from './util.js';

const library = () => import('./views/LibraryView.vue');
const add = () => import('./views/AddView.vue');
const film = () => import('./views/FilmView.vue');
const series = () => import('./views/SeriesView.vue');

const films = { mode: 'films' };
const shows = { mode: 'series' };

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior,
  routes: [
    { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    // The start page is the mode you used last
    { path: '/', redirect: () => PATHS[lastMode.value].library },

    // Films. A film opens beside the list on a computer, in its place on the phone.
    {
      path: '/filme',
      name: 'films',
      component: library,
      props: films,
      meta: { ...films, page: 'library' },
      children: [{ path: ':id(\\d+)', name: 'film', component: film, props: true }],
    },
    { path: '/filme/neu', name: 'film-add', component: add, props: films, meta: { ...films, page: 'add' } },
    { path: '/filme/statistik', name: 'film-stats', component: () => import('./views/FilmStatsView.vue'), meta: { ...films, page: 'stats' } },

    // Series
    {
      path: '/serien',
      name: 'series',
      component: library,
      props: shows,
      meta: { ...shows, page: 'library' },
      children: [{ path: ':id(\\d+)', name: 'show', component: series, props: true }],
    },
    {
      path: '/serien/weiter',
      name: 'upnext',
      component: () => import('./views/UpNextView.vue'),
      meta: { ...shows, page: 'upnext' },
      children: [{ path: ':id(\\d+)', name: 'upnext-show', component: series, props: true }],
    },
    { path: '/serien/neu', name: 'series-add', component: add, props: shows, meta: { ...shows, page: 'add' } },
    { path: '/serien/statistik', name: 'series-stats', component: () => import('./views/SeriesStatsView.vue'), meta: { ...shows, page: 'stats' } },

    { path: '/einstellungen', name: 'settings', component: () => import('./views/SettingsView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

installAuthGuard(router);

// The mode colours the app (data-mode on <html>) and is remembered for the next start
router.afterEach((to) => rememberMode(to.meta.mode || lastMode.value));
