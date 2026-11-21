# Design kit

The look and the shared code of the homestack apps that use Vue + Express: one design language (colours, type, cards, covers, navigation), the same login, the same icon style. Each app keeps building from its own folder: `sync.mjs` **copies** the kit into the apps, and the copies are committed.

```sh
node kit/sync.mjs           # after changing anything in kit/
node kit/sync.mjs --check   # does every app match the kit?
```

| Kit | Copied to | What it is |
|---|---|---|
| `web/` | `apps/<app>/web/src/kit/` | `tokens.css` (colours, sizes, light and dark), `base.css` (layout and components), `theme.js` (light, dark or automatic), `i18n.js`, `api.js`, `util.js`, `icons.js`, `components/` |
| `server/` | `apps/<app>/server/kit/` | `users.js` (accounts table), `auth.js` (login: own accounts or a login proxy), `http.js` (Express setup, `/healthz`, account routes, frontend, errors), `errors.js`, `auth.test.js` |
| `scripts/` | `apps/<app>/scripts/kit/` | `icons.js`: draws the app icon (white symbol on a rounded square in the app's colour) |

Apps using it: Checkpoint, Watchlist, Regal, Leute, Stapel, Notizbuch, To-do, and Fernweh for its colours, icon and login (the list is at the top of `sync.mjs`; Fernweh's copies go to `client/src/kit` and `api/kit`). `node kit/sync.mjs leute` syncs only the apps named. Don't edit files in an app's `kit/` folder: the next sync overwrites them. Change the kit here, sync, commit both.

## Phone and computer

Phone first. From **1024px** wide:

- the bottom tabs become a **sidebar** (app icon and name at the top, settings at the bottom, room for a switch like Watchlist's films/series under the name);
- `<main class="wide">` uses up to 1180px (lists, grids, stats); plain `<main>` stays a 760px column (forms, settings);
- cover grids get bigger tiles, stat cards sit side by side (`.stat-cards`);
- a list with its entries as child routes (**SplitView**) shows the open entry **beside** the list. On the phone the entry replaces the list. `Esc` closes it, `/` focuses the search where a page sets that up (`useShortcut`).

`.phone-only` and `.desktop-only` hide things on the other one.

## How an app uses it

**Styles** (`main.js`): `kit/tokens.css`, then `kit/base.css`, then the app's own `style.css`. The app's `style.css` sets its colours in `:root`, at least `--accent`, `--accent-text`, `--accent-soft`, each as a `light-dark(light, dark)` pair (no `prefers-color-scheme` blocks: those would ignore the setting below). It may tint `--bg`, `--surface`, `--line`, `--text`, `--muted`, and sets `--cover-ratio` when its covers aren't 2:3. Status colours go into `--st`/`--st-soft` via classes such as `.st-playing`. A `.status-picker` shows `--n` buttons per row (4 unless set): Checkpoint sets 6 and 3 on the phone, Watchlist's five series statuses 5 and 3.

An app with two modes (Watchlist: films and series) gives the second mode its own shade of the accent: it sets `data-mode` on `<html>` and overrides `--accent`, `--accent-soft` and `--bar` under `:root[data-mode="series"]`, as light-dark pairs too.

**Light and dark**: the system decides, unless *Darstellung* in the settings (in `AccountCards`) pins one for this device. `theme.js` sets `data-theme` on `<html>`, which pins `color-scheme` and so every `light-dark()` pair, and gives the phone's status bar (`<meta name="theme-color">`) the chosen theme's colour. The app's `index.html` has a light and a dark `theme-color` meta (with `media`) and, before the title, the one-line script from the top of `theme.js` that sets `data-theme` before the first paint.

**Texts**: the app's `i18n.js` calls `addMessages({ de, en })` from `kit/i18n.js` and re-exports `lang` and `t`. The kit brings back/close/save/cancel/delete, login, dates, rating, account settings and the common errors; the app's texts win where both have a key.

**Icons**: `addIcons({ name: '<path …/>' })` in the app's `icons.js` for symbols the kit doesn't have (24×24, 2px round stroke). Import it in `main.js`.

**Router**: `installAuthGuard(router)` from `kit/api.js` (the login route must be named `login`, pages without login get `meta: { public: true }`), `scrollBehavior` from `kit/util.js`. A list with entries beside it is a top-level route with children:

```js
{ path: '/', name: 'library', component: LibraryView, children: [{ path: 'game/:id', name: 'game', component: GameView, props: true }] }
```

and `LibraryView` wraps its content in `<SplitView>`.

**Components**: `AppShell` (the whole frame: pages, navigation, toast; `App.vue` is just `<AppShell name="…" :tabs :extras>`), `TopBar`, `SplitView`, `Cover`, `StarRating` (1–10 as half stars), `PartialDate` (a year, a month or a day), `BarList`, `Icon`, `LoginPage`, `AccountCards` (profile, language, password, logout; put the app's own setting cards in its slot).

**Server**:

```js
import { createUserStore } from './kit/users.js';
import { createAuth } from './kit/auth.js';
import { createApp, errorHandler, mountAccount, route, serveFrontend, servePrivateFiles } from './kit/http.js';

const users = createUserStore(db);                 // users + settings tables
const auth = createAuth({ users, cookie: 'checkpoint_session' });
const app = createApp();                           // trust proxy, JSON, GET /healthz
mountAccount(app, { auth, users, protect: ['/api', '/covers'] });
// … the app's routes, all behind the login …
servePrivateFiles(app, '/covers', COVER_DIR);
serveFrontend(app, distDir);
app.use(errorHandler((err, req, res) => false));   // answer app-specific errors, return true
await auth.ensureAdmin();
```

Throw `new BadRequest('code')` (from `kit/errors.js`) for a 400 the frontend shows as `t('errors.code')`.

## Login

By default each app has its own accounts: `ADMIN_USER`/`ADMIN_PASSWORD` create the first one, the session cookie lasts 400 days, logging out or changing the password ends the sessions on all devices, and wrong guesses are limited per address, per name and in total.

Behind **Authelia** (for the apps with sensitive data), set `AUTH_PROXY_SECRET` in the app's `.env` and let nginx pass the user on:

```nginx
location / {
    include /etc/nginx/snippets/authelia-authrequest.conf;
    proxy_set_header Remote-User $user;
    proxy_set_header Remote-Name $name;
    proxy_set_header X-Auth-Proxy-Secret "<the same secret>";
    proxy_pass http://127.0.0.1:<port>;
}
```

The app then trusts `Remote-User` only together with that secret, creates an account the first time it sees a user, and hides the password and logout settings. Without the secret every request gets a 403, so nothing else that reaches the port can claim to be someone.

## Icons

`scripts/make-icons.js` in each app describes only its symbol and calls `writeIcons({ accent, glyph, svg, out })` from `scripts/kit/icons.js`. `npm run icons` writes the PNGs and `icon.svg` to `web/public/`.

| App | Symbol | Accent |
|---|---|---|
| Leute | three friends | terracotta `#b2482a` |
| Checkpoint | checkered flag | indigo `#5448c8` |
| Stapel | pile of comics | blue `#2f5fa8` |
| Watchlist | film frame with a play button | teal `#14787a` |
| Regal | books on a shelf | forest green `#3d7a3a` |
| Fernweh | map pin | plum `#7b3fa0` |
| Notizbuch | a note slip with a folded corner | amber `#b07c00` |
| To-do | a tick swinging out of a box | raspberry `#b02058` |

