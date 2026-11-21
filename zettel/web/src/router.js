import { createRouter, createWebHistory } from 'vue-router';
import { installAuthGuard } from './kit/api.js';
import { scrollBehavior } from './kit/util.js';
import LoginView from './views/LoginView.vue';
import NotesView from './views/NotesView.vue';
import NoteView from './views/NoteView.vue';
import NewNoteView from './views/NewNoteView.vue';
import SettingsView from './views/SettingsView.vue';

// No lazy loading: every page has to be on the device for offline use (see web/sw.js)

// A list whose notes open beside it on a computer, in its place on the phone
const list = (path, name) => ({
  path,
  name,
  component: NotesView,
  children: [{ path: 'note/:id', name: `${name}-note`, component: NoteView, props: true }],
});

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior,
  routes: [
    { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
    list('/', 'notes'),
    list('/archive', 'archive'),
    list('/trash', 'trash'),
    // A new note, and one shared from another app (manifest share_target)
    { path: '/new', name: 'new', component: NewNoteView },
    { path: '/share', name: 'share', component: NewNoteView },
    { path: '/settings', name: 'settings', component: SettingsView },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

installAuthGuard(router);
