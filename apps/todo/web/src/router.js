import { createRouter, createWebHistory } from 'vue-router';
import { installAuthGuard } from './kit/api.js';
import { scrollBehavior } from './kit/util.js';
import LoginView from './views/LoginView.vue';
import TodayView from './views/TodayView.vue';
import UpcomingView from './views/UpcomingView.vue';
import ListsView from './views/ListsView.vue';
import ListView from './views/ListView.vue';
import TaskView from './views/TaskView.vue';
import SettingsView from './views/SettingsView.vue';

// No lazy loading: every page has to be on the device for offline use (see web/sw.js)

// A page whose tasks open beside it on a computer, in its place on the phone
const withTasks = (path, name, component) => ({
  path,
  name,
  component,
  children: [{ path: 'task/:id', name: `${name}-task`, component: TaskView, props: true }],
});

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior,
  routes: [
    { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
    // /task/<id> (from a reminder or the calendar) opens beside Today
    withTasks('/', 'today', TodayView),
    withTasks('/upcoming', 'upcoming', UpcomingView),
    withTasks('/lists', 'lists', ListsView),
    withTasks('/list/:listId', 'list', ListView),
    { path: '/settings', name: 'settings', component: SettingsView },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

installAuthGuard(router);
